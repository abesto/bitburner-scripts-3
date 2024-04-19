import { Argv } from "yargs";
import * as ls from "./ls";
import * as update from "./update";
import * as inspect from "./inspect";
import { CliContext } from "lib/cli";

export const command = "node";
export const description = "Manage Swarm nodes";

export const builder = (yargs: Argv<CliContext>) =>
  yargs.command(inspect).command(ls).command(update).demandCommand();

// eslint-disable-next-line @typescript-eslint/no-empty-function
export const handler = () => {};
