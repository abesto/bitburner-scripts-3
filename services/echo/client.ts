import { rpcClient } from "rpc/client";
import { ECHO } from "rpc/PORTS";
import type { EchoService } from "./server";

export const echoClient = (ns: NS) => rpcClient<EchoService>(ns, ECHO);
