---
to: servers/home/services/<%= h.changeCase.camel(name) %>.ts
---
import { <%= h.changeCase.pascal(name) %>Service as Service } from "services/<%= h.changeCase.camel(name) %>/server";

export const main = async (ns: NS) => {
  const service = new Service(ns);
  await service.listen();
};
