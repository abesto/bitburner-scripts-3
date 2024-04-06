import * as dockerCli from "services/docker/cli";
import { cliMain } from "lib/cli";

export const main = cliMain(dockerCli);
