import { cliMain } from "lib/cli";
import { withExitCode } from "lib/exitcode";

export const main = withExitCode(
  cliMain({
    name: "sleep",
    describe: "Sleep for a number of seconds",
    commands: [
      {
        command: "sleep <seconds>",
        describe: "Sleep for a number of seconds",
        builder: (yargs) =>
          yargs.positional("seconds", { type: "number", demandOption: true }),
        handler: async ({ ns, seconds }) => {
          await ns.sleep(seconds * 1000);
        },
      },
    ],
  })
);
