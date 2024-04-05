import { ScriptArg } from "NetscriptDefinitions";
import { Log } from "lib/log";
import { redisClient } from "services/redis/client";
import { z } from "zod";
import { API, SetOptions, SetResult } from "services/redis/types";
import { highlightJSON } from "lib/fmt";
import { errorMessage, maybeZodErrorMessage } from "lib/error";

export const main = async (ns: NS) => {
  const log = new Log(ns, "redis-cli");

  const renderResult = (result: unknown, indentSize = 0): string => {
    if (result === null) {
      return "(nil)";
    }

    if (Array.isArray(result)) {
      const indent = " ".repeat(indentSize);

      if (result.length === 0) {
        return indent + "(empty list or set)";
      }
      const nextIndentSize = indentSize + result.length.toString().length + 2;
      return result
        .map(
          (value, index) =>
            `${index === 0 ? "" : indent}${(
              index + 1
            ).toString()}) ${renderResult(value, nextIndentSize)}`
        )
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

  type StreamID = string;
  type StreamFV = [string, string];
  type StreamEntry = [StreamID, StreamFV[]];
  type Stream = StreamEntry[];
  type FlatStreamEntry = [StreamID, string[]];
  type FlatStream = FlatStreamEntry[];

  const transformStreamReply = (stream: Stream): FlatStream =>
    stream.map(([id, entries]) => [
      id,
      entries.flatMap(([field, value]) => [field, value]),
    ]);

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

  const buildKeyValues = (keyValuesRaw: unknown): Record<string, string> => {
    const keyValues = z.string().array().parse(keyValuesRaw);
    const obj: Record<string, string> = {};
    for (let i = 0; i < args.length; i += 2) {
      const key = z.string().safeParse(keyValues[i]);
      const value = z.string().safeParse(keyValues[i + 1]);
      if (!key.success || !value.success) {
        log.terror("cli: invalid key/field or value", {
          key: keyValues[i],
          value: keyValues[i + 1],
          error:
            (key.success ? "" : maybeZodErrorMessage(key.error)) +
            (value.success ? "" : maybeZodErrorMessage(value.error)),
        });
        throw new Error("Invalid key/field or value");
      }
    }
    return obj;
  };

  const buildKeyValueTuples = (keyValuesRaw: unknown): StreamFV[] => {
    const keyValues = z.string().array().parse(keyValuesRaw);
    const obj: StreamFV[] = [];
    for (let i = 0; i < keyValues.length; i += 2) {
      const field = z.string().safeParse(keyValues[i]);
      const value = z.string().safeParse(keyValues[i + 1]);
      if (!field.success || !value.success) {
        log.terror("cli: invalid field or value", {
          field: keyValues[i],
          value: keyValues[i + 1],
          error:
            (field.success ? "" : maybeZodErrorMessage(field.error)) +
            (value.success ? "" : maybeZodErrorMessage(value.error)),
        });
        throw new Error("Invalid field or value");
      }
      obj.push([field.data, value.data]);
    }
    return obj;
  };

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
  } else if (command === "sadd" || command === "srem") {
    const values = args.splice(1) as string[];
    extraArgs.push(values);
  } else if (command === "del" || command === "mget") {
    extraArgs.push(args.splice(0));
  } else if (command === "mset") {
    const obj = buildKeyValues(args.splice(0));
    extraArgs.push(obj);
  } else if (command === "xadd") {
    const obj = buildKeyValueTuples(args.splice(2));
    extraArgs.push(obj);
  }

  try {
    // @ts-expect-error This is ugly, but it's good enough for the CLI
    // eslint-disable-next-line @typescript-eslint/await-thenable, @typescript-eslint/no-unsafe-assignment
    let result: unknown = await redis[command](...args, ...extraArgs);

    if (command === "xrange") {
      console.log(result);
      result = transformStreamReply(result as Stream);
    }

    ns.tprintf(renderResult(result));
  } catch (error) {
    log.terror("server: " + errorMessage(error));
  }
};
