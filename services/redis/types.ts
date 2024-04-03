import { z } from "zod";

export const RedisValue = z.union([z.string(), z.number()]);
export type RedisValue = z.infer<typeof RedisValue>;

export const API = z.object({
  get: z
    .function()
    .args(z.number().describe("db"), z.string().describe("key"))
    .returns(RedisValue.nullable()),

  set: z
    .function()
    .args(z.number().describe("db"), z.string().describe("key"), RedisValue)
    .returns(z.string()),
});
export type API = z.infer<typeof API>;
