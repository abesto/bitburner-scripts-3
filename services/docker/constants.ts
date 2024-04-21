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
