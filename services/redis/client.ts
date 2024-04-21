import { rpcClient } from "rpc/client";
import { REDIS as PORT } from "rpc/PORTS";
import { API, RawStream, XReadRequest, XReadResponse } from "./types";

export const rawRedisClient = (ns: NS) => rpcClient<API>(ns, PORT);

type BoundDb<T> = T extends [number, ...infer U] ? U : never;
type BoundDbFunction<T> = T extends (db: number, ...rest: infer U) => infer R
  ? (...args: U) => R
  : never;
type BoundDbAPI<T> = {
  [K in keyof T]: BoundDbFunction<T[K]>;
};

export const redisClient = (ns: NS, db = 0) => {
  const inner = rawRedisClient(ns);

  const boundMethods = Object.fromEntries(
    API.keyof().options.map((name) => [
      name,
      (...args: BoundDb<Parameters<(typeof inner)[typeof name]>>) =>
        // @ts-expect-error I give up /shrug
        inner[name](db, ...args),
    ])
  );

  const ext = {
    select: (newDb: number) => (db = newDb),
    currentDb: () => db,
    xread: (request: XReadRequest): Promise<XReadResponse> => {
      if (request.block === undefined) {
        return inner.xread(db, request);
      } else {
        return inner.withReadOptions({ timeout: request.block + 5000 }, () =>
          inner.xread(db, request)
        );
      }
    },
  };

  return { ...boundMethods, ...ext } as BoundDbAPI<typeof inner> & typeof ext;
};
export type RedisClient = ReturnType<typeof redisClient>;

export class StreamSubscriber<T> {
  private lastSeen = "$";

  constructor(
    private readonly redis: ReturnType<typeof redisClient>,
    private readonly stream: string,
    private readonly parse: (event: unknown) => T
  ) {}

  async poll(block?: number, count?: number): Promise<T[]> {
    const streams = await this.redis.xread({
      streams: [[this.stream, this.lastSeen]],
      block,
      count: count ?? (block === undefined ? undefined : 1),
    });
    const stream: RawStream = streams[this.stream] ?? [];
    if (stream.length === 0) {
      return [];
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    this.lastSeen = stream[stream.length - 1]![0];
    return stream.map(([, kvs]) =>
      this.parse(Object.fromEntries(kvs.map(([k, v]) => [k, JSON.parse(v)])))
    );
  }
}
