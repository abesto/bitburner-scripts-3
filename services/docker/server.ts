import { BaseService } from "rpc/server";
import { DOCKER as PORT } from "rpc/PORTS";
import { RedisClient, redisClient } from "services/redis/client";
import { allocateThreads, calculateHostCandidates } from "./algorithms";
import { generateId } from "lib/id";
import {
  API,
  Labels,
  PlacementConstraint,
  Service,
  ServiceMode,
  ServiceName,
  ServiceSpec,
  ServiceStatus,
  SwarmCapacity,
  SwarmCapacityEntry,
  Task,
  TaskListQuery,
  TaskSpec,
} from "./types";
import { TimerManager } from "lib/TimerManager";

const REDIS_KEYS = {
  NODES: "docker:swarm:nodes",
  SERVICES: "docker:services",
  SERVICE: (id: string) => `docker:service:${id}`,
  SERVICE_BY_NAME: (name: string) => `docker:servicebyname:${name}`,
  TASKS: (serviceId: string) => `docker:service:${serviceId}:tasks`,
  TASK: (serviceId: string, taskId: string) =>
    `docker:service:${serviceId}:task:${taskId}`,
};

const ID_BYTES = 8;

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

  protected override registerTimers(timers: TimerManager) {
    timers.setInterval(() => this.keepalive(), 10000);
  }

  async keepalive() {
    // TODO respect restartPolicy.delay & maxAttempts
    const services = await this.lookupAllServices();
    const deadTasks = [];

    for (const service of services) {
      const tasks = await this.lookupTasks(service.id);

      for (const task of tasks) {
        if (!this.ns.getRunningScript(task.pid)) {
          this.log.twarn("task", {
            service: service.spec.name,
            task: task.name || task.id,
            result: "crashed",
          });
          deadTasks.push(task.id);
        }
      }

      if (deadTasks.length > 0) {
        await this.redis.srem(
          REDIS_KEYS.TASKS(service.id),
          deadTasks as [string, ...string[]]
        );
        await this.redis.del(deadTasks as [string, ...string[]]);
      }

      await this.scaleDown(service);
      await this.scaleUp(service);
    }
  }

  scaleDown = async (service: Service) => {
    const tasks = await this.lookupTasks(service.id);

    const desiredThreads = this.desiredThreads(service.spec.mode);
    const runningThreads = tasks.reduce((total, t) => total + t.threads, 0);
    const threadsToKill = runningThreads - desiredThreads;
    if (threadsToKill <= 0) {
      return;
    }

    // We could be smarter here and find the combination of threads that brings us closest to the desired state.
    // This is Good Enough (TM).
    tasks.sort((a, b) => a.threads - b.threads);
    const toKill = [];
    let remaining = threadsToKill;
    while (remaining > 0) {
      const task = tasks.pop();
      if (task === undefined) {
        throw new Error("impossible");
      }
      toKill.push(task);
      remaining -= task.threads;
    }

    for (const task of toKill) {
      this.ns.kill(task.pid as unknown as string);
    }

    await this.redis.srem(
      REDIS_KEYS.TASKS(service.id),
      toKill.map((t) => t.id) as [string, ...string[]]
    );
    await this.redis.del(
      toKill.map((t) => REDIS_KEYS.TASK(service.id, t.id)) as [
        string,
        ...string[]
      ]
    );
  };

  scaleUp = async (service: Service) => {
    const name = service.spec.name;

    const desiredThreads = this.desiredThreads(service.spec.mode);
    const runningThreads = (await this.lookupTasks(service.id)).reduce(
      (total, t) => total + t.threads,
      0
    );
    const threads = desiredThreads - runningThreads;
    if (threads <= 0) {
      return;
    }

    const script = service.spec.taskTemplate.containerSpec.command;
    const scriptRam = this.ns.getScriptRam(script);
    const capacity = await this.swarmCapacity();
    const hostnames = service.spec.taskTemplate.placement.constraints
      .map((s) => PlacementConstraint.parse(s))
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      .filter((c) => c[0] === "node.hostname")
      .map((c) => c[1]);

    this.log.debug("scaleUp", {
      name,
      script,
      scriptRam,
      threads,
      hostnames,
    });

    const hostCandidates = calculateHostCandidates(
      scriptRam,
      threads,
      capacity,
      hostnames
    );
    this.log.debug("scaleUp", { name, hostCandidates });

    const allocations = allocateThreads(
      scriptRam,
      threads,
      capacity,
      hostCandidates
    );
    this.log.debug("scaleUp", { name, allocations });

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
    for (const [host, threads] of Object.entries(allocations)) {
      if (!this.ns.scp(script, host)) {
        throw new Error(`failed to scp ${script} to host=${host}`);
      }
      await this.ns.sleep(0);
      let taskId = generateId(ID_BYTES);
      while (await this.redis.exists([REDIS_KEYS.TASK(service.id, taskId)])) {
        taskId = generateId(ID_BYTES);
      }
      const execArgs: [string, string, number, ...string[]] = [
        script,
        host,
        threads,
        ...service.spec.taskTemplate.containerSpec.args,
      ];
      const pid = this.ns.exec(...execArgs);
      if (pid === 0) {
        throw new Error(
          `failed to start task execArgs=${JSON.stringify(execArgs)}`
        );
      }
      tasks.push({
        id: taskId,
        version: 0,
        name: `${name}.${(tasks.length + 1).toString()}`,
        labels: service.spec.taskTemplate.containerSpec.labels,
        spec: service.spec.taskTemplate,
        serviceId: service.id,
        hostname: host,
        status: {
          timestamp: new Date().toISOString(),
          status: "running",
        },
        pid,
        threads,
        ram: threads * scriptRam,
      });
    }

    await this.redis.mset({
      [REDIS_KEYS.SERVICE(service.id)]: JSON.stringify(service),
      [REDIS_KEYS.SERVICE_BY_NAME(name)]: service.id,
      ...Object.fromEntries(
        tasks.map((t) => [REDIS_KEYS.TASK(service.id, t.id), JSON.stringify(t)])
      ),
    });
    if (tasks.length > 0) {
      await this.redis.sadd(
        REDIS_KEYS.TASKS(service.id),
        tasks.map((t) => t.id) as [string, ...string[]]
      );
    }
  };

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

  swarmJoin: (hostname: string) => Promise<void> =
    API.shape.swarmJoin.implement(async (hostname) => {
      if (!this.ns.hasRootAccess(hostname)) {
        throw new Error(`no root access: ${hostname}`);
      }
      if ((await this.redis.sadd(REDIS_KEYS.NODES, [hostname])) === 1) {
        this.log.info("join", { hostname, result: "success" });
      } else {
        this.log.debug("join", {
          hostname,
          result: "skip",
          reason: "already-joined",
        });
      }
    });

  serviceCreate: (req: {
    name: ServiceName;
    labels: Labels;
    taskTemplate: TaskSpec;
    mode: ServiceMode;
  }) => Promise<string> = API.shape.serviceCreate.implement(
    async ({ name, labels, taskTemplate, mode }) => {
      const script = taskTemplate.containerSpec.command;
      if (!this.ns.fileExists(script)) {
        throw new Error(`script not found: ${script}`);
      }
      if (await this.redis.exists([REDIS_KEYS.SERVICE_BY_NAME(name)])) {
        throw new Error(`service already exists: ${name}`);
      }

      let serviceId = generateId(ID_BYTES);
      while (await this.redis.exists([REDIS_KEYS.SERVICE(serviceId)])) {
        serviceId = generateId(ID_BYTES);
      }

      const service: Service = {
        id: serviceId,
        version: 0,
        spec: {
          name,
          labels,
          taskTemplate,
          mode,
        },
      };

      await this.redis.sadd(REDIS_KEYS.SERVICES, [serviceId]);
      await this.redis.mset({
        [REDIS_KEYS.SERVICE_BY_NAME(name)]: serviceId,
        [REDIS_KEYS.SERVICE(serviceId)]: JSON.stringify(service),
      });

      await this.scaleUp(service);
      return serviceId;
    }
  );

  private serviceStatus = (service: Service, tasks: Task[]): ServiceStatus => {
    return {
      runningThreads: tasks
        .filter((t) => t.status.status === "running")
        .reduce((total, t) => total + t.threads, 0),
      desiredThreads: this.desiredThreads(service.spec.mode),
      completedThreads: tasks
        .filter((t) => t.status.status === "complete")
        .reduce((total, t) => total + t.threads, 0),
    };
  };

  serviceInspect: (
    serviceIdOrName: string
  ) => Promise<Service & { serviceStatus: ServiceStatus }> =
    API.shape.serviceInspect.implement(async (serviceIdOrName) => {
      const service = await this.lookupService(serviceIdOrName);
      if (service === null) {
        throw new Error(`service not found: ${serviceIdOrName}`);
      }
      const tasks = await this.lookupTasks(service.id);
      return {
        ...service,
        serviceStatus: this.serviceStatus(service, tasks),
      };
    });

  serviceList: () => Promise<(Service & { serviceStatus: ServiceStatus })[]> =
    API.shape.serviceList.implement(async () => {
      const services = await this.lookupAllServices();

      const tasks: Task[][] = [];
      for (const service of services) {
        tasks.push(await this.lookupTasks(service.id));
      }

      return services.map((s, i) => ({
        ...s,
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        serviceStatus: this.serviceStatus(s, tasks[i]!),
      }));
    });

  private async lookupAllServices(): Promise<Service[]> {
    const serviceIds = await this.redis.smembers(REDIS_KEYS.SERVICES);
    if (serviceIds.length === 0) {
      return [];
    }

    return (
      await this.redis.mget(
        serviceIds.map(REDIS_KEYS.SERVICE) as [string, ...string[]]
      )
    )
      .filter((s) => s !== null)
      .map((s) => Service.parse(JSON.parse(s as string)));
  }

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

  private async lookupTasks(serviceId: string): Promise<Task[]> {
    const taskIds = await this.redis.smembers(REDIS_KEYS.TASKS(serviceId));
    if (taskIds.length === 0) {
      return [];
    }
    const taskKeys = taskIds.map((id) => REDIS_KEYS.TASK(serviceId, id));
    const tasksRaw = await this.redis.mget(taskKeys as [string, ...string[]]);
    return tasksRaw
      .filter((t) => t !== null)
      .map((t) => Task.parse(JSON.parse(t as string)));
  }

  private desiredThreads(mode: ServiceMode): number {
    return mode.type === "replicated"
      ? mode.replicas
      : mode.totalCompletions ?? mode.maxConcurrent;
  }

  serviceDelete: (serviceIdOrName: string) => Promise<void> =
    API.shape.serviceDelete.implement(async (serviceIdOrName) => {
      const service = await this.lookupService(serviceIdOrName);
      if (service === null) {
        throw new Error(`service not found: ${serviceIdOrName}`);
      }

      const tasks = await this.lookupTasks(service.id);
      for (const task of tasks) {
        this.ns.kill(task.pid as unknown as string);
      }

      const taskKeys = await this.redis.smembers(REDIS_KEYS.TASKS(service.id));
      await this.redis.del([
        REDIS_KEYS.SERVICE(service.id),
        REDIS_KEYS.SERVICE_BY_NAME(service.spec.name),
        REDIS_KEYS.TASKS(service.id),
        ...taskKeys,
      ]);
      await this.redis.srem(REDIS_KEYS.SERVICES, [service.id]);
    });

  private taskFilterServiceIds = async (input: string[]): Promise<string[]> => {
    if (input.length === 0) {
      return await this.redis.smembers(REDIS_KEYS.SERVICES);
    }

    const isId = await Promise.all(
      input.map((id) => this.redis.exists([REDIS_KEYS.SERVICE(id)]))
    );
    const serviceName = await this.redis.mget(
      input.map(REDIS_KEYS.SERVICE_BY_NAME) as [string, ...string[]]
    );
    return input
      .map((idOrName, i) => {
        if (isId[i]) {
          return idOrName;
        }
        return serviceName[i] ?? null;
      })
      .filter((id) => id !== null) as string[];
  };

  taskList: (query: TaskListQuery) => Promise<Task[]> =
    API.shape.taskList.implement(async (query) => {
      // This will need significant changes if we ever support more than one filter type
      const serviceIds = await this.taskFilterServiceIds(
        query.filters.service ?? []
      );
      return await Promise.all(
        serviceIds.map((id) => this.lookupTasks(id))
      ).then((tasks) => tasks.flat());
    });

  serviceUpdate: (
    idOrName: string,
    version: number,
    newSpec: ServiceSpec
  ) => Promise<void> = API.shape.serviceUpdate.implement(
    async (idOrName, version, newSpec) => {
      const service = await this.lookupService(idOrName);
      if (service === null) {
        throw new Error(`service not found: ${idOrName}`);
      }
      if (service.version !== version) {
        throw new Error(
          `service version mismatch: expected ${service.version.toString()} got ${version.toString()}`
        );
      }

      // We could be much smarter about this probably, but... good enough?
      service.spec = newSpec;
      service.version += 1;
      await this.redis.set(
        REDIS_KEYS.SERVICE(service.id),
        JSON.stringify(service)
      );

      await this.scaleDown(service);
      await this.scaleUp(service);
    }
  );
}
