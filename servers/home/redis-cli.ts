import { ScriptArg } from "NetscriptDefinitions";
import { Log } from "lib/log";
import { redisClient } from "services/redis/client";
import { z } from "zod";
import { API } from "services/redis/types";
import { highlightValue } from "lib/fmt";
import { errorMessage } from "lib/error";

export const main = async (ns: NS) => {
  const log = new Log(ns, "redis-cli");

  const params = ns.flags([["db", 0]]);
  const db = z.number().parse(params.db);

  const [rawCommand, ...args] = (params._ || []) as ScriptArg[];
  const command = API.keyof().parse(rawCommand);

  const redis = redisClient(ns, db);
  if (!Reflect.has(redis, command)) {
    log.terror("cli: invalid command", { command });
    return;
  }
  try {
    // @ts-expect-error This is ugly, but it's good enough for the CLI
    const result = await redis[command](...args);
    if (command === "get") {
      log.tinfo(`(${typeof result}) ${highlightValue(result)}`);
    } else {
      log.tinfo(highlightValue(result));
    }
  } catch (error) {
    log.terror("server: " + errorMessage(error));
  }
};
