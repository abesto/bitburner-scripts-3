import { ScriptArg } from "NetscriptDefinitions";
import { Log } from "lib/log";
import { redisClient } from "services/redis/client";
import { z } from "zod";
import { API, SetOptions, SetResult } from "services/redis/types";
import { highlightJSON } from "lib/fmt";
import { errorMessage } from "lib/error";

export const main = async (ns: NS) => {
  const log = new Log(ns, "redis-cli");

  const renderResult = (result: unknown): string => {
    if (result === null) {
      return "(nil)";
    }

    if (Array.isArray(result)) {
      if (result.length === 0) {
        return "(empty list or set)";
      }
      return result
        .map((value, index) => `(${index.toString()}) ${renderResult(value)}`)
        .join("\n");
    }

    try {
      const setResult = SetResult.parse(result);
      if (setResult.setResultType === "OK") {
        return setResult.setResultType;
      } else {
        return renderResult(setResult.oldValue);
      }
    } catch {
      /* empty */
    }

    if (typeof result !== "string") {
      return `(${typeof result}) ${highlightJSON(result)}`;
    }

    return highlightJSON(result);
  };

  const params = ns.flags([["db", 0]]);
  const db = z.number().parse(params.db);

  const [rawCommand, ...args] = (params._ || []) as ScriptArg[];
  const command = API.keyof().parse(rawCommand);

  const redis = redisClient(ns, db);
  if (!Reflect.has(redis, command)) {
    log.terror("cli: invalid command", { command });
    return;
  }

  const extraArgs = [];

  if (command === "set") {
    const setOptions = SetOptions.parse({});
    while (args.length > 2) {
      const arg = args.splice(2, 1).toString().toUpperCase();
      if (arg === "GET") {
        setOptions.get = true;
      } else {
        log.terror("cli: invalid set option", {
          option: arg,
          remainingArgs: args,
        });
        return;
      }
    }
    extraArgs.push(setOptions);
  }

  if (command === "sadd") {
    const values = args.splice(1) as string[];
    extraArgs.push(values);
  }

  try {
    // @ts-expect-error This is ugly, but it's good enough for the CLI
    // eslint-disable-next-line @typescript-eslint/await-thenable, @typescript-eslint/no-unsafe-assignment
    const result = await redis[command](...args, ...extraArgs);
    ns.tprintf(renderResult(result));
  } catch (error) {
    log.terror("server: " + errorMessage(error));
  }
};
