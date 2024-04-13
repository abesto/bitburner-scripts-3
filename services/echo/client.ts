import { rpcClient } from "rpc/client";
import { ECHO } from "rpc/PORTS";
import type { API } from "./server";

export const echoClient = (ns: NS) => rpcClient<API>(ns, ECHO);
