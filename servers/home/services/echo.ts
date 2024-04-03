import { EchoService } from "services/echo/server";

export const main = async (ns: NS) => {
  const service = new EchoService(ns);
  await service.listen();
};
