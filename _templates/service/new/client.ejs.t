---
to: services/<%= h.changeCase.camel(name) %>/client.ts
---
import { rpcClient } from "rpc/client";
import { <%= h.changeCase.constant(name) %> as PORT } from "rpc/PORTS";
import type { <%= h.changeCase.pascal(name) %>Service } from "./server";

export const <%= h.changeCase.camel(name) %>Client = (ns: NS) => rpcClient<<%= h.changeCase.pascal(name) %>Service>(ns, PORT);
