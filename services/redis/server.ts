import { BaseService } from "rpc/server";
import { REDIS as PORT } from "rpc/PORTS";
import {
  API,
  RawStream,
  SetOptions,
  SetResult,
  StreamEntry,
  StreamID,
  XaddThreshold,
} from "./types";
import { Minimatch } from "minimatch";
import { CachedRedisStorage, IRedisStorage, TYPE_NAMES } from "./storage";
import { Stream } from "./stream";
import { TimerManager } from "lib/TimerManager";

export class RedisService extends BaseService implements API {
  constructor(
    ns: NS,
    private readonly storage: IRedisStorage = new CachedRedisStorage(ns)
  ) {
    super(ns);
  }

  override getPortNumber() {
    return PORT;
  }

  protected override registerTimers(timers: TimerManager): void {
    timers.setInterval(() => {
      this.storage.persist();
    }, 1000);
  }

  get: (db: number, key: string) => string | null = API.shape.get.implement(
    (db, key) => {
      return this.storage.read(db, "string", key);
    }
  );

  set: (
    db: number,
    key: string,
    value: string,
    options?: SetOptions
  ) => SetResult = (db, key, value, options) =>
    API.shape.set.implement((db, key, value, options) => {
      let oldValue: string | undefined | null;
      if (options.get === true) {
        oldValue = this.storage.read(db, "string", key);
      }
      this.storage.write(db, "string", key, value);
      if (options.get === true) {
        return { setResultType: "GET", oldValue: oldValue ?? null };
      } else {
        return { setResultType: "OK" };
      }
    })(db, key, value, options ?? {});

  exists: (db: number, keys: [string, ...string[]]) => number =
    API.shape.exists.implement((db, keys) => {
      let count = 0;
      for (const key of keys) {
        if (this.storage.read(db, "string", key) !== null) {
          count++;
        }
      }
      return count;
    });

  del: (db: number, keys: [string, ...string[]]) => number =
    API.shape.del.implement((db, keys) => {
      return this.storage.del(db, keys);
    });

  mset: (db: number, keyValues: Record<string, string>) => "OK" =
    API.shape.mset.implement((db, keyValues) => {
      for (const [key, value] of Object.entries(keyValues)) {
        this.storage.write(db, "string", key, value);
      }
      return "OK";
    });

  mget: (db: number, keys: [string, ...string[]]) => (string | null)[] =
    API.shape.mget.implement((db, keys) => {
      const values: (string | null)[] = [];
      for (const key of keys) {
        try {
          values.push(this.storage.read(db, "string", key));
        } catch {
          values.push(null);
        }
      }
      return values;
    });

  keys: (db: number, pattern: string) => string[] = API.shape.keys.implement(
    (db, pattern) => {
      const keys = [];
      const mm = new Minimatch(pattern);
      for (const key of this.storage.keys(db)) {
        if (mm.match(key)) {
          keys.push(key);
        }
      }
      return keys;
    }
  );

  sadd: (db: number, key: string, values: [string, ...string[]]) => number =
    API.shape.sadd.implement((db, key, values) => {
      const set = this.storage.read(db, "set", key) ?? new Set<string>();

      let added = 0;
      for (const value of values) {
        if (!set.has(value)) {
          set.add(value);
          added++;
        }
      }

      this.storage.write(db, "set", key, set);

      return added;
    });

  smembers: (db: number, key: string) => string[] =
    API.shape.smembers.implement((db, key) => {
      const set = this.storage.read(db, "set", key);
      if (set === null) {
        return [];
      }
      return Array.from(set);
    });

  srem: (db: number, key: string, values: [string, ...string[]]) => number =
    API.shape.srem.implement((db, key, values) => {
      const set = this.storage.read(db, "set", key);
      if (set === null) {
        return 0;
      }

      let removed = 0;
      for (const value of values) {
        if (set.delete(value)) {
          removed++;
        }
      }

      this.storage.write(db, "set", key, set);
      return removed;
    });

  xadd: (
    db: number,
    key: string,
    streamId: StreamID,
    fieldValues: StreamEntry,
    threshold?: XaddThreshold
  ) => string = (db, key, streamId, fieldValues, threshold) =>
    API.shape.xadd.implement((db, key, streamId, fieldValues) => {
      const stream = this.storage.read(db, "stream", key) ?? new Stream();

      if (streamId === "*") {
        const timestamp = Date.now().toString();
        const existing = stream.prefix(timestamp);
        streamId = `${timestamp}-${existing.length.toString()}`;
      }
      stream.add(streamId, fieldValues);

      if (threshold?.type === "maxlen") {
        stream.trimMaxLength(threshold.count);
      } else if (threshold?.type === "minid") {
        stream.trimMinId(threshold.id);
      }

      this.storage.write(db, "stream", key, stream);
      return streamId;
    })(db, key, streamId, fieldValues, threshold);

  xlen: (db: number, key: string) => number = API.shape.xlen.implement(
    (db, key) => {
      return this.storage.read(db, "stream", key)?.length || 0;
    }
  );

  xrange: (
    db: number,
    key: string,
    start: string,
    end?: string,
    count?: number
  ) => RawStream = (db, key, start, end, count) =>
    API.shape.xrange.implement((db, key, start, end, count) => {
      const stream = this.storage.read(db, "stream", key);
      if (stream === null) {
        return [];
      }

      const startExclusive = start[0] === "(";
      const endExclusive = end[0] === "(";
      if (startExclusive) {
        start = start.slice(1);
      }
      if (endExclusive) {
        end = end.slice(1);
      }

      const entries = stream.range(start, end, count);
      if (startExclusive && entries[0]?.[0] === start) {
        entries.shift();
      }
      if (endExclusive && entries[entries.length - 1]?.[0] === end) {
        entries.pop();
      }
      return entries;
    })(db, key, start, end ?? "+", count ?? Infinity);

  type: (db: number, key: string) => "string" | "set" | "stream" | "none" =
    API.shape.type.implement((db, key) => {
      for (const type of TYPE_NAMES) {
        try {
          if (this.storage.read(db, type, key) !== null) {
            return type;
          }
        } catch {
          // That's fine, try something else
        }
      }
      return "none";
    });

  flushdb: (db: number) => "OK" = API.shape.flushdb.implement((db) => {
    for (const key of this.storage.keys(db)) {
      this.storage.del(db, [key]);
    }
    return "OK";
  });
}
