import { NetscriptPort } from "NetscriptDefinitions";
import { Log } from "lib/log";

export interface ClientWriteOptions {
  backoff?: boolean;
}

export class ClientPort {
  private readonly port: NetscriptPort;
  private readonly log: Log;

  constructor(private readonly ns: NS, readonly portNumber: number) {
    this.port = ns.getPortHandle(portNumber);
    this.log = new Log(ns, `ClientPort:${portNumber.toString()}`);
  }

  writeSync(data: unknown): unknown {
    const old: unknown = this.port.write(data);
    if (old !== null) {
      return old;
    }
    return null;
  }

  async write(data: unknown, options?: ClientWriteOptions): Promise<void> {
    const backoff = options?.backoff ?? true;
    let old: unknown = this.port.write(data);
    await this.ns.asleep(0);
    if (!backoff) {
      if (old !== null) {
        this.log.tdebug("Port full", {
          port: this.portNumber,
          dropped: old,
        });
      }
      return;
    }

    // TODO make jitter magnitude and backoffBase configurable
    const jitter = () => Math.floor(Math.random() * 10);
    const backoffBase = 10;
    let backoffExp = 1;
    while (old !== null) {
      await this.ns.sleep(backoffBase ** backoffExp + jitter());
      backoffExp += 1;
      old = this.port.write(old);
      if (backoffExp > 3) {
        this.log.terror("Failed to write to port", {
          port: this.portNumber,
          retries: backoffExp,
        });
      }
    }
    //this.log.debug("Wrote to port", { port: this.portNumber, data });
  }
}
