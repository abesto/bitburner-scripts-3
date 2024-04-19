import { CliContext } from "lib/cli";
import { dockerClient } from "services/docker/client";
import { ArgumentsCamelCase, Argv } from "yargs";

export const command = "inspect <node>";
export const describe = "Display detailed information on a node";
// TODO allow inspecting tasks of multiple node in a single call

interface InspectOptions {
  node: string;
}

export const builder = (
  yargs: Argv<CliContext>
): Argv<CliContext & InspectOptions> =>
  yargs.positional("node", {
    type: "string",
    describe: "Node id or name",
    demandOption: true,
  });

export const handler = async ({
  ns,
  log,
  node,
}: ArgumentsCamelCase<CliContext & InspectOptions>) => {
  const docker = dockerClient(ns);
  const nodeObj = await docker.nodeInspect(node);
  log.tinfo("\n" + JSON.stringify(nodeObj, undefined, 2));
};
