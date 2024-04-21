import { EventMultiplexer, EventProvider } from "rpc/server";
import {
  RedisClient,
  StreamSubscriber,
  redisClient,
} from "services/redis/client";
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
    let success = false;
    ns.atExit(() => void submitExitCode(ns, success));
    const result = await fn(ns);
    success = true;
    return result;
  };

export class ExitCodeSubscriber extends StreamSubscriber<ExitCodeEvent> {
  constructor(redis: ReturnType<typeof redisClient>) {
    super(redis, KEY, (event) => ExitCodeEvent.parse(event));
  }
}

export const ExitCodeServerEvent = ExitCodeEvent.extend({
  type: z.literal("exitcode"),
});
export type ExitCodeServerEvent = z.infer<typeof ExitCodeServerEvent>;

export class ExitCodeEventProvider
  implements EventProvider<ExitCodeServerEvent>
{
  private subscriber: ExitCodeSubscriber;
  private queue: ExitCodeEvent[] = [];

  constructor(ns: NS, private readonly block: number) {
    this.subscriber = new ExitCodeSubscriber(redisClient(ns));
  }

  next: () => Promise<ExitCodeServerEvent> = async () => {
    this.queue = this.queue.concat(await this.subscriber.poll());
    while (this.queue.length === 0) {
      this.queue = this.queue.concat(await this.subscriber.poll(this.block));
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return { type: "exitcode", ...this.queue.shift()! };
  };
}

export const useExitCodeEvents = (opts: {
  ns: NS;
  multiplexer: EventMultiplexer<ExitCodeServerEvent>;
  block: number;
  handler: (pid: number, success: boolean) => Promise<void> | void;
}) => {
  const provider = new ExitCodeEventProvider(opts.ns, opts.block);
  opts.multiplexer.registerProvider(provider);
  opts.multiplexer.registerHandler("exitcode", async (event) =>
    opts.handler(event.pid, event.success)
  );
};
