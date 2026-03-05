import { getServersLight, terminal, hasBN, proxy } from "SphyxOS/util.js";
/** @param {NS} ns */
export async function main(ns) {
    let servers = await getServersLight(ns);
    servers = servers.filter((s) => !ns.getServer(s).purchasedByPlayer);
    servers.sort();
    let target = await ns.prompt("Select target:", {
        type: "select",
        choices: servers,
    });
    if (target === "") return;
    const path = [target];
    while ((target = ns.scan(target)[0]) !== "home") path.unshift(target);
    path.unshift("home");
    if (await hasBN(ns, 4, 2))
        for (const host of path) await proxy(ns, "singularity.connect", host);
    else terminal("connect " + path.join(";connect "));
}
