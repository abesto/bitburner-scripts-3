import { CronExpression, parseExpression } from "cron-parser";
import { ServiceID } from "./types";
import { TimerManager } from "lib/TimerManager";

interface Entry {
  serviceId: ServiceID;
  expression: CronExpression;
  cancel: () => void;
}

export class DockerCrontab {
  private readonly entries = new Map<ServiceID, Entry>();

  constructor(
    private readonly timers: TimerManager,
    private readonly callback: (serviceId: ServiceID) => Promise<void>
  ) {}

  set = (serviceId: ServiceID, expression: string) => {
    const oldEntry = this.entries.get(serviceId);
    if (oldEntry) {
      oldEntry.cancel();
    }
    this.entries.set(serviceId, {
      serviceId,
      expression: parseExpression(expression),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      cancel: () => {},
    });
    this.scheduleNext(serviceId);
  };

  private scheduleNext(serviceId: ServiceID) {
    const entry = this.entries.get(serviceId);
    if (!entry) {
      return;
    }
    const next = entry.expression.next();
    entry.cancel = this.timers.setTimeout(
      this.handle.bind(this, serviceId),
      next.getTime() - Date.now()
    );
  }

  private handle = async (serviceId: ServiceID) => {
    try {
      await this.callback(serviceId);
    } finally {
      this.scheduleNext(serviceId);
    }
  };

  remove = (service: ServiceID) => {
    const entry = this.entries.get(service);
    if (entry) {
      entry.cancel();
      this.entries.delete(service);
    }
  };
}
