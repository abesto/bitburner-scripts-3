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
  const services = await docker.serviceLs();
  log.tinfo(
    "\n" +
      fmt
        .table(
          ["ID", "NAME", "THREADS", "SCRIPT", "RESTART", "HOST"],
          ...services.map((service) => [
            service.id,
            service.name,
            `${service.state.threads.toString()}/${service.spec.threads.toString()}`,
            service.spec.script,
            service.spec.restartCondition,
            service.spec.hostname || "(any)",
          ])
        )
        .join("\n")
  );
};
