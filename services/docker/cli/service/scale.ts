import { CliContext } from "lib/cli";
import { dockerClient } from "services/docker/client";
import { ArgumentsCamelCase, Argv } from "yargs";
import { z } from "zod";

export const command = "scale <spec>";
export const describe = "Scale a replicated service";
// TODO allow removing multiple services with one call

interface ScaleOptions {
  spec: string;
}

export const builder = (
  yargs: Argv<CliContext>
): Argv<CliContext & ScaleOptions> =>
  yargs.positional("spec", {
    type: "string",
    describe: "service=replicas",
    demandOption: true,
  });

export const handler = async ({
  ns,
  log,
  spec,
}: ArgumentsCamelCase<CliContext & ScaleOptions>) => {
  const [serviceIdOrName, replicas] = z
    .tuple([
      z.string(),
      z
        .string()
        .transform((s) => parseInt(s, 10))
        .pipe(z.number()),
    ])
    .parse(spec.split("="));

  const docker = dockerClient(ns);
  const service = await docker.serviceInspect(serviceIdOrName);
  if (service.spec.mode.type !== "replicated") {
    throw new Error(
      `Service ${service.spec.name} (${service.id}) is not replicated: ${service.spec.mode.type}`
    );
  }

  service.spec.mode.replicas = replicas;
  await docker.serviceUpdate(service.id, service.version, service.spec);

  log.tinfo(`${serviceIdOrName} scaled to ${replicas.toString()}`);
};
