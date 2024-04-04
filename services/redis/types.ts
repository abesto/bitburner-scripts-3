import { TrieMap } from "mnemonist";
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

export const StreamEntry = z.record(z.string());
export type StreamEntry = z.infer<typeof StreamEntry>;

export const streamIdRegex = /^(\d+)-(\d+)$/;
export const StreamID = z.string().refine((s) => streamIdRegex.test(s), {
  message: "Invalid stream ID",
});
export type StreamID = z.infer<typeof StreamID>;

export type Stream = TrieMap<string, StreamEntry>;
export const Stream = z.custom<Stream>((val) => val instanceof TrieMap, {
  message: "Not a TrieMap",
});

const db = z.number().describe("db");
const key = z.string().describe("key");

export const API = z.object({
  get: z
    .function()
    .args(z.number().describe("db"), z.string().describe("key"))
    .returns(z.string().nullable()),

  set: z
    .function()
    .args(db, key, z.string().describe("value"), SetOptions.optional())
    .returns(SetResult),

  del: z
    .function()
    .args(db, key.array().nonempty())
    .returns(z.number().describe("number of keys removed")),

  mset: z
    .function()
    .args(db, z.record(key, z.string().describe("value")))
    .returns(z.literal("OK")),

  mget: z
    .function()
    .args(db, key.array().nonempty())
    .returns(z.string().nullable().array()),

  keys: z
    .function()
    .args(db, z.string().describe("pattern"))
    .returns(z.string().array()),

  sadd: z
    .function()
    .args(db, key, z.string().array().describe("values").nonempty())
    .returns(z.number().describe("number of new members added")),

  smembers: z.function().args(db, key).returns(z.string().array()),

  srem: z
    .function()
    .args(db, key, z.string().array().describe("values").nonempty())
    .returns(z.number().describe("number of members removed")),

  xadd: z
    .function()
    .args(
      db,
      key,
      z.union([z.literal("*"), StreamID]).describe("stream id"),
      z.record(z.string()).describe("field - value 'pairs'")
    )
    .returns(z.string()),

  xlen: z.function().args(db, key).returns(z.number()),
});
export type API = z.infer<typeof API>;
