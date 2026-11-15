const argsSchema = [
    ["darknet", false], // Also clear Temp/ files on known darknet servers (and darkweb)
];

export function autocomplete(data) {
    data.flags(argsSchema);
    return [];
}

/**
 * Removes temp files. Files belonging to running scripts can't be removed and are skipped.
 * With --darknet, also clears Temp/ on every darknet server we know about. Older darknet scripts
 * left up to ~2000 numbered temp files per darknet server, all of which end up in the save file.
 * @param {NS} ns **/
export async function main(ns) {
    const options = ns.flags(argsSchema);
    const hosts = new Set(["home"]);
    if (options.darknet) {
        hosts.add("darkweb");
        try {
            const known = JSON.parse(ns.read("/data/darknet-passwords.txt") || "{}");
            for (const host of Object.keys(known)) hosts.add(host);
        } catch {}
        try {
            for (const host of ns.dnet.getStasisLinkedServers()) hosts.add(host);
        } catch {}
    }
    let removed = 0,
        failed = 0;
    for (const host of hosts) {
        let files = [];
        try {
            files = ns.ls(host, "Temp/");
        } catch {
            continue; // Server no longer exists (darknet servers come and go)
        }
        for (const file of files) {
            if (ns.rm(file, host)) removed++;
            else {
                failed++;
                ns.print(`Failed to remove ${host}:${file}`);
            }
        }
    }
    (options.darknet ? ns.tprint : ns.print)(
        `Removed ${removed} temp files across ${hosts.size} servers` +
            (failed ? ` (${failed} could not be removed, probably in use)` : ""),
    );
}
