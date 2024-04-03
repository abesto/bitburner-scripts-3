---
to: services/<%= h.changeCase.camel(name) %>/server.ts
---
import { BaseService } from "rpc/server";
import { z } from "zod";
import { <%= h.changeCase.constant(name) %> as PORT } from "rpc/PORTS";

export const API = z.object({
  echo: z.function().args(z.string()).returns(z.string()),
});
export type API = z.infer<typeof API>;

export class <%= h.changeCase.pascal(name) %>Service extends BaseService implements API {
  getPortNumber() {
    return PORT;
  }
  echo = API.shape.echo.implement((message) => message);
}


