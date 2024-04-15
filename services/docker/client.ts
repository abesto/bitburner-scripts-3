import { rpcClient } from "rpc/client";
import { DOCKER as PORT } from "rpc/PORTS";
import type { API } from "./types";

export const dockerClient = (ns: NS) => rpcClient<API>(ns, PORT);
