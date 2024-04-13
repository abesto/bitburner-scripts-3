import { rpcClient } from "rpc/client";
import { REDIS as PORT } from "rpc/PORTS";
import { API } from "./types";

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

  const ext = {
    select: (newDb: number) => (db = newDb),
    currentDb: () => db,
  };

  const boundMethods = Object.fromEntries(
    API.keyof().options.map((name) => [
      name,
      (...args: BoundDb<Parameters<(typeof inner)[typeof name]>>) =>
        // @ts-expect-error I give up /shrug
        inner[name](db, ...args),
    ])
  );

  return { ...ext, ...boundMethods } as BoundDbAPI<typeof inner> & typeof ext;
};
export type RedisClient = ReturnType<typeof redisClient>;
