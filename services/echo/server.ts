import { BaseService, RequestEvent, useRequestEvents } from "rpc/server";
import { z } from "zod";
import { ECHO as PORT } from "rpc/PORTS";
import { Request, APIImpl, Res } from "rpc/types";

export const API = z.object({
  echo: z.function().args(z.string()).returns(z.string()),
  listFiles: z.function().args(z.string()).returns(z.array(z.string())),
});
export type API = z.infer<typeof API>;

export class EchoService
  extends BaseService<RequestEvent>
  implements APIImpl<API>
{
  override async setup() {
    useRequestEvents({
      service: this,
      portNumber: PORT,
      clearPort: true,
      multiplexer: this.eventMultiplexer,
      ns: this.ns,
      log: this.log,
    });
    return Promise.resolve();
  }

  echo = async (req: Request, res: Res) => {
    const [msg] = API.shape.echo.parameters().parse(req.args);
    const result = API.shape.echo.returnType().parse(msg);
    await res.success(result);
  };

  listFiles = async (req: Request, res: Res) => {
    const [host] = API.shape.listFiles.parameters().parse(req.args);
    const files = API.shape.listFiles.returnType().parse(this.ns.ls(host));
    await res.success(files);
  };
}
