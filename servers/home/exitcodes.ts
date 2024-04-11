import { ExitCodeSubscriber } from "lib/exitcode";
import { Log } from "lib/log";

export const main = async (ns: NS) => {
  const subscriber = new ExitCodeSubscriber(ns);
  const log = new Log(ns, "exitcodes");
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, no-constant-condition
  while (true) {
    const events = await subscriber.poll();
    for (const event of events) {
      log.tinfo("exitcode", event);
    }
    await ns.sleep(1000);
  }
};
