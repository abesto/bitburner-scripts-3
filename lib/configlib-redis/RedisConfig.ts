import IConfig from "lib/configlib/IConfig";
import { maybeZodErrorMessage } from "lib/error";
import { RedisClient, redisClient } from "services/redis/client";
import { z } from "zod";

// N.B.: transforms etc. on the schema are applied at READ time

type D<T extends z.ZodRawShape> = z.infer<z.ZodObject<T>>;

export default class RedisConfig<T extends z.ZodRawShape>
  implements IConfig<D<T>>
{
  private readonly client: RedisClient;
  private readonly schema: z.ZodObject<T>;

  constructor(ns: NS, rawShape: T, private readonly defaults: D<T>) {
    this.client = redisClient(ns);
    this.schema = z.object(rawShape);
  }

  redisKey<K extends keyof T>(key: K) {
    return `config:${key.toString()}`;
  }

  serialize<K extends keyof T>(key: K, value: D<T>[K]): string {
    if (this.schema.shape[key] instanceof z.ZodString) {
      return value as string;
    } else if (this.schema.shape[key] instanceof z.ZodNumber) {
      return (value as number).toString();
    } else if (this.schema.shape[key] instanceof z.ZodBoolean) {
      return value ? "true" : "false";
    } else {
      throw new Error(`Unknown Zod type for ${key.toString()}`);
    }
  }

  deserialize<K extends keyof T>(key: K, value: string): D<T>[K] {
    if (this.schema.shape[key] instanceof z.ZodString) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return value as D<T>[K];
    } else if (this.schema.shape[key] instanceof z.ZodNumber) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return parseFloat(value) as D<T>[K];
    } else if (this.schema.shape[key] instanceof z.ZodBoolean) {
      // @ts-expect-error Yeah just give up at this point
      return value === "true" ? true : false;
    } else {
      throw new Error(`Unknown Zod type for ${key.toString()}`);
    }
  }

  async get<K extends keyof T>(key: K): Promise<D<T>[K]> {
    const raw = await this.client.get(this.redisKey(key));
    if (raw === null) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return this.defaults[key];
    }
    const value = this.deserialize(key, raw);
    const parseResult = this.schema.shape[key].safeParse(value);
    if (parseResult.success) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return parseResult.data;
    } else {
      throw new Error(
        `Invalid ${key.toString()} in config DB: ${maybeZodErrorMessage(
          parseResult.error
        )}`
      );
    }
  }

  async set<K extends keyof T>(key: K, value: D<T>[K]): Promise<D<T>[K]> {
    if (!(key in this.schema.shape)) {
      throw new Error(`Tried to set unknown key: ${key.toString()}`);
    }
    const parseResult = this.schema.shape[key].safeParse(value);
    if (!parseResult.success) {
      throw new Error(
        `Tried to set invalid ${key.toString()}: ${maybeZodErrorMessage(
          parseResult.error
        )}`
      );
    }
    const resp = await this.client.set(
      this.redisKey(key),
      this.serialize(key, value),
      {
        get: true,
      }
    );
    if (resp.setResultType !== "GET") {
      throw new Error(`Unexpected setResultType: ${resp.setResultType}`);
    }
    if (resp.oldValue !== null) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return this.deserialize(key, resp.oldValue);
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return this.defaults[key];
  }
}
