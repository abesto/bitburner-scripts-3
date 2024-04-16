import { DockerService as Service } from "services/docker/server";

export const main = async (ns: NS) => {
  const service = new Service(ns);
  await service.run();
};
