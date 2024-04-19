import { CliContext } from "lib/cli";
import { dockerClient } from "services/docker/client";
import { LABELS } from "services/docker/constants";
import { ServiceWithStatus } from "services/docker/types";
import { ArgumentsCamelCase, Argv } from "yargs";
import { printServiceList } from "../common";

export const command = "services <stack>";
export const describe = "List the services in the stack";

interface ServicesOptions {
  stack: string;
}

export const builder = (
  yargs: Argv<CliContext>
): Argv<CliContext & ServicesOptions> =>
  yargs.positional("stack", {
    type: "string",
    describe: "Stack name",
    demandOption: true,
  });

export const handler = async ({
  ns,
  log,
  fmt,
  stack,
}: ArgumentsCamelCase<CliContext & ServicesOptions>) => {
  const docker = dockerClient(ns);

  const services: ServiceWithStatus[] = await docker.serviceList({
    label: { [LABELS.STACK_NAMESPACE]: stack },
  });
  printServiceList(log, fmt, services);
};
