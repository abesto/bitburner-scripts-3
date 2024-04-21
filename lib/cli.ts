import { Argv } from "yargs";
import yargs from "yargs/browser";
import { Fmt } from "./fmt";
import { Log } from "./log";
import { z } from "zod";
import { maybeZodErrorMessage } from "./error";

export interface CliContext {
  ns: NS;
  log: Log;
  fmt: Fmt;
}

export const cliContext = (ns: NS, name: string): CliContext => {
  return {
    ns,
    log: new Log(ns, name),
    fmt: new Fmt(ns),
  };
};

export const makeCli = (opts: { name: string; describe: string }) =>
  (yargs() as Argv<CliContext>)
    .usage(`Usage: $0 <command> [options]\n\n${opts.describe}`)
    .scriptName(opts.name)
    .strict()
    .demandCommand()
    .wrap(120);

export const parseNsArgs: (ns: NS) => string[] = (ns) =>
  z
    .union([z.string(), z.number(), z.boolean()])
    .transform((x) => x.toString())
    .array()
    .parse(ns.args);

export const cliMain =
  (name: string, cli: Argv<CliContext>) => async (ns: NS) => {
    const rawArgs = parseNsArgs(ns);

    const ctx = cliContext(ns, name);

    try {
      return await cli.parse(rawArgs, ctx, (err, argv, output) => {
        if (err && output.length > 0) {
          ctx.log.terror(output);
        } else if (output.length > 0) {
          ctx.log.tinfo(output);
        }
      });
    } catch (e) {
      ctx.log.terror(maybeZodErrorMessage(e));
      console.error(`cli:${name}`, e);
    }
  };
