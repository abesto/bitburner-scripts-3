import { CliContext } from "lib/cli";
import { dockerClient } from "services/docker/client";
import { ArgumentsCamelCase } from "yargs";

export const command = "ls";
export const aliases = ["list"];
export const describe = "List services";

export const handler = async ({
  ns,
  log,
  fmt,
}: ArgumentsCamelCase<CliContext>) => {
  const docker = dockerClient(ns);
  const services = await docker.serviceList();
  log.tinfo(
    "\n" +
      fmt
        .table(
          ["ID", "NAME", "THREADS", "SCRIPT", "RESTART"],
          ...services.map((service) => [
            service.id,
            service.spec.name,
            `${service.serviceStatus.runningThreads.toString()}/${service.serviceStatus.desiredThreads.toString()}`,
            service.spec.taskTemplate.containerSpec.command,
            service.spec.taskTemplate.restartPolicy.condition,
          ])
        )
        .join("\n")
  );
};
