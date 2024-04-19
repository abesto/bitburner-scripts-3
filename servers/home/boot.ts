import { maybeZodErrorMessage } from "lib/error";
import { Log } from "lib/log";
import { dockerClient } from "services/docker/client";
import { Service } from "services/docker/types";
import { redisClient } from "services/redis/client";

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

    // If there's already a Redis service registered, then inject the newly-started process
    const redis = redisClient(ns);
    let redisServiceId = await redis.get("docker:servicebyname:redis");
    if (redisServiceId) {
      const redisService = Service.parse(
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        JSON.parse((await redis.get(`docker:service:${redisServiceId}`))!)
      );
      redisService.spec.mode = { type: "replicated", replicas: 0 };
      await redis.set(
        `docker:service:${redisServiceId}`,
        JSON.stringify(redisService),
        {}
      );
      log.tinfo("Updated Redis service", { id: redisServiceId, replicas: 0 });
    }

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

    // Create new Redis service if there isn't one
    const docker = dockerClient(ns);
    if (!redisServiceId) {
      redisServiceId = await docker.serviceCreate({
        name: "redis",
        labels: {},
        mode: { type: "replicated", replicas: 0 },
        taskTemplate: {
          containerSpec: {
            labels: {},
            command: "services/redis.js",
            args: [],
          },
          restartPolicy: {
            condition: "any",
            delay: 0,
            maxAttempts: 0,
          },
          placement: {
            constraints: [],
          },
        },
      });
      log.tinfo("Created Redis service", { id: redisServiceId });
    }

    // Register Redis service
    const redisTaskId = await docker.taskRegister({
      serviceId: redisServiceId,
      pid: redisProcess.pid,
      replicas: 1,
    });

    log.tinfo("Registered Redis task", { id: redisTaskId });

    log.tinfo("Booted!", { redisPid: redisProcess.pid, dockerPid });
  } catch (e) {
    log.terror(maybeZodErrorMessage(e));
  }
};
