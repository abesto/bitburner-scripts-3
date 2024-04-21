import { z } from "zod";

export const Labels = z.record(z.string());
export type Labels = z.infer<typeof Labels>;

export const ServiceID = z.string();
export type ServiceID = z.infer<typeof ServiceID>;

export const ServiceName = z.string();
export type ServiceName = z.infer<typeof ServiceName>;

export const Version = z.number();
export type Version = z.infer<typeof Version>;

export const DockerNode = z.object({
  id: z.string(),
  version: z.number(),
  hostname: z.string(),
  labels: Labels,
});
export type DockerNode = z.infer<typeof DockerNode>;

export const SwarmCapacityData = z.object({
  used: z.number(),
  max: z.number(),
});
export type SwarmCapacityData = z.infer<typeof SwarmCapacityData>;

export const SwarmCapacityEntry = z.tuple([DockerNode, SwarmCapacityData]);
export type SwarmCapacityEntry = z.infer<typeof SwarmCapacityEntry>;

export const SwarmCapacity = z.object({
  total: SwarmCapacityData,
  hosts: SwarmCapacityEntry.array(),
});
export type SwarmCapacity = z.infer<typeof SwarmCapacity>;

export const PlacementConstraint = z
  .string()
  .transform((s) => s.split("=="))
  .pipe(z.tuple([z.enum(["node.hostname"]), z.string()]));
export type PlacementConstraint = z.infer<typeof PlacementConstraint>;

export const Placement = z.object({
  constraints: z
    .string()
    .refine((s) => PlacementConstraint.parse(s), {
      message: "Invalid placement constraint",
    })
    .array(),
});
export type Placement = z.infer<typeof Placement>;

export const TaskSpec = z.object({
  containerSpec: z.object({
    labels: Labels,
    command: z.string(),
    args: z.string().array(),
  }),
  resources: z
    .object({
      memory: z.number().optional().describe("Memory limit in GB per thread"),
    })
    .optional(),
  restartPolicy: z.object({
    condition: z.enum(["none", "on-failure", "any"]),
    delay: z.number(),
    maxAttempts: z.number(),
  }),
  placement: Placement,
});
export type TaskSpec = z.infer<typeof TaskSpec>;

export const TaskID = z.string();
export type TaskID = z.infer<typeof TaskID>;

export const TaskName = z.string();
export type TaskName = z.infer<typeof TaskName>;

export const Task = z.object({
  id: TaskID,
  version: Version,
  name: TaskName,
  labels: Labels,
  spec: TaskSpec,
  serviceId: ServiceID,
  nodeId: z.string(),
  status: z.object({
    timestamp: z.string().datetime(),
    status: z.enum(["running", "complete", "shutdown", "failed"]),
  }),
  // Bitburner specific fields
  threads: z.number(),
  pid: z.number(),
  ram: z.number(),
});
export type Task = z.infer<typeof Task>;

export const ServiceMode = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("replicated"),
    replicas: z.number(),
  }),
  z.object({
    type: z.literal("replicated-job"),
    maxConcurrent: z.number(),
    totalCompletions: z.number(),
  }),
]);
export type ServiceMode = z.infer<typeof ServiceMode>;

export const ServiceSpec = z.object({
  name: ServiceName,
  labels: Labels,
  taskTemplate: TaskSpec,
  mode: ServiceMode,
});
export type ServiceSpec = z.infer<typeof ServiceSpec>;

export const Service = z.object({
  id: ServiceID,
  version: Version,
  spec: ServiceSpec,
});
export type Service = z.infer<typeof Service>;

export const ServiceStatus = z.object({
  runningThreads: z.number(),
  desiredThreads: z.number(),
  completedThreads: z.number(),
});
export type ServiceStatus = z.infer<typeof ServiceStatus>;

export const ServiceWithStatus = Service.extend({
  serviceStatus: ServiceStatus,
});
export type ServiceWithStatus = z.infer<typeof ServiceWithStatus>;

export const TaskListQuery = z.object({
  filters: z.object({
    service: z.string().array().optional(),
    label: Labels.optional(),
  }),
});
export type TaskListQuery = z.infer<typeof TaskListQuery>;

export const API = z.object({
  swarmCapacity: z.function().returns(SwarmCapacity),
  swarmJoin: z
    .function()
    .args(z.string().describe("hostname"))
    .returns(z.literal("OK")),

  serviceCreate: z
    .function()
    .args(
      z.object({
        name: ServiceName,
        labels: Labels,
        taskTemplate: TaskSpec,
        mode: ServiceMode,
      })
    )
    .returns(z.string().describe("created service id")),

  // The real API takes a boolean that controls whether `ServiceStatus` is included.
  // That makes typing tricky, and the optimization doesn't really matter for us,
  // so always include it.
  serviceList: z
    .function()
    .args(
      z
        .object({
          id: ServiceID.array().optional(),
          label: Labels.optional(),
          mode: z.enum(["replicated", "replicated-job"]).array().optional(),
          name: ServiceName.array().optional(),
        })
        .describe("filters")
    )
    .returns(ServiceWithStatus.array()),

  serviceInspect: z
    .function()
    .args(z.string().describe("ID or service name"))
    .returns(ServiceWithStatus),

  serviceDelete: z.function().args(ServiceID).returns(z.literal("OK")),

  serviceUpdate: z
    .function()
    .args(ServiceID, z.number().describe("version"), ServiceSpec)
    .returns(z.literal("OK")),

  taskList: z.function().args(TaskListQuery).returns(Task.array()),

  taskRegister: z
    .function()
    .args(
      z.object({
        serviceId: ServiceID,
        pid: z.number(),
        replicas: z.number(),
        labels: Labels,
      })
    )
    .returns(z.string()),

  nodeList: z.function().returns(DockerNode.array()),

  nodeInspect: z
    .function()
    .args(z.string().describe("node ID or name"))
    .returns(DockerNode),

  nodeUpdate: z
    .function()
    .args(
      z.string().describe("node ID"),
      z.number().describe("version"),
      Labels
    )
    .returns(z.literal("OK")),
});
export type API = z.infer<typeof API>;

export const DockerEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("replicated-job-fulfilled"),
    serviceId: ServiceID,
  }),
]);
export type DockerEvent = z.infer<typeof DockerEvent>;
