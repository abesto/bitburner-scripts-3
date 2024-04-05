import { z } from "zod";
import RedisConfig from "./configlib-redis/RedisConfig";
import { LogLevel } from "./log";

const rawShape = {
  foo: z.string(),
  bar: z.number(),
  baz: z.boolean(),
};
export const ConfigShape = z.object(rawShape);
export type ConfigShape = z.infer<typeof ConfigShape>;

const defaults: ConfigShape = {
  foo: "default",
  bar: 42,
  baz: false,
};

const mkConfig = (ns: NS) => new RedisConfig(ns, rawShape, defaults);

export const LOGLEVELS: Record<string, LogLevel> = {
  "rpcClient:2": LogLevel.INFO,
};

export default mkConfig;
