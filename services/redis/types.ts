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

  keys: z
    .function()
    .args(z.number().describe("db"), z.string().describe("pattern"))
    .returns(z.string().array()),
});
export type API = z.infer<typeof API>;
