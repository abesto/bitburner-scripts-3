import { BaseService } from "rpc/server";
import { z } from "zod";
import { DOCKER as PORT } from "rpc/PORTS";
import { RedisClient, redisClient } from "services/redis/client";
import { allocateThreads, calculateHostCandidates } from "./algorithms";
import { generateId } from "lib/id";
import { maybeZodErrorMessage } from "lib/error";
import {
  API,
  Service,
  ServiceSpec,
  SwarmCapacity,
  SwarmCapacityEntry,
  Task,
} from "./types";

const REDIS_KEYS = {
  NODES: "docker:swarm:nodes",
  SERVICES: "docker:services",
  SERVICE: (id: string) => `docker:service:${id}`,
  SERVICE_BY_NAME: (name: string) => `docker:service/name:${name}`,
  TASK: (serviceId: string, taskId: string) =>
    `docker:service:${serviceId}:task:${taskId}`,
};

export class DockerService extends BaseService implements API {
  private readonly redis: RedisClient;

  constructor(ns: NS) {
    super(ns);
    this.redis = redisClient(ns);
  }

  override getPortNumber() {
    return PORT;
  }

  override async setup() {
    await this.redis.sadd(REDIS_KEYS.NODES, [this.ns.getHostname()]);
  }

  swarmCapacity: () => Promise<SwarmCapacity> =
    API.shape.swarmCapacity.implement(async () => {
      const total = { used: 0, max: 0 };
      const hosts: Record<string, SwarmCapacityEntry> = {};

      const hostnames = await this.redis.smembers(REDIS_KEYS.NODES);
      for (const hostname of hostnames) {
        if (!this.ns.hasRootAccess(hostname)) {
          this.log.twarn("leaving", { hostname, reason: "no-root" });
          await this.redis.srem(REDIS_KEYS.NODES, [hostname]);
          continue;
        }
        const capacity = {
          max: this.ns.getServerMaxRam(hostname),
          used: this.ns.getServerUsedRam(hostname),
        };
        total.used += capacity.used;
        total.max += capacity.max;
        hosts[hostname] = capacity;
      }

      return {
        total,
        hosts,
      };
    });

  swarmJoin: (hostname: string) => Promise<boolean> =
    API.shape.swarmJoin.implement(async (hostname) => {
      if (!this.ns.hasRootAccess(hostname)) {
        this.log.twarn("join", { hostname, result: "skip", reason: "no-root" });
        return false;
      }
      if ((await this.redis.sadd(REDIS_KEYS.NODES, [hostname])) === 1) {
        this.log.tinfo("join", { hostname, result: "success" });
      } else {
        this.log.debug("join", {
          hostname,
          result: "skip",
          reason: "already-joined",
        });
      }
      return true;
    });

  serviceCreate: (
    name: string,
    spec: z.input<typeof ServiceSpec>
  ) => Promise<string> = API.shape.serviceCreate.implement(
    async (name, spec) => {
      const script = spec.script;
      if (!this.ns.fileExists(script)) {
        throw new Error(`script not found: ${script}`);
      }
      const scriptRam = this.ns.getScriptRam(script);
      const capacity = await this.swarmCapacity();
      const threads = spec.threads;
      const hostname = spec.hostname;

      this.log.debug("service-create", {
        name,
        script,
        scriptRam,
        threads,
        hostname,
      });

      const hostCandidates = calculateHostCandidates(
        scriptRam,
        threads,
        capacity,
        hostname
      );
      this.log.debug("service-create", { name, hostCandidates });

      const allocations = allocateThreads(
        scriptRam,
        threads,
        capacity,
        hostCandidates
      );
      this.log.debug("service-create", { name, allocations });

      const allocated = Object.values(allocations).reduce(
        (sum, threads) => sum + threads,
        0
      );
      if (allocated !== threads) {
        throw new Error(
          `failed to allocate all threads. wanted=${threads.toString()} got=${allocated.toString()}`
        );
      }

      const tasks: Task[] = [];
      try {
        for (const [host, threads] of Object.entries(allocations)) {
          if (!this.ns.scp(script, host)) {
            throw new Error(`failed to scp ${script} to host=${host}`);
          }
          await this.ns.sleep(0);
          const taskId = generateId(8);
          const execArgs: [string, string, number, ...string[]] = [
            script,
            host,
            threads,
            ...spec.args,
          ];
          const pid = this.ns.exec(...execArgs);
          if (pid === 0) {
            throw new Error(
              `failed to start task execArgs=${JSON.stringify(execArgs)}`
            );
          }
          tasks.push({
            id: taskId,
            name: `${name}.${(tasks.length + 1).toString()}`,
            host,
            pid,
            threads,
            ram: scriptRam * threads,
          });
        }

        const serviceId = generateId(8);
        const service: Service = {
          id: serviceId,
          name,
          spec,
          state: {
            tasks: tasks.map((t) => t.id),
            threads,
          },
        };

        await this.redis.sadd(REDIS_KEYS.SERVICES, [serviceId]);
        await this.redis.mset({
          [REDIS_KEYS.SERVICE(serviceId)]: JSON.stringify(service),
          [REDIS_KEYS.SERVICE_BY_NAME(name)]: serviceId,
          ...Object.fromEntries(
            tasks.map((t) => [
              REDIS_KEYS.TASK(serviceId, t.id),
              JSON.stringify(t),
            ])
          ),
        });

        return serviceId;
      } catch (error) {
        this.log.terror("service-create", {
          name,
          error: maybeZodErrorMessage(error),
        });
        for (const task of tasks) {
          this.ns.kill(task.pid);
        }
        // TODO clean up redis
        throw error;
      }
    }
  );

