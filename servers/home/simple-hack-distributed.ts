import { AutocompleteData, Server } from "NetscriptDefinitions";
import { Formulas } from "lib/Formulas";
import { cliMain, makeCli } from "lib/cli";

import { Fmt } from "lib/fmt";
import { Log } from "lib/log";
import { DockerClient, dockerClient } from "services/docker/client";
import { LABELS } from "services/docker/constants";

const name = "simple-hack-distributed";
const service_label = "simplehack.hostname";

export const main = cliMain(
  name,
  makeCli({
    name,
    describe:
      "Simple distributed hacking: grow, weaken, hack, weaken sequentialy",
  }).command({
    command: "hack <host>",
    describe: "Do the thing",
    builder: (yargs) =>
      yargs.positional("host", {
        type: "string",
        describe: "Hostname to hack",
        demandOption: true,
      }),
    handler: async ({ ns, log, host }) => {
      const fmt = new Fmt(ns);
      const docker = dockerClient(ns);
      const formulas = new Formulas(ns);

      for (const service of await docker.serviceList({
        label: { [service_label]: host },
      })) {
        await docker.serviceDelete(service.id);
      }

      const mySchedule = schedule.bind({}, docker, log, fmt);

      // eslint-disable-next-line no-constant-condition, @typescript-eslint/no-unnecessary-condition
      while (true) {
        const server = ns.getServer(host);
        if (shouldWeaken(log, server)) {
          await mySchedule(
            "weaken",
            host,
            formulas.weakenToMinimum(server),
            formulas.getWeakenTime(server)
          );
        } else if (shouldGrow(log, fmt, server)) {
          await mySchedule(
            "grow",
            host,
            formulas.growthToTargetMoneyRatio(server, 1),
            formulas.getGrowTime(server)
          );
        } else {
          await mySchedule(
            "hack",
            host,
            formulas.hacksFromToMoneyRatio(server, 1, 0.3),
            formulas.getHackTime(server)
          );
        }
      }
    },
  })
);

async function schedule(
  docker: DockerClient,
  log: Log,
  fmt: Fmt,
  kind: string,
  host: string,
  wantThreads: number,
  eta: number
): Promise<void> {
  log.info("Starting batch", {
    kind,
    host,
    eta: fmt.time(eta),
  });
  await docker.run({
    name: `simplehack_${host}_${kind}`,
    command: "payload.js",
    args: [kind, host],
    threads: wantThreads,
    resources: { memory: 1.75 },
    labels: {
      [service_label]: host,
      [LABELS.ALLOCATOR_ALLOW_PARTIAL]: "true",
    },
  });
  log.info("Batch finished", { kind, host, wantThreads });
}

function shouldWeaken(log: Log, server: Server): boolean {
  const minSecurity = server.minDifficulty ?? 0;
  const currentSecurity = server.hackDifficulty ?? 0;
  //const threshold =
  //(await db(ns, log)).config.simpleHack.securityThreshold + minSecurity;
  const threshold = 0.2 + minSecurity;

  if (currentSecurity > threshold) {
    log.info("Security needs weakening", {
      host: server.hostname,
      currentSecurity,
      threshold,
    });
    return true;
  }
  return false;
}

function shouldGrow(log: Log, fmt: Fmt, server: Server): boolean {
  const moneyAvailable = server.moneyAvailable ?? 0;
  const moneyCapacity = server.moneyMax ?? 0;
  const threshold = moneyCapacity * 0.9;
  //(await db(ns, log)).config.simpleHack.moneyThreshold * moneyCapacity;

  if (moneyAvailable < threshold) {
    log.info("Money needs growing", {
      host: server.hostname,
      moneyAvailable: fmt.money(moneyAvailable),
      threshold: fmt.money(threshold),
    });
    return true;
  }
  return false;
}

export function autocomplete(data: AutocompleteData, args: string[]): string[] {
  if (args.length === 1) {
    return data.servers.filter((server) =>
      server.startsWith(args[0] as string)
    );
  }
  return [];
}
