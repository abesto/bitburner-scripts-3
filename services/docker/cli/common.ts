import { Fmt } from "lib/fmt";
import { z } from "zod";
import { ServiceWithStatus } from "../types";
import { Log } from "lib/log";

export const parseLabels = (labels: string[]): Record<string, string> =>
  Object.fromEntries(
    z
      .string()
      .transform((s) => s.split("="))
      .pipe(z.tuple([z.string(), z.string()]))
      .array()
      .parse(labels)
  );

const threads = (service: ServiceWithStatus): string => {
  let text = `${service.serviceStatus.runningThreads.toString()}/${service.serviceStatus.desiredThreads.toString()}`;
  if (service.spec.mode.type === "replicated-job") {
    text += ` (${service.serviceStatus.completedThreads.toString()}/${service.spec.mode.totalCompletions.toString()} completed)`;
  }
  return text;
};

export const printServiceList = (
  log: Log,
  fmt: Fmt,
  services: ServiceWithStatus[]
): void => {
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
