import { Log } from "lib/log";
import { ServerPort } from "./transport/ServerPort";
import {
  Handler,
  Request,
  Response,
  errorResponse,
  successResponse,
} from "./types";
import { Fmt, highlightJSON } from "lib/fmt";
import { TimerManager } from "lib/TimerManager";
import { ClientPort } from "./transport/ClientPort";
import { fromZodError } from "zod-validation-error";
import { maybeZodErrorMessage } from "lib/error";
import { generateId } from "lib/id";
import { z } from "zod";

interface EventProvider<Event> {
  next: () => Promise<Event>;
}

class EventMultiplexer<Event> implements EventProvider<Event> {
  private readonly providers: Map<string, EventProvider<Event>>;
  private readonly promises: Map<string, Promise<void>>;
  private readonly queue: Event[] = [];

  constructor() {
    this.providers = new Map();
    this.promises = new Map();
  }

  register(provider: EventProvider<Event>): void {
    let id = generateId(8).toString();
    while (this.providers.has(id)) {
      id = generateId(8).toString();
    }
    this.providers.set(id, provider);
  }

  async next(): Promise<Event> {
    for (const [id, provider] of this.providers) {
      if (!this.promises.has(id)) {
        this.promises.set(
          id,
          (async () => {
            const event = await provider.next();
            this.promises.delete(id);
            this.queue.push(event);
          })()
        );
      }
    }

    if (this.queue.length === 0) {
      const promises = Array.from(this.promises.values());
      await Promise.any(promises);
    }
    return this.queue.shift() as Event;
  }
}

export const BaseEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("timer"),
  }),
  z.object({
    type: z.literal("request"),
    request: Request,
  }),
]);
export type BaseEvent = z.infer<typeof BaseEvent>;

class RequestEventProvider implements EventProvider<BaseEvent> {
  private buffer: object[] = [];

  constructor(private readonly log: Log, private readonly port: ServerPort) {}

  next: () => Promise<BaseEvent> = async () => {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, no-constant-condition
    while (true) {
      this.buffer = this.buffer.concat(this.port.drain());
      const raw =
        this.buffer.shift() ?? (await this.port.read({ timeout: Infinity }));
      if (raw === null) {
        continue;
      }
      const maybeRequest = Request.safeParse(raw);
      if (!maybeRequest.success) {
        const error = fromZodError(maybeRequest.error);
        this.log.error("invalid-request", { error, raw });
        continue;
      }
      return {
        type: "request",
        request: maybeRequest.data,
      };
    }
  };
}

interface TimerEvent {
  type: "timer";
}
const TIMER_EVENT: TimerEvent = { type: "timer" };

class TimerEventProvider
  extends TimerManager
  implements EventProvider<BaseEvent>
{
  private state!: {
    promise: Promise<TimerEvent>;
    resolve: (value: TimerEvent) => void;
    isResolved: boolean;
  };

  constructor(private readonly ns: NS) {
    super();
    this.state = {
      promise: Promise.resolve(TIMER_EVENT),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      resolve: () => {},
      isResolved: true,
    };
  }

  setInterval(callback: () => void | Promise<void>, ms: number): void {
    super.setInterval(callback, ms);
    // Force a refresh of the promise
    this.doResolve();
  }

  setTimeout(callback: () => void | Promise<void>, ms: number): () => void {
    const clear = super.setTimeout(callback, ms);
    // Force a refresh of the promise
    this.doResolve();
    return clear;
  }

  private newState() {
    let resolve: (value: TimerEvent) => void;
    const promise = new Promise<TimerEvent>((r) => {
      resolve = r;
    });
    this.state = {
      promise,
      // @ts-expect-error It's not actually undefined, it's assigned in the Promise constructor above
      resolve,
      isResolved: false,
    };
  }

  private doResolve() {
    if (!this.state.isResolved) {
      this.state.isResolved = true;
      this.state.resolve({ ...TIMER_EVENT });
    }
  }

  next: () => Promise<BaseEvent> = () => {
    this.newState();
    const time = this.getTimeUntilNextEvent();
    if (time === Infinity) {
      return this.state.promise;
    }
    return Promise.any([
      this.state.promise,
      this.ns.asleep(time).then(() => {
        return TIMER_EVENT;
      }),
    ]);
  };
}

