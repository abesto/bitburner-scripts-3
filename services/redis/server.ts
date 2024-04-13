import { BaseService } from "rpc/server";
import { REDIS as PORT } from "rpc/PORTS";
import {
  API,
  RawStream,
  SetOptions,
  SetResult,
  StreamEntry,
  StreamID,
  XReadRequest,
  XReadResponse,
  XaddThreshold,
} from "./types";
import { Minimatch } from "minimatch";
import { CachedRedisStorage, IRedisStorage, TYPE_NAMES } from "./storage";
import { Stream } from "./stream";
import { TimerManager } from "lib/TimerManager";
import { generateId } from "lib/id";

class XReadSubscriber {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  cancelTimeout: () => void = () => {};

  constructor(
    readonly id: string,
    private readonly buffer: Map<string, [StreamID, StreamEntry][]>,
    private readonly count: number,
    private readonly doRespond: (entries: XReadResponse) => Promise<void>
  ) {}

  xadd(key: string, streamId: StreamID, streamEntry: StreamEntry) {
    const buffer = this.buffer.get(key);
    if (!buffer) {
      return;
    }
    if (buffer.length >= this.count) {
      return;
    }
    buffer.push([streamId, streamEntry]);
  }

  isFulfilled() {
    for (const [, buffer] of this.buffer) {
      if (buffer.length < this.count) {
        return false;
      }
    }
    return true;
  }

  respond() {
    const entries: [string, [StreamID, StreamEntry]][] = [];
    for (const [key, buffer] of this.buffer) {
      for (const entry of buffer) {
        entries.push([key, entry]);
      }
    }
    return this.doRespond(Object.fromEntries(this.buffer.entries()));
  }

  keys() {
    return this.buffer.keys();
  }
}

class XReadBlockManager {
  private readonly subscribers: Map<string, Map<string, XReadSubscriber>>; // key -> random subscriber id -> subscriber

  constructor(private readonly timers: TimerManager) {
    this.subscribers = new Map();
  }

  xread(
    db: number,
    request: XReadRequest,
    buffer: Map<string, [StreamID, StreamEntry][]>,
    respond: (response: XReadResponse) => Promise<void>
  ) {
    if (request.block === undefined) {
      return;
    }
    for (const [key] of request.streams) {
      if (!buffer.has(key)) {
        buffer.set(key, []);
      }
    }

    let subscriberId = generateId(16);
    while (this.subscribers.has(subscriberId)) {
      subscriberId = generateId(16);
    }
    const subscriber = new XReadSubscriber(
      subscriberId,
      buffer,
      request.count ?? Infinity,
      respond
    );
    subscriber.cancelTimeout = this.timers.setTimeout(async () => {
      await this.resolve(subscriber);
    }, request.block);

    for (const [key] of request.streams) {
      const subscribers = this.subscribers.get(`${db.toString()}:${key}`);
      if (!subscribers) {
        this.subscribers.set(`${db.toString()}:${key}`, new Map());
      }
      this.subscribers
        .get(`${db.toString()}:${key}`)
        ?.set(subscriberId, subscriber);
    }
  }

  async xadd(
    db: number,
    key: string,
    streamId: StreamID,
    streamEntry: StreamEntry
  ) {
    const subscribers = this.subscribers.get(`${db.toString()}:${key}`);
    if (!subscribers) {
      return;
    }

    for (const [, subscriber] of subscribers.entries()) {
      subscriber.xadd(key, streamId, streamEntry);
      if (subscriber.isFulfilled()) {
        await this.resolve(subscriber);
      }
    }
  }

  async resolve(subscriber: XReadSubscriber) {
    subscriber.cancelTimeout();
    await subscriber.respond();
    for (const key of subscriber.keys()) {
      this.subscribers.get(key)?.delete(subscriber.id);
    }
  }

  async timeout(db: number, key: string, id: string) {
    const subscribers = this.subscribers.get(`${db.toString()}:${key}`);
    if (!subscribers) {
      return;
    }
    const subscriber = subscribers.get(id);
    if (!subscriber) {
      return;
    }
    await this.resolve(subscriber);
  }

  flushdb(db: number) {
    for (const [key, subscribers] of this.subscribers.entries()) {
      if (key.startsWith(`${db.toString()}:`)) {
        for (const [, subscriber] of subscribers.entries()) {
          subscriber.cancelTimeout();
        }
        this.subscribers.delete(key);
      }
    }
  }
}

export class RedisService extends BaseService implements API {
  private readonly xreadBlockManager: XReadBlockManager;

  constructor(
    ns: NS,
    private readonly storage: IRedisStorage = new CachedRedisStorage(ns)
  ) {
    super(ns);
    this.xreadBlockManager = new XReadBlockManager(this.timers);
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
    this.xreadBlockManager.flushdb(db);
    return "OK";
  });

  xread: (db: number, request: XReadRequest) => XReadResponse =
    API.shape.xread.implement((db, request) => {
      const response = new Map<string, [StreamID, StreamEntry][]>();
      for (const [key, id] of request.streams) {
        const stream = this.storage.read(db, "stream", key);
        if (stream === null) {
          response.set(key, []);
          continue;
        }

        if (id === "$") {
          response.set(key, []);
          continue;
        }
        const entries = stream.range(id, "+", request.count);
        if (entries[0]?.[0] === id) {
          entries.shift();
        }
        response.set(key, entries);
      }

      if (request.block !== undefined) {
        this.xreadBlockManager.xread(
          db,
          request,
          response,
          async (response) => {
            await this.respond(response);
          }
        );
      }

      return Object.fromEntries(response.entries());
    });
}
