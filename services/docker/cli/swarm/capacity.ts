import { CliContext } from "lib/cli";
import { dockerClient } from "services/docker/client";
import { ArgumentsCamelCase } from "yargs";

export const command = "capacity";
export const describe = "[Bitburner] Describe available capacity";

export const handler = async ({
  ns,
  log,
  fmt,
}: ArgumentsCamelCase<CliContext>) => {
  const docker = dockerClient(ns);
  const capacity = await docker.swarmCapacity();
  const entries = Object.entries(capacity.hosts);
  entries.sort(([, { max: maxA }], [, { max: maxB }]) => maxB - maxA);
  log.tinfo(
    "\n" +
      fmt
        .table(
          ["HOST", "MAX", "USED", "FREE"],
          ...entries.map(([hostname, { max, used }]) => [
            hostname,
            fmt.memory(max),
            fmt.memory(used),
            fmt.memory(max - used),
          ]),
          [
            "TOTAL",
            fmt.memory(capacity.total.max),
            fmt.memory(capacity.total.used),
            fmt.memory(capacity.total.max - capacity.total.used),
          ]
        )
        .join("\n")
  );
};
