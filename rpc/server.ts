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

export abstract class BaseService {
  readonly clearPortOnListen: boolean = true;
  private lastYield = Date.now();
  protected readonly log: Log;
  protected readonly listenPort: ServerPort;
  protected readonly fmt: Fmt;
  protected readonly timers = new TimerManager();

  constructor(protected readonly ns: NS) {
    this.log = new Log(ns, this.constructor.name);
    this.fmt = new Fmt(ns);
    this.registerTimers(this.timers);
    this.listenPort = new ServerPort(ns, this.getPortNumber());
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

  private nextRequest = async (buffer: unknown[]) =>
    buffer.shift() ??
    (await this.listenPort.read({
      timeout: this.timers.getTimeUntilNextEvent(),
      throwOnTimeout: false,
    }));

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

    const buffer = [];
    // eslint-disable-next-line no-constant-condition, @typescript-eslint/no-unnecessary-condition
    while (true) {
      await this.timers.invoke();
      buffer.push(...this.listenPort.drain());

      const raw = await this.nextRequest(buffer);
      if (raw !== null) {
        //this.log.debug("req", { request: raw });
        await this.handleRequest(raw);
      }

      await this.yieldIfNeeded();
    }
  }
}