  serviceLs: () => Promise<Service[]> = API.shape.serviceLs.implement(
    async () => {
      const serviceIds = await this.redis.smembers(REDIS_KEYS.SERVICES);
      if (serviceIds.length === 0) {
        return [];
      }
      const services = await this.redis.mget(
        serviceIds.map(REDIS_KEYS.SERVICE) as [string, ...string[]]
      );
      return services
        .filter((s) => s !== null)
        .map((s) => JSON.parse(s as string) as Service);
    }
  );

  private async lookupService(idOrName: string): Promise<Service | null> {
    const fromId = await this.redis.get(REDIS_KEYS.SERVICE(idOrName));
    if (fromId !== null) {
      return Service.parse(JSON.parse(fromId));
    }
    const id = await this.redis.get(REDIS_KEYS.SERVICE_BY_NAME(idOrName));
    if (id === null) {
      return null;
    }
    const fromName = await this.redis.get(REDIS_KEYS.SERVICE(id));
    if (fromName === null) {
      return null;
    }
    return Service.parse(JSON.parse(fromName));
  }

  servicePs: (serviceIdOrName: string) => Promise<Task[]> =
    API.shape.servicePs.implement(async (serviceIdOrName) => {
      const service = await this.lookupService(serviceIdOrName);
      if (service === null) {
        throw new Error(`service not found: ${serviceIdOrName}`);
      }
      const taskKeys = service.state.tasks.map((taskId) =>
        REDIS_KEYS.TASK(service.id, taskId)
      );
      if (taskKeys.length === 0) {
        return [];
      }
      const tasks = await this.redis.mget(taskKeys as [string, ...string[]]);
      return tasks
        .filter((t) => t !== null)
        .map((t) => JSON.parse(t as string) as Task);
    });

  serviceRm: (serviceIdOrName: string) => Promise<string> =
    API.shape.serviceRm.implement(async (serviceIdOrName) => {
      const service = await this.lookupService(serviceIdOrName);
      if (service === null) {
        throw new Error(`service not found: ${serviceIdOrName}`);
      }

      if (service.state.tasks.length > 0) {
        const rawTaskDataJsons = await this.redis.mget(
          service.state.tasks as [string, ...string[]]
        );
        for (const rawTaskJson of rawTaskDataJsons) {
          if (rawTaskJson === null) {
            continue;
          }
          try {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            const rawTaskData = JSON.parse(rawTaskJson);
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            this.ns.kill(rawTaskData.pid as string);
          } catch {
            /* empty */
          }
        }
      }

      const taskKeys = service.state.tasks.map((taskId) =>
        REDIS_KEYS.TASK(service.id, taskId)
      );
      await this.redis.del([
        REDIS_KEYS.SERVICE(service.id),
        REDIS_KEYS.SERVICE_BY_NAME(service.name),
        ...taskKeys,
      ]);
      await this.redis.srem(REDIS_KEYS.SERVICES, [service.id]);
      return service.id;
    });
}
