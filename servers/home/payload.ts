import { cliMain, makeCli } from "lib/cli";
import { withExitCode } from "lib/exitcode";
import { Log } from "lib/log";
import { ArgumentsCamelCase } from "yargs";

export const main = withExitCode(
  cliMain(
    "payload",
    makeCli({
      name: "payload",
      describe: "Simple payloads to execute across servers",
    })
      .command({
        command: "sleep <seconds>",
        describe: "Sleep for a number of seconds",
        builder: (yargs) =>
          yargs.positional("seconds", { type: "number", demandOption: true }),
        handler: async ({ ns, seconds }) => {
          await ns.sleep(seconds * 1000);
        },
      })
      .command({
        command: "hack <hostname>",
        describe: "Hack a target server",
        builder: (yargs) =>
          yargs.positional("hostname", { type: "string", demandOption: true }),
        handler: async ({
          ns,
          log,
          hostname,
        }: ArgumentsCamelCase<{ ns: NS; log: Log; hostname: string }>) => {
          log.info(`Hacking ${hostname}`);
          await ns.hack(hostname);
        },
      })
      .command({
        command: "grow <hostname>",
        describe: "Grow a target server",
        builder: (yargs) =>
          yargs.positional("hostname", { type: "string", demandOption: true }),
        handler: async ({
          ns,
          log,
          hostname,
        }: ArgumentsCamelCase<{ ns: NS; log: Log; hostname: string }>) => {
          log.info(`Growing ${hostname}`);
          await ns.grow(hostname);
        },
      })
      .command({
        command: "weaken <hostname>",
        describe: "Weaken a target server",
        builder: (yargs) =>
          yargs.positional("hostname", { type: "string", demandOption: true }),
        handler: async ({
          ns,
          log,
          hostname,
        }: ArgumentsCamelCase<{ ns: NS; log: Log; hostname: string }>) => {
          log.info(`Weakening ${hostname}`);
          await ns.weaken(hostname);
        },
      })
  )
);
