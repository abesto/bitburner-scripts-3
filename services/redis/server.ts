import { BaseService } from "rpc/server";
import { REDIS as PORT } from "rpc/PORTS";
import { API, SetOptions, SetResult } from "./types";
import { Minimatch } from "minimatch";
import { CachedRedisStorage } from "./storage";

export class RedisService extends BaseService implements API {
  private storage: CachedRedisStorage;

  constructor(ns: NS) {
    super(ns);
    this.storage = new CachedRedisStorage(ns);
  }

  override getPortNumber() {
    return PORT;
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
  ) => SetResult = API.shape.set.implement((db, key, value, options = {}) => {
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
      const set = this.storage.read(db, "set", key);

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
      return Array.from(this.storage.read(db, "set", key));
    });

  srem: (db: number, key: string, values: [string, ...string[]]) => number =
    API.shape.srem.implement((db, key, values) => {
      const set = this.storage.read(db, "set", key);

      let removed = 0;
      for (const value of values) {
        if (set.delete(value)) {
          removed++;
        }
      }

      this.storage.write(db, "set", key, set);
      return removed;
    });
}
