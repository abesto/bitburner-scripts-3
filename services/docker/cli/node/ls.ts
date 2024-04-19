import { CliContext } from "lib/cli";
import { dockerClient } from "services/docker/client";
import { ArgumentsCamelCase } from "yargs";

export const command = "ls";
export const aliases = ["list"];
export const describe = "List nodes in the swarm";

export const handler = async ({
  ns,
  log,
  fmt,
}: ArgumentsCamelCase<CliContext>) => {
  const docker = dockerClient(ns);
  const capacity = await docker.swarmCapacity();
  capacity.hosts.sort(([, { max: maxA }], [, { max: maxB }]) => maxB - maxA);
  log.tinfo(
    "\n" +
      fmt
        .table(
          ["HOST", "MAX", "USED", "FREE", "LABELS"],
          ...capacity.hosts.map(([node, { max, used }]) => [
            node.hostname,
            fmt.memory(max),
            fmt.memory(used),
            fmt.memory(max - used),
            Object.entries(node.labels)
              .map(([key, value]) => `${key}=${value}`)
              .join(", "),
          ]),
          [
            "TOTAL",
            fmt.memory(capacity.total.max),
            fmt.memory(capacity.total.used),
            fmt.memory(capacity.total.max - capacity.total.used),
            "",
          ]
        )
        .join("\n")
  );
};
