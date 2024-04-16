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

export interface EventProvider<Event> {
  next: () => Promise<Event>;
}

type TypesOf<U> = U extends { type: infer T } ? T : never;
type Variant<U, T> = U extends { type: T } ? U : never;

class EventHandlerMap<Event extends { type: unknown }> {
  private readonly handlers = new Map<
    TypesOf<Event>,
    ((event: Event) => Promise<void> | void)[]
  >();

  registerHandler<T extends TypesOf<Event>>(
    eventType: T,
    handler: (event: Variant<Event, T>) => Promise<void> | void
  ) {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    // @ts-expect-error We cheat. Unfortunately.
    this.handlers.get(eventType)?.push(handler);
  }

  async handle(event: Event) {
    // @ts-expect-error We cheat. Unfortunately.
    const handlers = this.handlers.get(event.type);
    if (handlers === undefined) {
      return;
    }
    for (const handler of handlers) {
      await handler(event);
    }
  }
}

export class EventMultiplexer<Event extends { type: unknown }> {
  private readonly providers: Map<string, EventProvider<Event>>;
  private readonly promises: Map<string, Promise<void>>;
  private readonly queue: Event[] = [];
  private readonly handlers = new EventHandlerMap<Event>();

  constructor() {
    this.providers = new Map();
    this.promises = new Map();
  }

  registerProvider(provider: EventProvider<Event>): void {
    let id = generateId(8).toString();
    while (this.providers.has(id)) {
      id = generateId(8).toString();
    }
    this.providers.set(id, provider);
  }

  registerHandler<T extends TypesOf<Event>>(
    eventType: T,
    handler: (event: Variant<Event, T>) => void | Promise<void>
  ): void {
    this.handlers.registerHandler(eventType, handler);
  }

  async handleNext(): Promise<void> {
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

    const event = this.queue.shift() as Event;
    await this.handlers.handle(event);
  }
}

export const TimerEvent = z.object({
  type: z.literal("timer"),
});
export type TimerEvent = z.infer<typeof TimerEvent>;
const TIMER_EVENT: TimerEvent = { type: "timer" };

export const RequestEvent = z.object({
  type: z.literal("request"),
  request: Request,
});
export type RequestEvent = z.infer<typeof RequestEvent>;

class RequestEventProvider implements EventProvider<RequestEvent> {
  private buffer: object[] = [];

  constructor(private readonly log: Log, private readonly port: ServerPort) {}

  next: () => Promise<RequestEvent> = async () => {
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

export class TimerEventProvider
  extends TimerManager
  implements EventProvider<TimerEvent>
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

  next: () => Promise<TimerEvent> = () => {
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

export const useTimerEvents = (
  multiplexer: EventMultiplexer<TimerEvent>,
  timers: TimerEventProvider
) => {
  multiplexer.registerProvider(timers);
  multiplexer.registerHandler("timer", async () => {
    await timers.invoke();
  });
};

class RequestHandler {
  constructor(
    private readonly ns: NS,
    private readonly log: Log,
    private readonly service: object
  ) {}

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

  handleRequest = async (raw: unknown) => {
    const maybeRequest = Request.safeParse(raw);
    if (!maybeRequest.success) {
      const error = fromZodError(maybeRequest.error);
      this.log.error("invalid-request", { error, raw });
      throw error;
    }

    const request = maybeRequest.data;
    const handler = Reflect.get(this.service, request.method) as Handler;
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
}

export const useRequestEvents = (opts: {
  service: object;
  portNumber: number;
  clearPort: boolean;
  multiplexer: EventMultiplexer<RequestEvent>;
  ns: NS;
  log: Log;
}) => {
  const port = new ServerPort(opts.ns, opts.portNumber);
  if (opts.clearPort) {
    opts.log.info("clearing port", { port: opts.portNumber });
    port.clear();
  }

  opts.multiplexer.registerProvider(new RequestEventProvider(opts.log, port));

  const handler = new RequestHandler(opts.ns, opts.log, opts.service);
  opts.multiplexer.registerHandler("request", (event) =>
    handler.handleRequest(event.request)
  );
};

export abstract class BaseService<Event extends { type: unknown }> {
  readonly clearPortOnListen: boolean = true;
  private lastYield = Date.now();
  protected readonly log: Log;
  protected readonly fmt: Fmt;
  protected readonly eventMultiplexer = new EventMultiplexer<Event>();

  constructor(protected readonly ns: NS) {
    this.log = new Log(ns, this.constructor.name);
    this.fmt = new Fmt(ns);
  }

  protected async setup(): Promise<void> {
    // Override to run code just before starting to serve requests
  }

  protected maxTimeSlice(): number {
    return 100;
  }

  private async yieldIfNeeded(): Promise<void> {
    if (Date.now() - this.lastYield > this.maxTimeSlice()) {
      this.lastYield = Date.now();
      await this.ns.sleep(0);
    }
  }

  async run(): Promise<void> {
    await this.setup();

    // eslint-disable-next-line no-constant-condition, @typescript-eslint/no-unnecessary-condition
    while (true) {
      await this.eventMultiplexer.handleNext();
      await this.yieldIfNeeded();
    }
  }
}