export abstract class BaseService<Event = BaseEvent> {
  readonly clearPortOnListen: boolean = true;
  private lastYield = Date.now();
  protected readonly log: Log;
  protected readonly listenPort: ServerPort;
  protected readonly fmt: Fmt;
  protected readonly timers;
  protected readonly eventMultiplexer = new EventMultiplexer<
    Event & BaseEvent
  >();

  constructor(protected readonly ns: NS) {
    this.log = new Log(ns, this.constructor.name);
    this.fmt = new Fmt(ns);
    this.timers = new TimerEventProvider(ns);
    this.registerTimers(this.timers);
    this.listenPort = new ServerPort(ns, this.getPortNumber());

    this.eventMultiplexer.register(this.timers);
    this.eventMultiplexer.register(
      new RequestEventProvider(this.log, this.listenPort)
    );
  }

  abstract getPortNumber(): number;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected registerTimers(timers: TimerManager): void {
    // Override to register timers at construction time
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  protected async setup(): Promise<void> {
    // Override to run code just before starting to serve requests
  }

  protected maxTimeSlice(): number {
    return 100;
  }

  private clearPortIfNeeded = () => {
    if (this.clearPortOnListen) {
      this.ns.print(`Clearing port ${this.listenPort.portNumber.toString()}`);
      this.listenPort.clear();
    }
  };

  private async execute(handler: Handler, request: Request): Promise<void> {
    try {
      await handler(request, {
        success: async (ret) => {
          await this.respondSuccess(request, ret);
        },
        error: this.respondError.bind(this, request),
      });
    } catch (error) {
      this.log.error("execute-error", {
        error: maybeZodErrorMessage(error),
        method: request.method,
        args: request.args,
      });
    }
  }

  private handleRequest = async (raw: unknown) => {
    const maybeRequest = Request.safeParse(raw);
    if (!maybeRequest.success) {
      const error = fromZodError(maybeRequest.error);
      this.log.error("invalid-request", { error, raw });
      throw error;
    }

    const request = maybeRequest.data;
    const handler = Reflect.get(this, request.method) as Handler;
    if (typeof handler !== "function") {
      this.log.error("method-not-found", { request });
      if (request.responseMeta !== undefined) {
        await this.respond(
          request,
          errorResponse(
            request.responseMeta.msgId,
            `Requested method doesn't exist: ${request.method}`
          )
        );
      }
      return;
    }

    this.log.debug(
      `${request.responseMeta?.port.toString() ?? "unknown"} => ${
        request.method
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      }(${request.args.map(highlightJSON).join(", ")})`
    );

    await this.execute(handler, request);
  };

  private async respond(request: Request, response: Response) {
    if (request.responseMeta === undefined) {
      return;
    }
    this.log.debug(
      `${request.responseMeta.port.toString()} <= ${highlightJSON(
        response.status === "success" ? response.result : response.error
      )}`
    );
    const port = new ClientPort(this.ns, request.responseMeta.port);
    port.writeSync(response);
    await this.ns.sleep(0);
  }

  private async respondSuccess(request: Request, result: unknown) {
    if (request.responseMeta === undefined) {
      return;
    }
    await this.respond(
      request,
      successResponse(request.responseMeta.msgId, result)
    );
  }

  private async respondError(request: Request, error: string) {
    if (request.responseMeta === undefined) {
      return;
    }
    await this.respond(
      request,
      errorResponse(request.responseMeta.msgId, error)
    );
  }

  private async yieldIfNeeded(): Promise<void> {
    if (Date.now() - this.lastYield > this.maxTimeSlice()) {
      this.lastYield = Date.now();
      await this.ns.sleep(0);
    }
  }

  async listen(): Promise<void> {
    this.clearPortIfNeeded();
    await this.setup();
    this.log.info("listening", { port: this.listenPort.portNumber });

    // eslint-disable-next-line no-constant-condition, @typescript-eslint/no-unnecessary-condition
    while (true) {
      const event = await this.eventMultiplexer.next();
      if (event.type === "timer") {
        await this.timers.invoke();
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      } else if (event.type === "request") {
        await this.handleRequest(event.request);
      }
      await this.yieldIfNeeded();
    }
  }
}
