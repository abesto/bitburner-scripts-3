import { Argv } from "yargs";
import * as deploy from "./deploy";

export const command = "stack";
export const description = "Manage Swarm stacks";

export const builder = (yargs: Argv) => yargs.command([deploy]).demandCommand();

// eslint-disable-next-line @typescript-eslint/no-empty-function
export const handler = () => {};
