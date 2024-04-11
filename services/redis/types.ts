import { z } from "zod";
import { Stream } from "./stream";

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

export const StreamEntry = z
  .tuple([z.string().describe("field"), z.string().describe("value")])
  .array();
export type StreamEntry = z.infer<typeof StreamEntry>;

export const streamIdRegex = /^(\d+)-(\d+)$/;
export const StreamID = z.string().refine((s) => streamIdRegex.test(s), {
  message: "Invalid stream ID",
});
export type StreamID = z.infer<typeof StreamID>;

export const RawStream = z.tuple([StreamID, StreamEntry]).array();
export type RawStream = z.infer<typeof RawStream>;

export const XaddThreshold = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("maxlen"),
    count: z.number(),
  }),
  z.object({
    type: z.literal("minid"),
    id: StreamID,
  }),
]);
export type XaddThreshold = z.infer<typeof XaddThreshold>;

export const streamSchema = z.custom<Stream>(
  (value) => value instanceof Stream,
  {
    message: "Not an instance of Stream",
  }
);

const db = z.number().describe("db");
const key = z.string().describe("key");

export const XReadRequest = z.object({
  count: z.number().optional(),
  block: z.number().optional().describe("ms"),
  streams: z.tuple([key, z.string()]).array().nonempty(),
});
export type XReadRequest = z.infer<typeof XReadRequest>;

export const XReadResponse = z.record(key, RawStream);
export type XReadResponse = z.infer<typeof XReadResponse>;

export const API = z.object({
  get: z
    .function()
    .args(z.number().describe("db"), z.string().describe("key"))
    .returns(z.string().nullable()),

  set: z
    .function()
    .args(db, key, z.string().describe("value"), SetOptions)
    .returns(SetResult),

  exists: z.function().args(db, key.array().nonempty()).returns(z.number()),

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
      StreamEntry,
      XaddThreshold.optional()
    )
    .returns(z.string()),

  xlen: z.function().args(db, key).returns(z.number()),

  xrange: z
    .function()
    .args(
      db,
      key,
      z.string().describe("start"),
      z.string().describe("end"),
      z.number().describe("count")
    )
    .returns(RawStream),

  type: z
    .function()
    .args(db, key)
    .returns(
      z.union([
        z.literal("string"),
        z.literal("set"),
        z.literal("stream"),
        z.literal("list"),
        z.literal("none"),
        z.literal("zset"),
        z.literal("hash"),
      ])
    ),

  flushdb: z.function().args(db).returns(z.literal("OK")),

  xread: z.function().args(db, XReadRequest).returns(XReadResponse),
});
export type API = z.infer<typeof API>;
