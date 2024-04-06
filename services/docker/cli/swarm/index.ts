import { Argv } from "yargs";
import * as capacity from "./capacity";
import * as join from "./join";

export const command = "swarm";
export const description = "Manage Swarm";

export const builder = (yargs: Argv) =>
  yargs.command([capacity, join]).demandCommand();

// eslint-disable-next-line @typescript-eslint/no-empty-function
export const handler = () => {};
