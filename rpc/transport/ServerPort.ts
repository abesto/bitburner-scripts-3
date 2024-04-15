import { NetscriptPort } from "NetscriptDefinitions";
import { Log } from "lib/log";

export interface ReadOptions {
  timeout?: number;
  throwOnTimeout?: boolean;
}

export class ServerPort {
  private readonly port: NetscriptPort;
  private readonly log: Log;

  constructor(private readonly ns: NS, readonly portNumber: number) {
    this.port = ns.getPortHandle(portNumber);
    this.log = new Log(ns, `ServerPort:${portNumber.toString()}`);
  }

  async read(options?: ReadOptions): Promise<unknown> {
    const timeout = options?.timeout ?? 5000;
    const throwOnTimeout = options?.throwOnTimeout ?? true;
    if (this.port.empty() && timeout > 0) {
      const promise =
        timeout === Infinity
          ? this.port.nextWrite()
          : Promise.any([this.port.nextWrite(), this.ns.asleep(timeout)]);
      if ((await promise) === true) {
        if (throwOnTimeout) {
          throw new Error(
            `Timeout reading from port ${this.portNumber.toString()}`
          );
        } else {
          return null;
        }
      }
    }
    const data: unknown = this.port.read();
    if (data === "NULL PORT DATA") {
      return null;
    }
    return data;
  }

  drain(): NonNullable<unknown>[] {
    const messages: NonNullable<unknown>[] = [];
    while (!this.port.empty()) {
      const data: unknown = this.port.read();
      if (data === "NULL PORT DATA") {
        continue;
      }
      if (data !== null && data !== undefined) {
        messages.push(data);
      }
    }
    return messages;
  }

  empty(): boolean {
    return this.port.empty();
  }

  nextWrite(): Promise<void> {
    return this.port.nextWrite();
  }

  clear(): void {
    this.port.clear();
  }
}
