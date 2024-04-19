import { CliContext } from "lib/cli";
import { dockerClient } from "services/docker/client";
import { ArgumentsCamelCase, Argv } from "yargs";
import YAML from "yaml";
import { z } from "zod";
import { LABELS } from "services/docker/constants";
import { Placement, ServiceMode } from "services/docker/types";

export const command = "deploy <stack>";
export const describe = "Deploy a new stack or update an existing stack";
export const aliases = ["up"];

interface DeployOptions {
  stack: string;
  ["compose-file"]: string;
}

export const builder = (
  yargs: Argv<CliContext>
): Argv<CliContext & DeployOptions> =>
  yargs
    .positional("stack", {
      type: "string",
      describe: "Stack name",
      demandOption: true,
    })
    .option("compose-file", {
      alias: "c",
      type: "string",
      describe: "Path to a Compose file",
      demandOption: true,
    });

const ComposeFile = z.object({
  version: z
    .literal("3.8-bb")
    .describe(
      "Compose file version; based loosely on the real Compose file version 3.8"
    ),
  services: z
    .record(
      z.object({
        command: z.string(),
        args: z.array(z.string()).optional(),
        deploy: z
          .object({
            labels: z.record(z.string()).optional(),
            mode: z.enum(["replicated", "replicated-job"]).optional(),
            replicas: z.number().optional(),
            placement: Placement.optional(),
          })
          .optional(),
      })
    )
    .optional(),
});
type ComposeFile = z.infer<typeof ComposeFile>;

export const handler = async ({
  ns,
  log,
  stack,
  composeFile,
}: ArgumentsCamelCase<CliContext & DeployOptions>) => {
  if (!ns.fileExists(composeFile)) {
    throw new Error(`File not found: ${composeFile}`);
  }

  const compose = ComposeFile.parse(YAML.parse(ns.read(composeFile)));
  log.tdebug("Compose file", compose);
  const docker = dockerClient(ns);
  const services = await docker.serviceList({
    label: { [LABELS.STACK_NAMESPACE]: stack },
  });

  for (const [serviceName, spec] of Object.entries(compose.services ?? {})) {
    const name = `${stack}_${serviceName}`;
    const labels = {
      ...(spec.deploy?.labels ?? {}),
      [LABELS.STACK_NAMESPACE]: stack,
      [LABELS.STACK_SERVICE_NAME]: serviceName,
    };

    let specMode: ServiceMode | undefined = undefined;
    if (spec.deploy?.mode) {
      if (spec.deploy.mode === "replicated") {
        specMode = { type: "replicated", replicas: spec.deploy.replicas ?? 1 };
      } else {
        specMode = {
          type: "replicated-job",
          totalCompletions: spec.deploy.replicas ?? 1,
          maxConcurrent: spec.deploy.replicas ?? 1,
        };
      }
    }

    let placement: Placement | undefined = undefined;
    if (spec.deploy?.placement?.constraints !== undefined) {
      placement = spec.deploy.placement;
    }

    const service = services.find(
      (s) => s.spec.labels[LABELS.STACK_SERVICE_NAME] === serviceName
    );
    if (service) {
      log.tinfo(`Updating service ${name}`);

      await docker.serviceUpdate(service.id, service.version, {
        ...service.spec,
        labels,
        mode: specMode ?? service.spec.mode,
        taskTemplate: {
          ...service.spec.taskTemplate,
          placement: placement ?? service.spec.taskTemplate.placement,
          containerSpec: {
            ...service.spec.taskTemplate.containerSpec,
            labels,
            args: spec.args ?? [],
            command: spec.command,
          },
        },
      });
    } else {
      log.tinfo(`Creating service ${name}`);
      await docker.serviceCreate({
        name,
        mode: specMode ?? { type: "replicated", replicas: 1 },
        labels,
        taskTemplate: {
          placement: placement ?? { constraints: [] },
          restartPolicy: { condition: "any", delay: 0, maxAttempts: 0 },
          containerSpec: {
            args: spec.args ?? [],
            command: spec.command,
            labels,
          },
        },
      });
    }
  }

  for (const service of services) {
    if (
      compose.services === undefined ||
      !Reflect.has(
        compose.services,
        service.spec.labels[LABELS.STACK_SERVICE_NAME] ?? "!!!"
      )
    ) {
      log.tinfo(`Removing service ${service.spec.name}`);
      await docker.serviceDelete(service.id);
    }
  }
  //const nodeObj = await docker.nodeInspect(node);
  //log.tinfo("\n" + JSON.stringify(nodeObj, undefined, 2));
};
