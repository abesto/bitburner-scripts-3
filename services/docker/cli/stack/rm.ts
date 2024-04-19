import { CliContext } from "lib/cli";
import { dockerClient } from "services/docker/client";
import { LABELS } from "services/docker/constants";
import { Service } from "services/docker/types";
import { ArgumentsCamelCase, Argv } from "yargs";

export const command = "rm <stack..>";
export const aliases = ["remove", "down"];
export const describe = "Remove one or more stacks";

interface RmOptions {
  stack: string[];
}

export const builder = (
  yargs: Argv<CliContext>
): Argv<CliContext & RmOptions> =>
  yargs.positional("stack", {
    type: "string",
    array: true,
    describe: "Stack name",
    demandOption: true,
  });

export const handler = async ({
  ns,
  log,
  stack: stacks,
}: ArgumentsCamelCase<CliContext & RmOptions>) => {
  const docker = dockerClient(ns);

  let services: Service[] = [];
  for (const stack of stacks) {
    const stackServices = await docker.serviceList({
      label: { [LABELS.STACK_NAMESPACE]: stack },
    });
    services = services.concat(stackServices);
  }

  for (const service of services) {
    log.tinfo(`Removing service ${service.spec.name} (${service.id})`);
    await docker.serviceDelete(service.id);
  }
};
