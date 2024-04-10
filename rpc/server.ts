import { Log } from "lib/log";
import { ServerPort } from "./transport/ServerPort";
import { Request, Response, errorResponse, successResponse } from "./types";
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
  private readonly timers = new TimerManager();

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

  private async executeWithoutResponse(
    methodName: string,
    method: (...args: unknown[]) => unknown,
    args: unknown[]
  ): Promise<void> {
    try {
      await method(...args);
    } catch (error) {
      this.log.error("execute-error", {
        error: maybeZodErrorMessage(error),
        method: methodName,
        args,
      });
    }
  }

  private async executeWithResponse(
    methodName: string,
    method: (...args: unknown[]) => unknown,
    args: unknown[],
    msgId: string
  ): Promise<Response> {
    try {
      const result = await method(...args);
      return successResponse(msgId, result);
    } catch (error) {
      this.log.error("execute-error", {
        error: maybeZodErrorMessage(error),
        stack: error instanceof Error ? error.stack : undefined,
        msgId,
        method: methodName,
        args,
      });
      return errorResponse(msgId, maybeZodErrorMessage(error));
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
    const method = Reflect.get(this, request.method);
    if (typeof method !== "function") {
      this.log.error("method-not-found", { request });
      if (request.responseMeta !== undefined) {
        await this.respond(
          request.responseMeta.port,
          errorResponse(
            request.responseMeta.msgId,
            `Requested method doesn't exist: ${request.method}`
          )
        );
      }
      return;
    }

    const f = method as (...args: unknown[]) => unknown;
    if (request.responseMeta === undefined) {
      await this.executeWithoutResponse(request.method, f, request.args);
      this.log.debug(
        `${request.method}(${request.args.map(highlightJSON).join(", ")})`
      );
    } else {
      const response = await this.executeWithResponse(
        request.method,
        f,
        request.args,
        request.responseMeta.msgId
      );
      //this.log.debug("res", { request, response });
      this.log.debug(
        `${request.method}(${request.args
          .map(highlightJSON)
          .join(", ")}) => ${highlightJSON(
          response.status === "success" ? response.result : response.error
        )} (client: ${request.responseMeta.port.toString()})`
      );
      await this.respond(request.responseMeta.port, response);
    }
  };

  private async respond(portNumber: number, response: Response) {
    const port = new ClientPort(this.ns, portNumber);
    port.writeSync(response);
    await this.ns.sleep(0);
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
