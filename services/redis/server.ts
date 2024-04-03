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

  getPortNumber() {
    return PORT;
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
        .record(z.union([z.string(), z.string().array()]))
        .transform((x) => (Array.isArray(x) ? new Set(x) : x))
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

  sadd: (db: number, key: string, values: [string, ...string[]]) => number =
    API.shape.sadd.implement((dbNumber, key, values) => {
      const db = this.ensureDb(dbNumber);

      const set = z.set(z.string()).parse(db[key] ?? new Set());
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
      const set = z.set(z.string()).parse(db[key] ?? new Set());
      return Array.from(set);
    });
}
