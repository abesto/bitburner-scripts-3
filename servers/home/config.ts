import mkConfig, { ConfigShape } from "lib/config";
import { maybeZodErrorMessage } from "lib/error";
import { highlightJSON } from "lib/fmt";
import { Log } from "lib/log";

export const main = async (ns: NS) => {
  const log = new Log(ns, "config");

  const config = mkConfig(ns);

  const [prefixOrKey, newValue] = ns.args;

  try {
    if (ns.args.length >= 2) {
      const oldValue = await config.set(
        prefixOrKey.toString() as keyof ConfigShape,
        newValue
      );
      log.tinfo(
        `${prefixOrKey.toString()} = ${highlightJSON(
          newValue
        )} (was: ${highlightJSON(oldValue)})`
      );
      return;
    }

    const prefixMatch = (key: string) =>
      ns.args.length === 0 || key.startsWith(prefixOrKey.toString());

    for (const key of ConfigShape.keyof().options) {
      if (prefixMatch(key)) {
        ns.tprintf(`${key} = ${highlightJSON(await config.get(key))}`);
      }
    }
  } catch (error) {
    log.terror(maybeZodErrorMessage(error));
  }
};
