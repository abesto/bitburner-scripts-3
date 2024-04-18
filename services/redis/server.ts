import {
  BaseService,
  EventMultiplexer,
  RequestEvent,
  useRequestEvents,
} from "rpc/server";
import { REDIS as PORT } from "rpc/PORTS";
import {
  API,
  StreamEntry,
  StreamID,
  XReadRequest,
  XReadResponse,
} from "./types";
import { Minimatch } from "minimatch";
import { CachedRedisStorage, IRedisStorage, TYPE_NAMES } from "./storage";
import { Stream } from "./stream";
import {
  TimerEvent,
  TimerEventProvider,
  TimerManager,
  useTimerEvents,
} from "lib/TimerManager";
import { generateId } from "lib/id";
import { APIImpl, Request, Res } from "rpc/types";
import { z } from "zod";
import { ExitCodeServerEvent } from "lib/exitcode";

class XReadSubscriber {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  cancelTimeout: () => void = () => {};

  constructor(
    readonly id: string,
    readonly db: number,
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
  private readonly subscribers: Map<string, Map<string, XReadSubscriber>>; // db:key -> random subscriber id -> subscriber

  constructor(private readonly timers: TimerManager) {
    this.subscribers = new Map();
  }

  async xread(
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
      db,
      buffer,
      request.count ?? Infinity,
      respond
    );

    if (subscriber.isFulfilled()) {
      await subscriber.respond();
      return;
    }

    subscriber.cancelTimeout = this.timers.setTimeout(() => {
      this.resolve(subscriber);
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

  xadd(db: number, key: string, streamId: StreamID, streamEntry: StreamEntry) {
    const subscribers = this.subscribers.get(`${db.toString()}:${key}`);
    if (!subscribers) {
      return;
    }

    for (const [, subscriber] of subscribers.entries()) {
      subscriber.xadd(key, streamId, streamEntry);
      if (subscriber.isFulfilled()) {
        this.resolve(subscriber);
      }
    }
  }

  resolve(subscriber: XReadSubscriber) {
    subscriber.cancelTimeout();
    // Don't *directly* respond in here, because we may be inside of an `xadd`
    // handler, and we don't want to yield control to *another* client.
    this.timers.setTimeout(() => subscriber.respond(), 0);
    for (const key of subscriber.keys()) {
      this.subscribers
        .get(`${subscriber.db.toString()}:${key}`)
        ?.delete(subscriber.id);
    }
  }

  timeout(db: number, key: string, id: string) {
    const subscribers = this.subscribers.get(`${db.toString()}:${key}`);
    if (!subscribers) {
      return;
    }
    const subscriber = subscribers.get(id);
    if (!subscriber) {
      return;
    }
    this.resolve(subscriber);
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

const ServerEvent = z.discriminatedUnion("type", [
  RequestEvent,
  TimerEvent,
  ExitCodeServerEvent,
]);
type ServerEvent = z.infer<typeof ServerEvent>;

export class RedisService
  extends BaseService<ServerEvent>
  implements APIImpl<API>
{
  private readonly xreadBlockManager: XReadBlockManager;
  private readonly timers: TimerEventProvider;

  constructor(
    ns: NS,
    private readonly storage: IRedisStorage = new CachedRedisStorage(ns)
  ) {
    super(ns);
    this.timers = useTimerEvents(
      ns,
      this.eventMultiplexer as EventMultiplexer<TimerEvent>
    );
    useRequestEvents({
      service: this,
      portNumber: PORT,
      clearPort: true,
      multiplexer: this.eventMultiplexer as EventMultiplexer<RequestEvent>,
      ns: this.ns,
      log: this.log,
    });
    this.xreadBlockManager = new XReadBlockManager(this.timers);
  }

  override setup() {
    this.timers.setInterval(() => {
      this.storage.persist();
    }, 1000);
    return Promise.resolve();
  }

  get = async (req: Request, res: Res) => {
    const [db, key] = API.shape.get.parameters().parse(req.args);
    const value = this.storage.read(db, "string", key);
    await res.success(API.shape.get.returnType().parse(value));
  };

  set = async (req: Request, res: Res) => {
    const [db, key, value, options] = API.shape.set
      .parameters()
      .parse(req.args);
    let oldValue: string | undefined | null;
    if (options.get === true) {
      oldValue = this.storage.read(db, "string", key);
    }
    this.storage.write(db, "string", key, value);
    const result =
      options.get === true
        ? { setResultType: "GET", oldValue: oldValue ?? null }
        : { setResultType: "OK" };
    await res.success(API.shape.set.returnType().parse(result));
  };

  exists = async (req: Request, res: Res) => {
    const [db, keys] = API.shape.exists.parameters().parse(req.args);
    let count = 0;
    for (const key of keys) {
      if (this.storage.read(db, "string", key) !== null) {
        count++;
      }
    }
    await res.success(API.shape.exists.returnType().parse(count));
  };

  del = async (req: Request, res: Res) => {
    const [db, keys] = API.shape.del.parameters().parse(req.args);
    const count = this.storage.del(db, keys);
    await res.success(API.shape.del.returnType().parse(count));
  };

  mset = async (req: Request, res: Res) => {
    const [db, keyValues] = API.shape.mset.parameters().parse(req.args);
    for (const [key, value] of Object.entries(keyValues)) {
      this.storage.write(db, "string", key, value);
    }
    await res.success(API.shape.mset.returnType().parse("OK"));
  };

  mget = async (req: Request, res: Res) => {
    const [db, keys] = API.shape.mget.parameters().parse(req.args);
    const values: (string | null)[] = [];
    for (const key of keys) {
      try {
        values.push(this.storage.read(db, "string", key));
      } catch {
        values.push(null);
      }
    }
    await res.success(API.shape.mget.returnType().parse(values));
  };

  keys = async (req: Request, res: Res) => {
    const [db, pattern] = API.shape.keys.parameters().parse(req.args);
    const keys = [];
    const mm = new Minimatch(pattern);
    for (const key of this.storage.keys(db)) {
      if (mm.match(key)) {
        keys.push(key);
      }
    }
    await res.success(API.shape.keys.returnType().parse(keys));
  };

  sadd = async (req: Request, res: Res) => {
    const [db, key, values] = API.shape.sadd.parameters().parse(req.args);
    const set = this.storage.read(db, "set", key) ?? new Set<string>();

    let added = 0;
    for (const value of values) {
      if (!set.has(value)) {
        set.add(value);
        added++;
      }
    }

    this.storage.write(db, "set", key, set);

    await res.success(API.shape.sadd.returnType().parse(added));
  };

  smembers = async (req: Request, res: Res) => {
    const [db, key] = API.shape.smembers.parameters().parse(req.args);
    const set = this.storage.read(db, "set", key);
    const values = set === null ? [] : Array.from(set);
    await res.success(API.shape.smembers.returnType().parse(values));
  };

  srem = async (req: Request, res: Res) => {
    const [db, key, values] = API.shape.srem.parameters().parse(req.args);
    const set = this.storage.read(db, "set", key);

    let removed = 0;

    if (set !== null) {
      for (const value of values) {
        if (set.delete(value)) {
          removed++;
        }
      }
      this.storage.write(db, "set", key, set);
    }

    await res.success(API.shape.srem.returnType().parse(removed));
  };

  scard = async (req: Request, res: Res) => {
    const [db, key] = API.shape.scard.parameters().parse(req.args);
    const set = this.storage.read(db, "set", key);
    const count = set === null ? 0 : set.size;
    await res.success(API.shape.scard.returnType().parse(count));
  };

  xadd = async (req: Request, res: Res) => {
    const [db, key, streamIdInput, fieldValues, threshold] = API.shape.xadd
      .parameters()
      .parse(req.args);
    const stream = this.storage.read(db, "stream", key) ?? new Stream();

    let streamId = streamIdInput;
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
    this.xreadBlockManager.xadd(db, key, streamId, fieldValues);

    await res.success(API.shape.xadd.returnType().parse(streamId));
  };

  xlen = async (req: Request, res: Res) => {
    const [db, key] = API.shape.xlen.parameters().parse(req.args);
    const len = this.storage.read(db, "stream", key)?.length || 0;
    await res.success(API.shape.xlen.returnType().parse(len));
  };

  xrange = async (req: Request, res: Res) => {
    const [db, key, startInput, endInput, count] = API.shape.xrange
      .parameters()
      .parse(req.args);
    const stream = this.storage.read(db, "stream", key);
    if (stream === null) {
      await res.success(API.shape.xrange.returnType().parse([]));
      return;
    }

    const startExclusive = startInput[0] === "(";
    const endExclusive = endInput[0] === "(";
    const start = startExclusive ? startInput.slice(1) : startInput;
    const end = endExclusive ? endInput.slice(1) : endInput;

    const entries = stream.range(start, end, count);
    if (startExclusive && entries[0]?.[0] === start) {
      entries.shift();
    }
    if (endExclusive && entries[entries.length - 1]?.[0] === end) {
      entries.pop();
    }

    await res.success(API.shape.xrange.returnType().parse(entries));
  };

  type = async (req: Request, res: Res) => {
    const [db, key] = API.shape.type.parameters().parse(req.args);
    let ret = "none";
    for (const type of TYPE_NAMES) {
      try {
        if (this.storage.read(db, type, key) !== null) {
          ret = type;
          break;
        }
      } catch {
        // That's fine, try something else
      }
    }
    await res.success(API.shape.type.returnType().parse(ret));
  };

  flushdb = async (req: Request, res: Res) => {
    const [db] = API.shape.flushdb.parameters().parse(req.args);
    for (const key of this.storage.keys(db)) {
      this.storage.del(db, [key]);
    }
    this.xreadBlockManager.flushdb(db);
    await res.success(API.shape.flushdb.returnType().parse("OK"));
  };

  xread = async (req: Request, res: Res) => {
    const [db, request] = API.shape.xread.parameters().parse(req.args);
    const existing = new Map<string, [StreamID, StreamEntry][]>();

    for (const [key, id] of request.streams) {
      const stream = this.storage.read(db, "stream", key);
      if (stream === null) {
        existing.set(key, []);
        continue;
      }
      if (id === "$") {
        existing.set(key, []);
        continue;
      }
      const entries = stream.range(id, "+", request.count);
      if (entries[0]?.[0] === id) {
        entries.shift();
      }
      existing.set(key, entries);
    }

    if (request.block !== undefined) {
      await this.xreadBlockManager.xread(
        db,
        request,
        existing,
        async (response) => {
          await res.success(API.shape.xread.returnType().parse(response));
        }
      );
    } else {
      await res.success(
        API.shape.xread
          .returnType()
          .parse(Object.fromEntries(existing.entries()))
      );
    }
  };
}
