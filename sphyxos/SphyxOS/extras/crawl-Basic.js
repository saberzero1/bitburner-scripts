/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    ns.clearLog();
    ns.ui.openTail();
    virus(ns);
    const servers = targets.filter(
        (s) =>
            ns.getHackingLevel() >= ns.getServerRequiredHackingLevel(s) &&
            ns.hasRootAccess(s) &&
            !ns.getServer(s).backdoorInstalled,
    ); //)
    servers.sort();
    ns.print("Stay on the terminal page or the script will fail!");
    ns.printf("Servers: %s", servers.length);
    let eta = 0;
    servers.forEach((s) => (eta += ns.getHackTime(s) / 4 + 2000));
    if (ns.ui.getGameInfo()?.versionNumber >= 44)
        ns.printf("ETA: %s", ns.format.time(eta), 3);
    else ns.printf("ETA: %s", ns.tFormat(eta), 3);
    for (let point of servers) {
        let target = point;
        const path = [target];
        while ((target = ns.scan(target)[0]) !== "home") path.unshift(target);
        path.unshift("home");
        terminal("connect " + path.join(";connect "));
        await ns.sleep(4);
        terminal("backdoor");
        await ns.sleep(4);
        if (ns.ui.getGameInfo()?.versionNumber >= 44)
            ns.printf(
                "%s - %s",
                point,
                ns.format.time(ns.getHackTime(point) / 4 + 2000),
            );
        else
            ns.printf(
                "%s - %s",
                point,
                ns.tFormat(ns.getHackTime(point) / 4 + 2000),
            );
        await ns.sleep(ns.getHackTime(point) / 4 + 2000);
    }
    if (servers.length > 0) terminal("home");
}

function terminal(text) {
    const input = eval("document").getElementById("terminal-input");
    const handler = Object.keys(input)[1];
    input[handler].onChange({ target: { value: text } });
    input[handler].onKeyDown({ key: "Enter", preventDefault: () => null });
}
function virus(ns) {
    const servers = getServersLight(ns);
    for (const server of servers) {
        try {
            ns.brutessh(server);
        } catch {}
        try {
            ns.ftpcrack(server);
        } catch {}
        try {
            ns.relaysmtp(server);
        } catch {}
        try {
            ns.httpworm(server);
        } catch {}
        try {
            ns.sqlinject(server);
        } catch {}
        try {
            ns.nuke(server);
        } catch {}
    }
}
function getServersLight(ns) {
    const serverList = new Set(["home"]);
    for (const server of serverList) {
        for (const connection of ns.scan(server)) {
            serverList.add(connection);
        }
    }
    return Array.from(serverList);
}

const targets = [
    "CSEC",
    "I.I.I.I",
    "avmnite-02h",
    "run4theh111z",
    "powerhouse-fitness",
    "fulcrumassets",
];
