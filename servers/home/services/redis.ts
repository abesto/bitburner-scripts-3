import { RedisService as Service } from "services/redis/server";

export const main = async (ns: NS) => {
  const service = new Service(ns);
  await service.listen();
};
