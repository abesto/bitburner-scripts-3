import { z } from "zod";

export const SetResult = z.discriminatedUnion("setResultType", [
  z.object({ setResultType: z.literal("OK") }),
  z.object({
    setResultType: z.literal("GET"),
    oldValue: z.string().nullable(),
  }),
]);
export type SetResult = z.infer<typeof SetResult>;

export const SetOptions = z.object({
  get: z.boolean().optional(),
});
export type SetOptions = z.infer<typeof SetOptions>;

export const API = z.object({
  get: z
    .function()
    .args(z.number().describe("db"), z.string().describe("key"))
    .returns(z.string().nullable()),

  set: z
    .function()
    .args(
      z.number().describe("db"),
      z.string().describe("key"),
      z.string().describe("value"),
      SetOptions.optional()
    )
    .returns(SetResult),

  del: z
    .function()
    .args(
      z.number().describe("db"),
      z.string().array().nonempty().describe("keys")
    )
    .returns(z.number().describe("number of keys removed")),

  mset: z
    .function()
    .args(
      z.number().describe("db"),
      z.record(z.string().describe("key"), z.string().describe("value"))
    )
    .returns(z.literal("OK")),

  mget: z
    .function()
    .args(
      z.number().describe("db"),
      z.string().array().describe("keys").nonempty()
    )
    .returns(z.string().nullable().array()),

  keys: z
    .function()
    .args(z.number().describe("db"), z.string().describe("pattern"))
    .returns(z.string().array()),

  sadd: z
    .function()
    .args(
      z.number().describe("db"),
      z.string().describe("key"),
      z.string().array().describe("values").nonempty()
    )
    .returns(z.number().describe("number of new members added")),

  smembers: z
    .function()
    .args(z.number().describe("db"), z.string().describe("key"))
    .returns(z.string().array()),

  srem: z
    .function()
    .args(
      z.number().describe("db"),
      z.string().describe("key"),
      z.string().array().describe("values").nonempty()
    )
    .returns(z.number().describe("number of members removed")),
});
export type API = z.infer<typeof API>;
