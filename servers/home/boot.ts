import { maybeZodErrorMessage } from "lib/error";
import { Log } from "lib/log";
import { dockerClient } from "services/docker/client";
import { LABELS } from "services/docker/constants";

const SLEEP_MS = 100;

export const main = async (ns: NS) => {
  const log = new Log(ns, "boot");
  try {
    if (ns.getHostname() !== "home") {
      log.tinfo("Not running on home server, exiting");
      return;
    }

    let dockerProcess = ns.getRunningScript("services/docker.js", "home");
    if (dockerProcess) {
      log.tinfo("Docker already running, exiting", { pid: dockerProcess.pid });
      return;
    }

    // Discover / start Redis
    let redisProcess = ns.getRunningScript("services/redis.js", "home");
    if (redisProcess) {
      log.tinfo("Redis already running", { pid: redisProcess.pid });
    } else {
      log.tinfo("Starting Redis");
      const pid = ns.run("services/redis.js");
      if (pid === 0) {
        log.terror("Failed to start Redis");
        return;
      } else {
        log.tinfo("Started Redis", { pid });
      }
      await ns.asleep(SLEEP_MS);
      redisProcess = ns.getRunningScript(pid);
      if (!redisProcess) {
        log.terror("Failed to get Redis process, already crashed?", { pid });
        return;
      }
    }
    await ns.asleep(SLEEP_MS);

    // Start Docker
    const dockerPid = ns.run("services/docker.js");
    await ns.asleep(SLEEP_MS);
    log.tinfo("Started Docker", { pid: dockerPid });
    dockerProcess = ns.getRunningScript(dockerPid);
    if (!dockerProcess) {
      log.terror("Failed to get Docker process, already crashed?", {
        pid: dockerPid,
      });
      return;
    }

    const docker = dockerClient(ns);
    let redisServices = await docker.serviceList({
      label: {
        [LABELS.STACK_NAMESPACE]: "boot",
        [LABELS.STACK_SERVICE_NAME]: "redis",
      },
    });
    let redisService = redisServices[0];
    if (redisService === undefined) {
      // Create new Redis service if there isn't one
      ns.run(
        "docker.js",
        1,
        "stack",
        "deploy",
        "boot",
        "--compose-file",
        "stacks/boot.yml.txt"
      );
      await ns.sleep(100);
    }

    redisServices = await docker.serviceList({
      label: {
        [LABELS.STACK_NAMESPACE]: "boot",
        [LABELS.STACK_SERVICE_NAME]: "redis",
      },
    });
    redisService = redisServices[0];
    if (redisService === undefined) {
      log.terror("Failed to start Redis service");
      return;
    }

    // Register Redis service
    const redisTaskId = await docker.taskRegister({
      serviceId: redisService.id,
      pid: redisProcess.pid,
      replicas: 1,
    });

    log.tinfo("Registered Redis task", { id: redisTaskId });

    log.tinfo("Booted!", { redisPid: redisProcess.pid, dockerPid });
  } catch (e) {
    log.terror(maybeZodErrorMessage(e));
  }
};
