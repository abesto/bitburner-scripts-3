import * as dockerCli from "services/docker/cli";
import { cliMain, makeCli } from "lib/cli";

export const main = cliMain(
  dockerCli.name,
  makeCli({ name: dockerCli.name, describe: dockerCli.describe }).command(
    dockerCli.commands
  )
);
