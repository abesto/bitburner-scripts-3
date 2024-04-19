import { CliContext } from "lib/cli";
import { dockerClient } from "services/docker/client";
import { ArgumentsCamelCase, Argv } from "yargs";
import { parseLabels } from "../common";

export const command = "update <node>";
export const describe = "Update a node";

interface UpdateOptions {
  node: string;
  ["label-add"]?: string[];
  ["label-rm"]?: string[];
}

export const builder = (
  yargs: Argv<CliContext>
): Argv<CliContext & UpdateOptions> =>
  yargs
    .positional("node", {
      type: "string",
      describe: "Node ID or hostname",
      demandOption: true,
    })
    .option("label-add", {
      type: "array",
      describe: "Add or update a node label (key=value)",
    })
    .option("label-rm", {
      type: "array",
      describe: "Remove a node label if exists",
    }) as Argv<CliContext & UpdateOptions>;

export const handler = async ({
  ns,
  log,
  node: nodeIdOrName,
  labelAdd,
  labelRm,
}: ArgumentsCamelCase<CliContext & UpdateOptions>) => {
  const docker = dockerClient(ns);
  const node = await docker.nodeInspect(nodeIdOrName);
  const labels = node.labels;

  for (const [key, value] of Object.entries(parseLabels(labelAdd ?? []))) {
    labels[key] = value;
  }

  for (const key of labelRm ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete labels[key];
  }
  console.log("labels", labels);

  await docker.nodeUpdate(node.id, node.version, labels);
  log.tinfo(`Updated ${nodeIdOrName}`);
};
