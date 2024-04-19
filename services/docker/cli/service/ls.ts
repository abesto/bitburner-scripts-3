import { CliContext } from "lib/cli";
import { dockerClient } from "services/docker/client";
import { ServiceWithStatus } from "services/docker/types";
import { ArgumentsCamelCase } from "yargs";

export const command = "ls";
export const aliases = ["list"];
export const describe = "List services";

const threads = (service: ServiceWithStatus): string => {
  let text = `${service.serviceStatus.runningThreads.toString()}/${service.serviceStatus.desiredThreads.toString()}`;
  if (service.spec.mode.type === "replicated-job") {
    text += ` (${service.serviceStatus.completedThreads.toString()}/${service.spec.mode.totalCompletions.toString()} completed)`;
  }
  return text;
};

export const handler = async ({
  ns,
  log,
  fmt,
}: ArgumentsCamelCase<CliContext>) => {
  const docker = dockerClient(ns);
  const services = await docker.serviceList({});

  log.tinfo(
    "\n" +
      fmt
        .table(
          ["ID", "NAME", "THREADS", "SCRIPT", "ARGS", "RESTART"],
          ...services.map((service) => [
            service.id,
            service.spec.name,
            threads(service),
            service.spec.taskTemplate.containerSpec.command,
            service.spec.taskTemplate.containerSpec.args.slice(1).join(" "),
            service.spec.taskTemplate.restartPolicy.condition,
          ])
        )
        .join("\n")
  );
};
