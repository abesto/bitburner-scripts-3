import { Log } from "lib/log";
import { ClientPort } from "./transport/ClientPort";
import { ServerPort } from "./transport/ServerPort";
import { Response, RpcError } from "./types";
import { fromZodError } from "zod-validation-error";
import { highlightJSON } from "lib/fmt";

// Heavily inspired by https://github.com/fgnass/typed-rpc/blob/main/src/client.ts

type Promisify<T> = T extends (...args: unknown[]) => Promise<unknown>
  ? T // already a promise
  : T extends (...args: infer A) => infer R
  ? (...args: A) => Promise<R>
  : T; // not a function;

type PromisifyMethods<T extends object> = {
  [K in keyof T]: Promisify<T[K]>;
};
export type RpcClient<T extends object> = PromisifyMethods<T>;

export const rpcClient = <T extends object>(ns: NS, portNumber: number) => {
  const log = new Log(ns, `rpcClient:${portNumber.toString()}`);
  const port = new ClientPort(ns, portNumber);

  const responsePortNumber = ns.pid + 1000;
  const responsePort = new ServerPort(ns, responsePortNumber);

  let requestSequence = 0;

  const buildRequest = (method: string, args: unknown[]) => {
    return {
      marker: "rpc/Request",
      method,
      responseMeta: {
        port: responsePortNumber,
        msgId: `${ns.pid.toString()}/${(requestSequence++).toString()}`,
      },
      args,
    };
  };

  return new Proxy(
    {},
    {
      get: (_, method: string) => {
        return async (...args: unknown[]) => {
          const request = buildRequest(method, args);
          await port.write(request);
          //log.debug("req", { request });

          const raw = await responsePort.read();
          const maybeResponse = Response.safeParse(raw);
          if (!maybeResponse.success) {
            const error = fromZodError(maybeResponse.error);
            log.error(error.message, { request });
            throw error;
          }
          //log.debug("res", { request, response: maybeResponse.data });
          log.debug(
            `${method}(${args
              .map(highlightJSON)
              .join(", ")}) => ${highlightJSON(
              maybeResponse.data.status === "success"
                ? maybeResponse.data.result
                : maybeResponse.data.error
            )}`
          );

          const data = maybeResponse.data;
          if (data.status === "error") {
            log.error("rpc-error", {
              method: request.method,
              error: data.error,
            });
            throw new RpcError(data.error);
          }

          return data.result;
        };
      },
    }
  ) as RpcClient<T>;
};
