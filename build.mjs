import { context } from "esbuild";
import eslint from "esbuild-plugin-eslint";
import { BitburnerPlugin } from "esbuild-bitburner-plugin";

const createContext = async () =>
  context({
    entryPoints: ["servers/**/*.ts"],
    outbase: "./servers",
    outdir: "./build",
    plugins: [
      eslint(),
      // eslint-disable-next-line new-cap
      BitburnerPlugin({
        port: 12525,
        types: "NetscriptDefinitions.d.ts",
        mirror: {},
        distribute: {
          "servers/home/static": ["home"],
        },
      }),
    ],
    bundle: true,
    format: "esm",
    platform: "browser",
    logLevel: "info",
    treeShaking: true,
  });

const ctx = await createContext();
await ctx.watch();
