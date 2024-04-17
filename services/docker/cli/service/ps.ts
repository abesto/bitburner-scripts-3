import { CliContext } from "lib/cli";
import { dockerClient } from "services/docker/client";
import { ArgumentsCamelCase, Argv } from "yargs";

export const command = "ps <service>";
export const describe = "List the tasks of a service";
// TODO allow listing tasks of multiple services in a single call

interface PsOptions {
  service: string;
}

export const builder = (
  yargs: Argv<CliContext>
): Argv<CliContext & PsOptions> =>
  yargs.positional("service", {
    type: "string",
    describe: "Service name",
    demandOption: true,
  });

export const handler = async ({
  ns,
  log,
  fmt,
  service,
}: ArgumentsCamelCase<CliContext & PsOptions>) => {
  const docker = dockerClient(ns);
  const tasks = await docker.taskList({ filters: { service: [service] } });
  log.tinfo(
    "\n" +
      fmt
        .table(
          ["ID", "NAME", "THREADS", "STATE", "PID", "HOST", "RAM"],
          ...tasks.map((task) => [
            task.id,
            task.name,
            task.threads.toString(),
            task.status.status,
            task.pid.toString(),
            task.hostname,
            fmt.memory(task.ram),
          ])
        )
        .join("\n")
  );
};
