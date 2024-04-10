import { CliContext } from "lib/cli";
import { dockerClient } from "services/docker/client";
import { ArgumentsCamelCase, Argv } from "yargs";

export const command = "rm <service>";
export const aliases = ["remove"];
export const describe = "Remove a service";
// TODO allow removing multiple services with one call

interface RmOptions {
  service: string;
}

export const builder = (yargs: Argv<CliContext>) =>
  yargs.positional("service", {
    type: "string",
    describe: "Service name",
    demandOption: true,
  });

export const handler = async ({
  ns,
  service,
}: ArgumentsCamelCase<CliContext & RmOptions>) => {
  const docker = dockerClient(ns);
  await docker.serviceDelete(service);
};
