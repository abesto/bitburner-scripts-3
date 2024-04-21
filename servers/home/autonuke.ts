import { Server } from "NetscriptDefinitions";
import { maybeZodErrorMessage } from "lib/error";
import { withExitCode } from "lib/exitcode";
import { dockerClient } from "services/docker/client";

export function autonuke(ns: NS, server: Server, verbose?: boolean): boolean {
  if (server.hasAdminRights) {
    return true;
  }

  const host = server.hostname;
  const hackingLevel = ns.getPlayer().skills.hacking;
  const hostHackingLevel = server.requiredHackingSkill || 0;

  if (hackingLevel < hostHackingLevel) {
    if (verbose) {
      ns.print(
        `SKIP ${host}: hacking level too low: ${hackingLevel.toString()} < ${hostHackingLevel.toString()}`
      );
    }
    return false;
  }

  if (ns.fileExists("BruteSSH.exe")) {
    ns.brutessh(host);
  } else {
    if (verbose) {
      ns.print(`MISS ${host}: missing BruteSSH.exe`);
    }
  }

  if (ns.fileExists("FTPCrack.exe")) {
    ns.ftpcrack(host);
  } else {
    if (verbose) {
      ns.print(`MISS ${host}: missing FTPCrack.exe`);
    }
  }

  if (ns.fileExists("HTTPWorm.exe")) {
    ns.httpworm(host);
  } else {
    if (verbose) {
      ns.print(`MISS ${host}: missing HTTPWorm.exe`);
    }
  }

  if (ns.fileExists("SQLInject.exe")) {
    ns.sqlinject(host);
  } else {
    if (verbose) {
      ns.print(`MISS ${host}: missing SQLInject.exe`);
    }
  }

  if (ns.fileExists("relaySMTP.exe")) {
    ns.relaysmtp(host);
  } else {
    if (verbose) {
      ns.print(`MISS ${host}: missing relaySMTP.exe`);
    }
  }

  try {
    ns.nuke(host);
    return true;
  } catch (e) {
    if (verbose) {
      ns.print(`FAIL ${host}: ${maybeZodErrorMessage(e)}`);
    }
    return false;
  }
}

export function discoverServers(ns: NS): string[] {
  const queue = ["home"];
  const visited = new Set<string>();

  while (queue.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const server = queue.shift()!;
    if (visited.has(server)) {
      continue;
    }
    visited.add(server);
    const neighbors = ns.scan(server);
    for (const neighbor of neighbors) {
      queue.push(neighbor);
    }
  }

  return Array.from(visited);
}

export const main = withExitCode(async (ns: NS) => {
  const docker = dockerClient(ns);

  for (const hostname of discoverServers(ns)) {
    const server = ns.getServer(hostname);
    if (server.hasAdminRights) {
      ns.print(`SKIP ${hostname}: already have root`);
      await docker.swarmJoin(hostname);
      continue;
    }

    if (server.backdoorInstalled) {
      ns.print(`SKIP ${hostname}: backdoor already installed`);
      continue;
    }

    if (autonuke(ns, server, true)) {
      ns.print(`NUKED ${hostname}`);
      await docker.swarmJoin(hostname);
    } else {
      ns.print(`FAILED ${hostname}`);
    }
  }
});
