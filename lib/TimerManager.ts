import { z } from "zod";
import { generateId } from "./id";
import { EventMultiplexer, EventProvider } from "rpc/server";

interface Interval {
  lastRun: number;
  interval: number;
  callback: () => void | Promise<void>;
}

interface Timeout {
  timestamp: number;
  callback: () => void | Promise<void>;
}

export class TimerManager {
  private readonly intervals: Interval[] = [];
  private readonly timeouts: Map<string, Timeout>;

  constructor() {
    this.timeouts = new Map();
  }

  setInterval(callback: () => void | Promise<void>, ms: number): void {
    const syntheticLastRun = Math.floor(Date.now() / ms) * ms;
    this.intervals.push({ lastRun: syntheticLastRun, interval: ms, callback });
  }

  setTimeout(callback: () => void | Promise<void>, ms: number): () => void {
    let id = generateId(16);
    while (this.timeouts.has(id)) {
      id = generateId(16);
    }
    this.timeouts.set(id, { timestamp: Date.now() + ms, callback });
    return () => {
      this.timeouts.delete(id);
    };
  }

  getTimeUntilNextEvent(): number {
    const now = Date.now();
    return Math.min(
      ...this.intervals.map((interval) => {
        const next = interval.lastRun + interval.interval;
        return Math.max(0, next - now);
      }),
      ...Array.from(this.timeouts.values()).map((timeout: Timeout) =>
        Math.max(timeout.timestamp - Date.now())
      )
    );
  }

  async invoke(): Promise<void> {
    const now = Date.now();
    for (const interval of this.intervals) {
      if (now >= interval.lastRun + interval.interval) {
        interval.lastRun = now;
        await interval.callback();
      }
    }
    for (const [id, timeout] of this.timeouts) {
      if (now >= timeout.timestamp) {
        this.timeouts.delete(id);
        await timeout.callback();
      }
    }
  }
}

export const TimerEvent = z.object({
  type: z.literal("timer"),
});
export type TimerEvent = z.infer<typeof TimerEvent>;
const TIMER_EVENT: TimerEvent = { type: "timer" };

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
  ns: NS,
  multiplexer: EventMultiplexer<TimerEvent>
) => {
  const timers = new TimerEventProvider(ns);
  multiplexer.registerProvider(timers);
  multiplexer.registerHandler("timer", async () => {
    await timers.invoke();
  });
  return timers;
};
