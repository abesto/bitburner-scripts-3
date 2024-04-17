import { ExitCodeSubscriber } from "lib/exitcode";
import { Log } from "lib/log";

export const main = async (ns: NS) => {
  const subscriber = new ExitCodeSubscriber(ns);
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
