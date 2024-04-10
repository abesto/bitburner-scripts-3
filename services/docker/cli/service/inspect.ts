import { CliContext } from "lib/cli";
import { dockerClient } from "services/docker/client";
import { ArgumentsCamelCase, Argv } from "yargs";

export const command = "inspect <service>";
export const describe = "Display detailed information on a service";
// TODO allow inspecting tasks of multiple services in a single call

interface InspectOptions {
  service: string;
}

export const builder = (
  yargs: Argv<CliContext>
): Argv<CliContext & InspectOptions> =>
  yargs.positional("service", {
    type: "string",
    describe: "Service id or name",
    demandOption: true,
  });

export const handler = async ({
  ns,
  log,
  service,
}: ArgumentsCamelCase<CliContext & InspectOptions>) => {
  const docker = dockerClient(ns);
  const serviceObj = await docker.serviceInspect(service);
  log.tinfo("\n" + JSON.stringify(serviceObj, undefined, 2));
};
