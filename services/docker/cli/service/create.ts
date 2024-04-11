import { CliContext } from "lib/cli";
import { dockerClient } from "services/docker/client";
import { ServiceMode, ServiceSpec } from "services/docker/types";
import { ArgumentsCamelCase, Argv } from "yargs";

export const command = "create <script> [args..]";
export const describe = "Create a new service";

interface CreateOptions {
  script: string;
  args: string[];
  name: string;
  replicas: number;
  ["max-concurrent"]?: number;
  ["restart-condition"]: string;
  constraint: string[];
  mode: string;
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
      replicas: {
        type: "number",
        default: 1,
        describe: "[Bitburner] Number of threads to allocate for the service",
      },
      "max-concurrent": {
        type: "number",
        describe: "[Bitburner] Maximum number of threads to run concurrently",
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
      mode: {
        type: "string",
        default: "replicated",
        choices: ["replicated", "replicated-job"],
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
    replicas,
    maxConcurrent,
    restartCondition,
    mode,
    constraint: constraints,
  } = argv;

  const docker = dockerClient(ns);

  const modeSpec: ServiceMode =
    mode === "replicated"
      ? { type: "replicated", replicas: replicas }
      : {
          type: "replicated-job",
          totalCompletions: replicas,
          maxConcurrent: maxConcurrent ?? replicas,
        };

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
    mode: modeSpec,
  };

  const id = await docker.serviceCreate(serviceSpec);
  log.tinfo(id);
};
