import { errorMessage } from "lib/error";
import { highlightValue } from "lib/fmt";
import { Log } from "lib/log";
import { rpcClient } from "rpc/client";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import * as PORTS from "rpc/PORTS";
import { constantCase } from "change-case";

const USAGE = `Usage: rpc <port> <method> [args...]

WARNING: use with --ram-override 1.6 (because change-case has a '.exec' somewhere)
Like so:

alias rpc="run rpc.js --ram-override 1.6"
`;

const parseArg = (arg: unknown): unknown => {
  if (typeof arg === "number") {
    return arg;
  }
  try {
    return JSON.parse(arg as string);
  } catch {
    return arg;
  }
};

const parsePort = (raw: number | string): number | undefined => {
  if (typeof raw === "number") {
    return raw;
  }
  const name = constantCase(raw);
  if (name in PORTS) {
    // @ts-expect-error This is ugly, but it's good enough for the CLI
    // eslint-disable-next-line
    return PORTS[name] as number;
  }
};

export const main = async (ns: NS) => {
  const log = new Log(ns, "rpc");
  const parsedArgs = z
    .tuple([z.union([z.number(), z.string()]), z.string()])
    .rest(z.unknown())
    .safeParse(ns.args);

  if (!parsedArgs.success) {
    log.terror(
      "cli: invalid arguments: " + fromZodError(parsedArgs.error).message
    );
    log.tinfo(USAGE);
    return;
  }

  const [portRaw, method, ...rawArgs] = parsedArgs.data;
  const args = rawArgs.map(parseArg);
  const port = parsePort(portRaw);

  if (port === undefined) {
    log.terror("cli: invalid port", { port: portRaw });
    log.tinfo(USAGE);
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = rpcClient<any>(ns, port);
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
    const result = await client[method](...args);
    log.tinfo("response: " + highlightValue(result));
  } catch (error) {
    log.terror("server: " + errorMessage(error));
  }
};
