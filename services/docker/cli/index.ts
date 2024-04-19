import * as node from "./node";
import * as service from "./service";
import * as swarm from "./swarm";
import * as stack from "./stack";

export const name = "docker";
export const describe = "Like the real Docker, but with more JavaScript!";
export const commands = [node, service, stack, swarm];
