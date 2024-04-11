import { RedisClient, redisClient } from "services/redis/client";
import { z } from "zod";

export const ExitCodeEvent = z.object({
  pid: z.number(),
  success: z.boolean(),
});
export type ExitCodeEvent = z.infer<typeof ExitCodeEvent>;

const KEY = "exitcode";

export const submitExitCode = async (
  ns: NS,
  success: boolean,
  redis?: RedisClient
) => {
  if (!redis) {
    redis = redisClient(ns);
  }
  await redis.xadd(
    KEY,
    "*",
    [
      ["pid", JSON.stringify(ns.pid)],
      ["success", JSON.stringify(success)],
    ],
    { type: "maxlen", count: 10 }
  );
};

export const withExitCode =
  <R>(fn: (ns: NS) => Promise<R>) =>
  async (ns: NS): Promise<R> => {
    try {
      const result = await fn(ns);
      await submitExitCode(ns, true);
      return result;
    } catch (error) {
      await submitExitCode(ns, false);
      throw error;
    }
  };

export class ExitCodeSubscriber {
  private readonly redis: RedisClient;
  private lastSeen = "-";

  constructor(ns: NS) {
    this.redis = redisClient(ns);
  }

  async poll(): Promise<ExitCodeEvent[]> {
    const stream = await this.redis.xrange(KEY, "(" + this.lastSeen, "+");
    if (stream.length === 0) {
      return [];
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    this.lastSeen = stream[stream.length - 1]![0];
    return stream.map(([, kvs]) =>
      ExitCodeEvent.parse(
        Object.fromEntries(kvs.map(([k, v]) => [k, JSON.parse(v)]))
      )
    );
  }
}
