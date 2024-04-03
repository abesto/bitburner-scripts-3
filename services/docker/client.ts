import { rpcClient } from "rpc/client";
import { DOCKER as PORT } from "rpc/PORTS";
import type { DockerService } from "./server";

export const dockerClient = (ns: NS) => rpcClient<DockerService>(ns, PORT);
