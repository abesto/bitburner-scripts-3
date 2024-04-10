import { CliContext } from "lib/cli";
import { dockerClient } from "services/docker/client";
import { ArgumentsCamelCase } from "yargs";

export const command = "join <server>";
export const describe = "Join swarm as a node";

export const handler = async ({
  ns,
  server,
}: ArgumentsCamelCase<CliContext & { server: string }>) => {
  const docker = dockerClient(ns);
  await docker.swarmJoin(server);
};
