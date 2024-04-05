import { z } from "zod";
import { RawStream, streamSchema } from "./types";
import { Stream } from "./stream";

const BASEDIR = "data/redis";

const literalSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
type Literal = z.infer<typeof literalSchema>;
type Json = Literal | { [key: string]: Json } | Json[];
const jsonSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([literalSchema, z.array(jsonSchema), z.record(jsonSchema)])
);
const parseJson = z
  .string()
  .transform((s) => JSON.parse(s) as Json)
  .pipe(jsonSchema);
const stringifyJson = <T>(x: T): string => JSON.stringify(x);

// Internal Redis representations
const INTERNAL = {
  string: z.string(),
  set: z.set(z.string()),
  stream: streamSchema,
};
export const TYPE_NAMES: (keyof typeof INTERNAL)[] = Object.keys(
  INTERNAL
) as (keyof typeof INTERNAL)[];
// JSON string -> internal Redis representation
const DESER = {
  string: parseJson.pipe(z.string()),
  set: parseJson
    .transform((json) => (json === null ? [] : json))
    .pipe(z.string().array())
    .transform((a) => new Set(a)),
  stream: parseJson.pipe(RawStream).transform((json) => new Stream(json)),
};
// Internal Redis representation -> JSON string
const SER = {
  string: INTERNAL.string.transform(stringifyJson),
  set: INTERNAL.set.transform((s) => Array.from(s)).transform(stringifyJson),
  stream: INTERNAL.stream.transform((s) => s.toJSON()).transform(stringifyJson),
};

export interface IRedisStorage {
  read<T extends keyof typeof INTERNAL>(
    db: number,
    type: T,
    key: string
  ): (z.output<(typeof INTERNAL)[T]> & z.output<(typeof DESER)[T]>) | null;
  write<T extends keyof typeof INTERNAL>(
    db: number,
    type: T,
    key: string,
    value: z.input<(typeof SER)[T]> & z.input<(typeof INTERNAL)[T]>
  ): void;
  del(db: number, keys: string[]): number;
  keys(db: number): string[];
}

export class RedisStorage implements IRedisStorage {
  constructor(private readonly ns: NS) {}

  path(db: number, key: string): string {
    return `${BASEDIR}/${db.toString()}/${key}.txt`;
  }

  read<T extends keyof typeof INTERNAL>(
    db: number,
    type: T,
    key: string
  ): (z.output<(typeof INTERNAL)[T]> & z.output<(typeof DESER)[T]>) | null {
    const path = this.path(db, key);
    if (!this.ns.fileExists(path)) {
      return null;
    }
    return DESER[type].parse(this.ns.read(path));
  }

  write<T extends keyof typeof INTERNAL>(
    db: number,
    type: T,
    key: string,
    value: z.input<(typeof SER)[T]> & z.input<(typeof INTERNAL)[T]>
  ): void {
    this.ns.write(this.path(db, key), SER[type].parse(value), "w");
  }

  del(db: number, keys: string[]): number {
    let removed = 0;
    for (const key of keys) {
      if (this.ns.fileExists(this.path(db, key))) {
        this.ns.rm(this.path(db, key));
        removed++;
      }
    }
    return removed;
  }

  keys(db: number): string[] {
    const prefix = `${BASEDIR}/${db.toString()}/`;
    const suffix = ".txt";
    return this.ns
      .ls(this.ns.getHostname(), `${BASEDIR}/${db.toString()}`)
      .map((path) => path.slice(prefix.length, -suffix.length));
  }
}

export class CachedRedisStorage implements IRedisStorage {
  private readonly storage: RedisStorage;
  private readonly cache: Map<string, unknown>;

  constructor(ns: NS) {
    this.storage = new RedisStorage(ns);
    this.cache = new Map();
  }

  cacheKey(db: number, key: string): string {
    return `${db.toString()}:${key}`;
  }

  read<T extends keyof typeof INTERNAL>(
    db: number,
    type: T,
    key: string
  ): (z.output<(typeof INTERNAL)[T]> & z.output<(typeof DESER)[T]>) | null {
    const cacheKey = this.cacheKey(db, key);
    if (this.cache.has(cacheKey)) {
      const cachedValue = this.cache.get(cacheKey);
      if (cachedValue === null) {
        return null;
      }
      return INTERNAL[type].parse(this.cache.get(cacheKey));
    }
    const value = this.storage.read(db, type, key);
    this.cache.set(cacheKey, value);
    return value;
  }

  write<T extends keyof typeof INTERNAL>(
    db: number,
    type: T,
    key: string,
    value: z.input<(typeof SER)[T]> & z.input<(typeof INTERNAL)[T]>
  ): void {
    const parsed = INTERNAL[type].parse(value);
    this.storage.write(db, type, key, parsed);
    const cacheKey = this.cacheKey(db, key);
    this.cache.set(cacheKey, parsed);
  }

  del(db: number, keys: string[]): number {
    const removed = this.storage.del(db, keys);
    for (const key of keys) {
      this.cache.delete(this.cacheKey(db, key));
    }
    return removed;
  }

  keys(db: number): string[] {
    return this.storage.keys(db);
  }
}

export class MemoryRedisStorage implements IRedisStorage {
  private readonly storage: Map<string, unknown>;

  constructor() {
    this.storage = new Map();
  }

  read<T extends keyof typeof INTERNAL>(
    db: number,
    type: T,
    key: string
  ): (z.output<(typeof INTERNAL)[T]> & z.output<(typeof DESER)[T]>) | null {
    const value = this.storage.get(`${db}:${key}`);
    if (value === undefined) {
      return null;
    }
    return DESER[type].parse(value);
  }

  write<T extends keyof typeof INTERNAL>(
    db: number,
    type: T,
    key: string,
    value: z.input<(typeof SER)[T]> & z.input<(typeof INTERNAL)[T]>
  ): void {
    this.storage.set(`${db}:${key}`, SER[type].parse(value));
  }

  del(db: number, keys: string[]): number {
    let removed = 0;
    for (const key of keys) {
      if (this.storage.has(`${db}:${key}`)) {
        this.storage.delete(`${db}:${key}`);
        removed++;
      }
    }
    return removed;
  }

  keys(db: number): string[] {
    return Array.from(this.storage.keys())
      .filter((key) => key.startsWith(`${db}:`))
      .map((key) => key.split(":")[1] as string);
  }
}
