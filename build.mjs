import { context } from "esbuild";
import eslint from "esbuild-plugin-eslint";
import { BitburnerPlugin } from "esbuild-bitburner-plugin";

const createContext = async () =>
  context({
    entryPoints: [
      "servers/**/*.js",
      "servers/**/*.jsx",
      "servers/**/*.ts",
      "servers/**/*.tsx",
    ],
    outbase: "./servers",
    outdir: "./build",
    plugins: [
      eslint(),
      // eslint-disable-next-line new-cap
      BitburnerPlugin({
        port: 12525,
        types: "NetscriptDefinitions.d.ts",
        mirror: {},
        distribute: {},
      }),
    ],
    bundle: true,
    format: "esm",
    platform: "browser",
    logLevel: "debug",
  });

const ctx = await createContext();
await ctx.watch();
