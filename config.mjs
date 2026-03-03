import { context } from "esbuild";
import { BitburnerPlugin } from "esbuild-bitburner-plugin";
import { RamDodgerExtension } from "ramdodger-extension";

const buildOnly = process.argv.includes("--build");

const ctx = await context({
    entryPoints: [
        "servers/**/*.js",
        "servers/**/*.jsx",
        "servers/**/*.ts",
        "servers/**/*.tsx",
    ],
    outbase: "./servers",
    outdir: "./build",
    plugins: [
        BitburnerPlugin({
            port: 12525,
            types: "NetscriptDefinitions.d.ts",
            usePolling: true,
            extensions: [RamDodgerExtension],
        }),
    ],
    bundle: true,
    format: "esm",
    platform: "browser",
    logLevel: "debug",
});

await ctx.rebuild();

if (buildOnly) {
    await ctx.dispose();
    process.exit(0);
} else {
    ctx.watch();
}
