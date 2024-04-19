import { CliContext } from "lib/cli";
import { dockerClient } from "services/docker/client";
import { ArgumentsCamelCase } from "yargs";

export const command = "ls";
export const aliases = ["list"];
export const describe = "List stacks";

export const handler = async ({
  ns,
  log,
  fmt,
}: ArgumentsCamelCase<CliContext>) => {
  const docker = dockerClient(ns);
  const services = await docker.serviceList({});

  const serviceCount = new Map<string, number>();
  for (const service of services) {
    const stack = service.spec.labels["com.docker.stack.namespace"];
    if (stack) {
      serviceCount.set(stack, (serviceCount.get(stack) || 0) + 1);
    }
  }

  log.tinfo(
    "\n" +
      fmt
        .table(
          ["ID", "SERVICES"],
          ...Array.from(serviceCount.entries()).map(([id, services]) => [
            id,
            services.toString(),
          ])
        )
        .join("\n")
  );
};
