import { rpcClient } from "rpc/client";
import { REDIS as PORT } from "rpc/PORTS";
import type { RedisService } from "./server";

export const rawRedisClient = (ns: NS) => rpcClient<RedisService>(ns, PORT);

// I tried really hard to do this with a Proxy, but getting the types right
// is probably not possible.
export const redisClient = (ns: NS, db = 0) => {
  const inner = rawRedisClient(ns);

  return {
    // Client operations
    select: (newDb: number) => (db = newDb),
    getPortNumber: inner.getPortNumber,
    currentDb: () => db,
    // Actual Redis commands
    get: inner.get.bind(inner, db),
    set: inner.set.bind(inner, db),
  };
};
