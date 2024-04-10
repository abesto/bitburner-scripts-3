import { Argv, CommandModule } from "yargs";
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

export const cliMain =
  <U>(mod: {
    name: string;
    describe: string;
    commands: CommandModule<CliContext, U>[];
  }) =>
  async (ns: NS) => {
    const rawArgs = z
      .union([z.string(), z.number(), z.boolean()])
      .transform((x) => x.toString())
      .array()
      .parse(ns.args);

    const ctx = cliContext(ns, mod.name);

    try {
      return await (yargs() as Argv<CliContext>)
        .usage(`Usage: $0 <command> [options]\n\n${mod.describe}`)
        .scriptName(mod.name)
        .command(mod.commands)
        .strict()
        .demandCommand()
        .wrap(120)
        .parse(rawArgs, cliContext(ns, mod.name), (err, argv, output) => {
          if (err && output.length > 0) {
            ctx.log.terror(output);
          } else if (output.length > 0) {
            ctx.log.tinfo(output);
          }
        });
    } catch (e) {
      ctx.log.terror(maybeZodErrorMessage(e));
    }
  };
