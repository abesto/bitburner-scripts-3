import { CliContext } from "lib/cli";
import { dockerClient } from "services/docker/client";
import { ArgumentsCamelCase } from "yargs";
import { printServiceList } from "../common";

export const command = "ls";
export const aliases = ["list"];
export const describe = "List services";

export const handler = async ({
  ns,
  log,
  fmt,
}: ArgumentsCamelCase<CliContext>) => {
  const docker = dockerClient(ns);
  const services = await docker.serviceList({});
  printServiceList(log, fmt, services);
};
