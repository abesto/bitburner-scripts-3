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
  const nodes = await docker.nodeList();
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  log.tinfo(
    "\n" +
      fmt
        .table(
          [
            "ID",
            "NAME",
            "SCRIPT",
            "ARGS",
            "THREADS",
            "PID",
            "HOST",
            "RAM",
            "STATE",
          ],
          ...tasks.map((task) => [
            task.id,
            task.name,
            task.spec.containerSpec.command,
            task.spec.containerSpec.args.slice(1).join(" "),
            task.threads.toString(),
            task.pid.toString(),
            nodesById.get(task.nodeId)?.hostname ?? "<unknown>",
            fmt.memory(task.ram),
            task.status.status +
              " " +
              fmt.time(
                Date.now() - new Date(task.status.timestamp).getTime(),
                false
              ) +
              " ago",
          ])
        )
        .join("\n")
  );
};
