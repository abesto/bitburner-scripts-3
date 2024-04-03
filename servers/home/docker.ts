import { maybeZodErrorMessage } from "lib/error";
import { Fmt } from "lib/fmt";
import { Log } from "lib/log";
import { RpcClient } from "rpc/client";
import { dockerClient } from "services/docker/client";
import type { DockerService } from "services/docker/server";
import { ServiceSpec, SwarmCapacity } from "services/docker/types";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";

const USAGE = `run docker.js <command> <subcommand> [args...]

SWARM COMMANDS:
  swarm capacity         Print the total and per-host capacity of the swarm
  swarm join <hostname>  Add a host to the swarm

SERVICE COMMANDS:
  service create [flags] <name> <script> [args...]  Create a new service
    --hostname <hostname>  Start the service on a specific host
    --threads <n>          Number of threads to start (default: 1)
    --restart-condition <condition>  Restart condition [possible values: none, on-failure, any] (default: any)
  service ls               List all services
  service ps <id-or-name>  List all tasks for a service
  service rm <id>          Remove a service (kills and forgets everything about it)
`;

export const main = async (ns: NS) => {
  const log = new Log(ns, "docker");
  const fmt = new Fmt(ns);

  const parsedArgs = z
    .tuple([z.string(), z.string()])
    .rest(z.unknown())
    .safeParse(ns.args);

  if (!parsedArgs.success) {
    log.terror(
      "cli: invalid arguments: " + fromZodError(parsedArgs.error).message
    );
    log.tinfo(USAGE);
    return;
  }

  const [command, subcommand, ...args] = parsedArgs.data;

  const docker = dockerClient(ns);
  try {
    switch (command) {
      case "swarm":
        switch (subcommand) {
          case "capacity":
            ns.tprintf(formatCapacity(fmt, await docker.swarmCapacity()));
            break;
          case "join":
            log.tinfo("swarm-join", {
              success: await docker.swarmJoin(args[0] as string),
            });
            break;
          default:
            log.terror("cli: invalid subcommand", { subcommand });
            log.tinfo(USAGE);
            break;
        }
        break;
      case "service":
        switch (subcommand) {
          case "create": {
            await createService(ns, log, docker, args);
            break;
          }
          case "ls": {
            const services = await docker.serviceLs();
            ns.tprintf(
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
            break;
          }
          case "ps": {
            const tasks = await docker.servicePs(args[0] as string);
            ns.tprintf(
              fmt
                .table(
                  ["ID", "NAME", "THREADS", "PID", "HOST", "RAM"],
                  ...tasks.map((task) => [
                    task.id,
                    task.name,
                    task.threads.toString(),
                    task.pid.toString(),
                    task.host,
                    fmt.memory(task.ram),
                  ])
                )
                .join("\n")
            );
            break;
          }
          case "rm": {
            ns.tprintf(await docker.serviceRm(args[0] as string));
            break;
          }
          default:
            log.terror("cli: invalid subcommand", { subcommand });
            log.tinfo(USAGE);
            break;
        }
        break;
      default:
        log.terror("cli: invalid command", { command });
        log.tinfo(USAGE);
        break;
    }
  } catch (error) {
    log.terror(maybeZodErrorMessage(error));
  }
};

function formatCapacity(fmt: Fmt, capacity: SwarmCapacity): string {
  const entries = Object.entries(capacity.hosts);
  entries.sort(([, { max: maxA }], [, { max: maxB }]) => maxB - maxA);
  return fmt
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
    .join("\n");
}

async function createService(
  ns: NS,
  log: Log,
  docker: RpcClient<DockerService>,
  args: unknown[]
) {
  const [name, script, ...rest] = args;
  const params = ns.flags([
    ["hostname", ""],
    ["threads", 1],
    ["restart-condition", "any"],
  ]);
  const serviceSpec = ServiceSpec.safeParse({
    script,
    hostname: params.hostname,
    threads: z.number().parse(params.threads),
    restartCondition: z.string().parse(params["restart-condition"]),
    args: rest as string[],
  });

  if (!serviceSpec.success) {
    log.terror(
      "cli: invalid service spec: " + fromZodError(serviceSpec.error).message
    );
    return;
  }

  const id = await docker.serviceCreate(
    z.string().parse(name),
    serviceSpec.data
  );
  log.tinfo(id);
}
