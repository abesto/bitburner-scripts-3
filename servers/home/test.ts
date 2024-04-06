import { Log } from "lib/log";
import { ArgumentsCamelCase, Argv } from "yargs";
import yargs from "yargs/browser";
import { z } from "zod";

export const main = async (ns: NS) => {
  const log = new Log(ns, "test");

  const rawArgs = z.string().array().parse(ns.args);
  await yargs()
    .command(
      "select <color>",
      "Select a color to display",
      (args: Argv) => {
        return args.positional("color", {
          type: "string",
          describe: "The color to display. e.g.) Blue to display blue",
        });
      },
      (args: ArgumentsCamelCase<{ color: string }>) => {
        ns.tprint("oi!" + JSON.stringify(args));
      }
    )
    .help()
    .demandCommand()
    .strict()
    .parse(rawArgs, {}, (err, argv, output) => {
      if (err) {
        log.terror(output);
        return;
      }
      ns.tprint("huh!" + JSON.stringify(argv));
      log.tinfo(output);
    });

  return;
};
