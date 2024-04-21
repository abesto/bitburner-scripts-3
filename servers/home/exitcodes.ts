import { ExitCodeSubscriber } from "lib/exitcode";
import { Log } from "lib/log";
import { redisClient } from "services/redis/client";

export const main = async (ns: NS) => {
  const subscriber = new ExitCodeSubscriber(redisClient(ns));
  const log = new Log(ns, "exitcodes");
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, no-constant-condition
  while (true) {
    log.info("polling");
    const events = await subscriber.poll(60000);
    log.info("poll finished", { events });
    for (const event of events) {
      log.tinfo("exitcode", event);
    }
  }
};
