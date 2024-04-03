import { z } from "zod";

export const SwarmCapacityEntry = z.object({
  used: z.number(),
  max: z.number(),
});
export type SwarmCapacityEntry = z.infer<typeof SwarmCapacityEntry>;

export const SwarmCapacity = z.object({
  total: SwarmCapacityEntry,
  hosts: z.record(SwarmCapacityEntry),
});
export type SwarmCapacity = z.infer<typeof SwarmCapacity>;

export const ServiceSpec = z.object({
  script: z.string().describe("path to the script"),
  hostname: z.string().optional().describe("start service on this host"),
  args: z.string().array().default([]).describe("arguments to the service"),
  threads: z.number().describe("number of threads to start").default(1),
  restartCondition: z.enum(["none", "on-failure", "any"]).default("any"),
});
export type ServiceSpec = z.infer<typeof ServiceSpec>;

export const ServiceState = z.object({
  tasks: z.string().array(),
  threads: z.number(),
});
export type ServiceState = z.infer<typeof ServiceState>;

export const Service = z.object({
  id: z.string(),
  name: z.string(),
  spec: ServiceSpec,
  state: ServiceState,
});
export type Service = z.infer<typeof Service>;

export const Task = z.object({
  id: z.string(),
  name: z.string(),
  host: z.string(),
  pid: z.number(),
  threads: z.number(),
  ram: z.number(),
});
export type Task = z.infer<typeof Task>;

export const API = z.object({
  swarmCapacity: z.function().returns(SwarmCapacity.promise()),
  swarmJoin: z
    .function()
    .args(z.string().describe("hostname"))
    .returns(z.boolean().promise().describe("success")),

  serviceCreate: z
    .function()
    .args(z.string().describe("name"), ServiceSpec)
    .returns(z.string().promise().describe("created service id")),

  serviceLs: z.function().returns(Service.array().promise()),
  servicePs: z
    .function()
    .args(z.string().describe("service id or name"))
    .returns(Task.array().promise()),
  serviceRm: z
    .function()
    .args(z.string().describe("service id or name"))
    .returns(z.string().promise()),
});
export type API = z.infer<typeof API>;
