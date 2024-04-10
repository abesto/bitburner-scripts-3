import { Argv } from "yargs";
import * as ls from "./ls";
import * as ps from "./ps";
import * as create from "./create";
import * as rm from "./rm";
import * as inspect from "./inspect";
import { CliContext } from "lib/cli";

export const command = "service";
export const description = "Manage Swarm services";

export const builder = (yargs: Argv<CliContext>) =>
  yargs
    .command(create)
    .command(ls)
    .command(inspect)
    .command(ps)
    .command(rm)
    .demandCommand();

// eslint-disable-next-line @typescript-eslint/no-empty-function
export const handler = () => {};
