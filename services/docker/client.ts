import { rpcClient } from "rpc/client";
import { DOCKER as PORT } from "rpc/PORTS";
import { DockerEvent, type API } from "./types";
import { StreamSubscriber, redisClient } from "services/redis/client";
import { REDIS_KEYS } from "./constants";

export const rawDockerClient = (ns: NS) => rpcClient<API>(ns, PORT);

export const dockerClient = (ns: NS) => {
  const inner = rawDockerClient(ns);
  const redis = redisClient(ns);

  const ext = {
    run: async (opts: {
      name: string;
      command: string;
      args: string[];
      threads: number;
      resources?: { memory: number };
      labels?: Record<string, string>;
    }) => {
      const { name, command, args, threads, labels, resources } = opts;

      const serviceId = await inner.serviceCreate({
        labels: labels ?? {},
        mode: {
          type: "replicated-job",
          totalCompletions: threads,
          maxConcurrent: threads,
        },
        name: name,
        taskTemplate: {
          containerSpec: {
            args,
            command,
            labels: {},
          },
          placement: { constraints: [] },
          resources,
          restartPolicy: {
            condition: "none",
            delay: 0,
            maxAttempts: 0,
          },
        },
      });

      const subscriber = new StreamSubscriber<DockerEvent>(
        redis,
        REDIS_KEYS.EVENTS,
        (event) => DockerEvent.parse(event)
      );

      let done = false;
      while (!done) {
        const events = await subscriber.poll(Infinity);
        for (const event of events) {
          if (
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            event.type == "replicated-job-fulfilled" &&
            event.serviceId == serviceId
          ) {
            done = true;
          }
        }
      }

      await inner.serviceDelete(serviceId);
    },
  };

  return new Proxy(ext, {
    get(target, prop) {
      if (prop in ext) {
        return ext[prop as keyof typeof ext];
      }
      return inner[prop as keyof API];
    },
  }) as typeof inner & typeof ext;
};
export type DockerClient = ReturnType<typeof dockerClient>;
