import { Argv } from "yargs";
import * as deploy from "./deploy";
import * as ls from "./ls";
import * as ps from "./ps";
import * as rm from "./rm";
import * as services from "./services";

export const command = "stack";
export const description = "Manage Swarm stacks";

export const builder = (yargs: Argv) =>
  yargs.command([deploy, ls, ps, rm, services]).demandCommand();

// eslint-disable-next-line @typescript-eslint/no-empty-function
export const handler = () => {};
