export const LABELS = {
  /**
   * Service tag
   * If unspecified or not "true": only schedule tasks if all required tasks could be allocated; otherwise fail, and start no tasks.
   * If "true": schedule tasks for the service, even if not all the requested tasks can be scheduled.
   */
  ALLOCATOR_ALLOW_PARTIAL: "allocator.allow-partial",

  /**
   * Node tag
   * If set to a number, the node will be considered to have that much less RAM (in GBs) than it actually does.
   * This is useful on `home` to reserve some RAM for running scripts.
   */
  ALLOCATOR_PRESERVE_RAM: "allocator.preserve-ram",

  /**
   * Identifies which stack, if any, this service is part of
   */
  STACK_NAMESPACE: "com.docker.stack.namespace",

  /**
   * Name of the service, as defined in the Compose file
   */
  STACK_SERVICE_NAME: "com.docker.stack.service.name",

  // Roughly as seen in https://crazymax.dev/swarm-cronjob/usage/docker-labels/
  CRONJOB_ENABLED: "swarm.cronjob.enabled",
  CRONJOB_SCHEDULE: "swarm.cronjob.schedule",
};

export const REDIS_KEYS = {
  /**
   * Redis key under which Docker events are published (stream)
   */
  EVENTS: "docker.events",

  NODES: "docker:nodes",
  NODE: (id: string) => `docker:node:${id}`,

  SERVICES: "docker:services",
  SERVICE: (id: string) => `docker:service:${id}`,
  SERVICE_BY_NAME: (name: string) => `docker:servicebyname:${name}`,

  TASKS: (serviceId: string) => `docker:service:${serviceId}:tasks`,
  TASK: (serviceId: string, taskId: string) =>
    `docker:service:${serviceId}:task:${taskId}`,
  PID_TO_TASK: (pid: number) => `docker:pid:${pid.toString()}`, // value: Redis key of the task (docker:service:ID:task:ID)
};
