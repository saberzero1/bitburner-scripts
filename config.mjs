import { context } from "esbuild";
import { BitburnerPlugin } from "esbuild-bitburner-plugin";
import http from "node:http";

const buildOnly = process.argv.includes("--build");

// Local RPC bridge: lets other local tools (e.g. Claude Code) send Remote API calls through the plugin's
// game connection while `npm start` is running. Bound to 127.0.0.1 only. Disable with BB_RPC_BRIDGE=0.
// Usage: curl -s localhost:12526 -d '{"method":"getAllServers"}'
const RPC_BRIDGE_PORT = 12526;
let rpcBridge = null;
const rpcBridgeExtension = {
    afterConnect(remoteAPI) {
        if (buildOnly || process.env.BB_RPC_BRIDGE === "0" || rpcBridge) return;
        rpcBridge = http.createServer((req, res) => {
            let body = "";
            req.on("data", (chunk) => (body += chunk));
            req.on("end", async () => {
                res.setHeader("Content-Type", "application/json");
                try {
                    const { method, params } = JSON.parse(body);
                    const response = await remoteAPI.write({ method, params });
                    res.end(JSON.stringify(response));
                } catch (error) {
                    res.statusCode = 500;
                    res.end(JSON.stringify({ error: String(error?.message ?? error) }));
                }
            });
        });
        rpcBridge.listen(RPC_BRIDGE_PORT, "127.0.0.1", () =>
            console.log(`RPC bridge listening on 127.0.0.1:${RPC_BRIDGE_PORT}`),
        );
    },
};

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
            extensions: [rpcBridgeExtension],
        }),
    ],
    bundle: false,
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
