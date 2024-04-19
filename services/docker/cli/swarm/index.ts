import { Argv } from "yargs";
import * as join from "./join";

export const command = "swarm";
export const description = "Manage Swarm";

export const builder = (yargs: Argv) => yargs.command([join]).demandCommand();

// eslint-disable-next-line @typescript-eslint/no-empty-function
export const handler = () => {};
