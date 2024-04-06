import { CliContext } from "lib/cli";
import { dockerClient } from "services/docker/client";
import { ServiceSpec } from "services/docker/types";
import { ArgumentsCamelCase, Argv } from "yargs";

export const command = "create <name> <script> [args..]";
export const describe = "Create a new service";

interface CreateOptions {
  name: string;
  script: string;
  args: string[];
  threads: number;
  ["restart-condition"]: string;
}

export const builder = (argv: Argv<CliContext>) =>
  argv
    .positional("script", {
      type: "string",
      demandOption: true,
      describe: "Script to execute; must exist on the Docker daemon host",
    })
    .positional("name", {
      type: "string",
      demandOption: true,
      describe: "Name of the service",
    })
    .positional("args", {
      type: "string",
      array: true,
      default: [],
      describe: "Arguments to pass to the script",
    })
    .options({
      threads: {
        type: "number",
        default: 1,
        describe: "[Bitburner] Number of threads to allocate for the service",
      },
      "restart-condition": {
        type: "string",
        choices: ["any", "on-failure", "never"],
        default: "any",
        describe: "Restart condition",
      },
      hostname: {
        type: "string",
        describe: "Hostname to run the service on",
      },
    });

export const handler = async (
  argv: ArgumentsCamelCase<CliContext & CreateOptions>
) => {
  const { ns, log, name, script, args, threads, restartCondition, hostname } =
    argv;

  const docker = dockerClient(ns);

  const serviceSpec = ServiceSpec.parse({
    script,
    hostname,
    threads,
    restartCondition,
    args,
  });

  const id = await docker.serviceCreate(name, serviceSpec);
  log.tinfo(id);
};
