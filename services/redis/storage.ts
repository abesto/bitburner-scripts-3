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
  exists(db: number, key: string): boolean;
  persist(): void;
}

export class DirectRedisStorage implements IRedisStorage {
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
      if (!this.exists(db, key)) {
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

  exists(db: number, key: string): boolean {
    return this.ns.fileExists(this.path(db, key));
  }

  persist(): void {
    // This implementation writes to disk on each operation, so persist() is a no-op
  }
}

type TypeCache<T extends keyof typeof INTERNAL> = Map<
  string,
  z.output<(typeof INTERNAL)[T]> | null
>;
type DbCache = {
  [T in keyof typeof INTERNAL]: TypeCache<T>;
};
const mkDbCache = (): DbCache =>
  Object.fromEntries(TYPE_NAMES.map((type) => [type, new Map()])) as DbCache;
type MultiDbCache = Map<number, DbCache>;

export class CachedRedisStorage implements IRedisStorage {
  private readonly storage: DirectRedisStorage;
  private readonly cache: MultiDbCache;
  private readonly dirty: Set<[number, keyof typeof INTERNAL, string]>;

  constructor(ns: NS) {
    this.storage = new DirectRedisStorage(ns);
    this.cache = new Map();
    this.dirty = new Set();
  }

  dbCache(db: number): DbCache {
    const existing = this.cache.get(db);
    if (existing !== undefined) {
      return existing;
    }
    const dbCache = mkDbCache();
    this.cache.set(db, dbCache);
    return dbCache;
  }

  getCache<T extends keyof typeof INTERNAL>(db: number, type: T): TypeCache<T> {
    return this.dbCache(db)[type];
  }

  read<T extends keyof typeof INTERNAL>(
    db: number,
    type: T,
    key: string
  ): (z.output<(typeof INTERNAL)[T]> & z.output<(typeof DESER)[T]>) | null {
    const cache = this.getCache(db, type);
    const cachedValue = cache.get(key);

    if (cachedValue !== undefined) {
      if (cachedValue === null) {
        return null;
      }
      return INTERNAL[type].parse(cachedValue);
    }

    const value = this.storage.read(db, type, key);
    cache.set(key, value);
    return value;
  }

  write<T extends keyof typeof INTERNAL>(
    db: number,
    type: T,
    key: string,
    value: z.input<(typeof SER)[T]> & z.input<(typeof INTERNAL)[T]>
  ): void {
    const parsed = INTERNAL[type].parse(value);
    this.dirty.add([db, type, key]);
    this.getCache(db, type).set(key, parsed);
  }

  del(db: number, keys: string[]): number {
    const removed = this.storage.del(db, keys);
    for (const key of keys) {
      for (const type of TYPE_NAMES) {
        this.getCache(db, type).delete(key);
      }
    }
    return removed;
  }

  keys(db: number): string[] {
    return this.storage.keys(db);
  }

  exists(db: number, key: string): boolean {
    for (const type of TYPE_NAMES) {
      if (this.getCache(db, type).has(key)) {
        return true;
      }
    }
    return this.storage.exists(db, key);
  }

  persist() {
    for (const [db, type, key] of this.dirty) {
      const value = this.getCache(db, type).get(key);
      if (value === undefined) {
        // Was written since the last persist(), and was then deleted (and was not re-created)
        continue;
      }
      if (value === null) {
        throw new Error("dirty null value in cache, this should never happen");
      } else {
        this.storage.write(db, type, key, value);
      }
    }
    this.dirty.clear();
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
    const value = this.storage.get(`${db.toString()}:${key}`);
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
    this.storage.set(`${db.toString()}:${key}`, SER[type].parse(value));
  }

  del(db: number, keys: string[]): number {
    let removed = 0;
    for (const key of keys) {
      if (this.storage.has(`${db.toString()}:${key}`)) {
        this.storage.delete(`${db.toString()}:${key}`);
        removed++;
      }
    }
    return removed;
  }

  keys(db: number): string[] {
    return Array.from(this.storage.keys())
      .filter((key) => key.startsWith(`${db.toString()}:`))
      .map((key) => key.split(":")[1] as string);
  }

  exists(db: number, key: string): boolean {
    return this.storage.has(`${db.toString()}:${key}`);
  }

  persist() {
    // No-op
  }
}
