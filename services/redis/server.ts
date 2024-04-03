import { BaseService } from "rpc/server";
import { z } from "zod";
import { REDIS as PORT } from "rpc/PORTS";
import { maybeZodErrorMessage } from "lib/error";
import { API, SetOptions } from "./types";
import { Minimatch } from "minimatch";

const BASEDIR = "data/redis";

const DB = z.record(z.string());
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
      return DB.parse(JSON.parse(raw));
    } catch (error) {
      this.log.terror("read-db-error", { error: maybeZodErrorMessage(error) });
      return {};
    }
  }

  ensureDb(db: number): DB {
    if (!(db in this.dbs)) {
      this.dbs[db] = this.readDb(db);
    }
    return this.dbs[db];
  }

  writeDb(db: number) {
    this.ns.write(this.dbFile(db), JSON.stringify(this.dbs[db]), "w");
  }

  get = API.shape.get.implement((dbNumber, key) => {
    const db = this.ensureDb(dbNumber);
    if (key in db) {
      return db[key];
    }
    return null;
  });

  set = API.shape.set.implement(
    (dbNumber, key, value, options = SetOptions.parse({})) => {
      const db = this.ensureDb(dbNumber);
      const oldValue = key in db ? db[key] : null;
      db[key] = value;
      this.writeDb(dbNumber);
      if (options.get) {
        return { setResultType: "GET", oldValue };
      } else {
        return { setResultType: "OK" };
      }
    }
  );

  keys = API.shape.keys.implement((dbNumber, pattern) => {
    const db = this.ensureDb(dbNumber);
    const keys = [];
    const mm = new Minimatch(pattern);
    for (const key of Object.keys(db)) {
      if (mm.match(key)) {
        keys.push(key);
      }
    }
    return keys;
  });
}
