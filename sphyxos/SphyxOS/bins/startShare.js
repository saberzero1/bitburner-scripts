import { getServersLight, doScriptKill } from "SphyxOS/util.js";
/** @param {NS} ns */
export async function main(ns) {
    const servers = await getServersLight(ns);

    for (const server of servers) {
        if (!ns.args.includes("stop")) {
            const reserved = server === "home" ? 32 : 0;
            const threads = Math.floor(
                (ns.getServerMaxRam(server) -
                    ns.getServerUsedRam(server) -
                    reserved) /
                    4,
            );

            if (ns.hasRootAccess(server) && threads > 0) {
                ns.scp("SphyxOS/basic/share.js", server, "home");
                ns.exec("SphyxOS/basic/share.js", server, threads);
            }
        } else {
            await doScriptKill(ns, "SphyxOS/basic/share.js", server);
        }
    }
}
