import { BaseService } from "rpc/server";
import { z } from "zod";
import * as PORTS from "rpc/PORTS";

export const API = z.object({
  echo: z.function().args(z.string()).returns(z.string()),
  listFiles: z.function().args(z.string()).returns(z.array(z.string())),
});
export type API = z.infer<typeof API>;

export class EchoService extends BaseService implements API {
  getPortNumber() {
    return PORTS.ECHO;
  }
  echo = API.shape.echo.implement((message) => message);
  listFiles = API.shape.listFiles.implement((host) => this.ns.ls(host));
}
