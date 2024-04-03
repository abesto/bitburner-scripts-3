import { BaseService } from "rpc/server";
import { z } from "zod";
import { REDIS as PORT } from "rpc/PORTS";
import { maybeZodErrorMessage } from "lib/error";
import { API, RedisValue } from "./types";

const BASEDIR = "data/redis";

const DB = z.record(RedisValue);
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
    return db[key] ?? null;
  });

  set = API.shape.set.implement((dbNumber, key, value) => {
    const db = this.ensureDb(dbNumber);
    db[key] = value;
    this.writeDb(dbNumber);
    return "OK";
  });
}
