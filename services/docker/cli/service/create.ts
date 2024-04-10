import { CliContext } from "lib/cli";
import { dockerClient } from "services/docker/client";
import { ServiceSpec } from "services/docker/types";
import { ArgumentsCamelCase, Argv } from "yargs";

export const command = "create <script> [args..]";
export const describe = "Create a new service";

interface CreateOptions {
  script: string;
  args: string[];
  name: string;
  threads: number;
  ["restart-condition"]: string;
  constraint: string[];
}

export const builder = (
  argv: Argv<CliContext>
): Argv<CliContext & CreateOptions> =>
  argv
    .positional("script", {
      type: "string",
      demandOption: true,
      describe: "Script to execute; must exist on the Docker daemon host",
    })
    .positional("args", {
      type: "string",
      array: true,
      default: [],
      describe: "Arguments to pass to the script",
    })
    .options({
      name: {
        type: "string",
        demandOption: true,
        describe: "Name of the service",
      },
      threads: {
        type: "number",
        default: 1,
        describe: "[Bitburner] Number of threads to allocate for the service",
      },
      "restart-condition": {
        type: "string",
        choices: ["any", "on-failure", "none"],
        default: "any",
        describe: "Restart condition",
      },
      constraint: {
        type: "string",
        array: true,
        default: [],
      },
    });

export const handler = async (
  argv: ArgumentsCamelCase<CliContext & CreateOptions>
) => {
  const {
    ns,
    log,
    name,
    script,
    args,
    threads,
    restartCondition,
    constraint: constraints,
  } = argv;

  const docker = dockerClient(ns);

  const serviceSpec: ServiceSpec = {
    name,
    labels: {},
    taskTemplate: {
      containerSpec: {
        labels: {},
        command: script,
        args,
      },
      restartPolicy: {
        condition: restartCondition as "none" | "on-failure" | "any",
        delay: 0,
        maxAttempts: 0,
      },
      placement: {
        constraints,
      },
    },
    mode: {
      type: "replicated",
      replicas: threads,
    },
  };

  const id = await docker.serviceCreate(serviceSpec);
  log.tinfo(id);
};
