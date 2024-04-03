interface Interval {
  lastRun: number;
  interval: number;
  callback: () => void | Promise<void>;
}

export class TimerManager {
  private intervals: Interval[] = [];

  setInterval(callback: () => void | Promise<void>, ms: number): void {
    const syntheticLastRun = Math.floor(Date.now() / ms) * ms;
    this.intervals.push({ lastRun: syntheticLastRun, interval: ms, callback });
  }

  getTimeUntilNextEvent(): number {
    const now = Date.now();
    return Math.min(
      ...this.intervals.map((interval) => {
        const next = interval.lastRun + interval.interval;
        return Math.max(0, next - now);
      })
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
  }
}
