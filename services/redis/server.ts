import { BaseService } from "rpc/server";
import { z } from "zod";
import { REDIS as PORT } from "rpc/PORTS";
import { maybeZodErrorMessage } from "lib/error";
import { API, SetOptions, SetResult } from "./types";
import { Minimatch } from "minimatch";

const BASEDIR = "data/redis";

const DB = z.record(z.union([z.string(), z.set(z.string())]));
type DB = z.infer<typeof DB>;

export class RedisService extends BaseService implements API {
  private dbs: Record<number, DB> = {};

  override getPortNumber() {
    return PORT;
  }

  override setup() {
    for (const db of [0, 1, 2, 3, 4]) {
      this.ensureDb(db);
    }
    return Promise.resolve();
  }

  dbFile(db: number) {
    return `${BASEDIR}/${db.toString()}.json.txt`;
  }

  readDb(db: number): DB {
    const raw = this.ns.read(this.dbFile(db));
    if (raw === "") {
      return {};
    }
    try {
      return z
        .record(
          z.union([
            z.string(),
            z
              .string()
              .array()
              .transform((x) => new Set(x)),
          ])
        )
        .pipe(DB)
        .parse(JSON.parse(raw));
    } catch (error) {
      this.log.terror("read-db-error", { error: maybeZodErrorMessage(error) });
      throw error;
    }
  }

  ensureDb(db: number): DB {
    const fromCache = this.dbs[db];
    if (typeof fromCache !== "undefined") {
      return fromCache;
    }
    const fromDisk = this.readDb(db);
    this.dbs[db] = fromDisk;
    return fromDisk;
  }

  writeDb(db: number) {
    this.ns.write(
      this.dbFile(db),
      JSON.stringify(this.dbs[db], (_, value) =>
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        value instanceof Set ? Array.from(value) : value
      ),
      "w"
    );
  }

  get: (db: number, key: string) => string | null = API.shape.get.implement(
    (dbNumber, key) => {
      const db = this.ensureDb(dbNumber);
      if (key in db) {
        return z.string().parse(db[key]);
      }
      return null;
    }
  );

  set: (
    db: number,
    key: string,
    value: string,
    options?: SetOptions
  ) => SetResult = API.shape.set.implement(
    (dbNumber, key, value, options = {}) => {
      const db = this.ensureDb(dbNumber);

      let oldValue: string | undefined | null;
      if (options.get === true) {
        oldValue = z.string().nullish().parse(db[key]);
      }
      db[key] = value;
      this.writeDb(dbNumber);
      if (options.get === true) {
        return { setResultType: "GET", oldValue: oldValue ?? null };
      } else {
        return { setResultType: "OK" };
      }
    }
  );

  del: (db: number, keys: [string, ...string[]]) => number =
    API.shape.del.implement((dbNumber, keys) => {
      const db = this.ensureDb(dbNumber);
      let removed = 0;
      for (const key of keys) {
        if (key in db) {
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
          delete db[key];
          removed++;
        }
      }
      this.writeDb(dbNumber);
      return removed;
    });

  mset: (db: number, keyValues: Record<string, string>) => "OK" =
    API.shape.mset.implement((dbNumber, keyValues) => {
      const db = this.ensureDb(dbNumber);
      for (const [key, value] of Object.entries(keyValues)) {
        db[key] = value;
      }
      this.writeDb(dbNumber);
      return "OK";
    });

  mget: (db: number, keys: [string, ...string[]]) => (string | null)[] =
    API.shape.mget.implement((dbNumber, keys) => {
      const db = this.ensureDb(dbNumber);
      const values: (string | null)[] = [];
      for (const key of keys) {
        values.push(z.string().nullish().parse(db[key]) ?? null);
      }
      return values;
    });

  keys: (db: number, pattern: string) => string[] = API.shape.keys.implement(
    (dbNumber, pattern) => {
      const db = this.ensureDb(dbNumber);
      const keys = [];
      const mm = new Minimatch(pattern);
      for (const key of Object.keys(db)) {
        if (mm.match(key)) {
          keys.push(key);
        }
      }
      return keys;
    }
  );

  private lookupSet(db: DB, key: string): Set<string> {
    return z.set(z.string()).parse(db[key] ?? new Set());
  }

  sadd: (db: number, key: string, values: [string, ...string[]]) => number =
    API.shape.sadd.implement((dbNumber, key, values) => {
      const db = this.ensureDb(dbNumber);

      const set = this.lookupSet(db, key);
      let added = 0;
      for (const value of values) {
        if (!set.has(value)) {
          set.add(value);
          added++;
        }
      }

      db[key] = set;
      this.writeDb(dbNumber);

      return added;
    });

  smembers: (db: number, key: string) => string[] =
    API.shape.smembers.implement((dbNumber, key) => {
      const db = this.ensureDb(dbNumber);
      const set = this.lookupSet(db, key);
      return Array.from(set);
    });

  srem: (db: number, key: string, values: [string, ...string[]]) => number =
    API.shape.srem.implement((dbNumber, key, values) => {
      const db = this.ensureDb(dbNumber);

      const set = this.lookupSet(db, key);
      let removed = 0;
      for (const value of values) {
        if (set.delete(value)) {
          removed++;
        }
      }

      this.writeDb(dbNumber);

      return removed;
    });
}
