import { generateId } from "./id";

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
      ...Array.from(this.timeouts.values()).map(
        (timeout: Timeout) => timeout.timestamp
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
