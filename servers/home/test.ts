import { echoClient } from "services/echo/client";

export const main = async (ns: NS) => {
  ns.clearLog();
  const echo = echoClient(ns);
  ns.print(await echo.echo("Hello, World!"));
};
