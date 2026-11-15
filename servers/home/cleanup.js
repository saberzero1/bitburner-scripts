const argsSchema = [
    ["darknet", false], // Also clear Temp/ on known darknet servers (and darkweb)
    ["legacy", false], // Only remove leftover temp files from older script versions (home + known darknet servers). Safe while scripts run.
];

// Temp files that older script versions created with per-call names. Current code never creates these,
// so deleting them can't interfere with running scripts.
const legacyPatterns = [
    /^Temp\/dnet-task-\d+\.js$/, // darknet-probe: one script per call id (now one per command)
    /^Temp\/lab-solver-\d+\.js$/, // darknet-probe labyrinth solver (now Temp/lab-solver.js)
    /^Temp\/ram-free-\d+\.(js|txt)$/, // darknet-probe RAM freeing (now ram-free-local/remote.js)
    /^Temp\/stasis-pwd-helper-.+\.js$/, // darknet.js: one per host (now Temp/stasis-pwd-helper.js)
    /^Temp\/darknet-probe-helper-\d+\.js$/, // darknet.js discovery: one per counter
    /\.txt\.([1-9]|1\d|20)\.js$/, // helpers.js temp scripts on completion ports 1-20 (now 9000+)
    /\.txt\.90\d\d\.js$/, // helpers.js temp scripts named without a command hash (now name.<hash>.<port>.js)
];

export function autocomplete(data) {
    data.flags(argsSchema);
    return [];
}

/**
 * Removes temp files. Files belonging to running scripts can't be removed and are skipped.
 * --darknet: also clears Temp/ on every darknet server we know about.
 * --legacy:  only removes leftover files from older script versions, on home and known darknet servers.
 * @param {NS} ns **/
export async function main(ns) {
    const options = ns.flags(argsSchema);
    const includeDarknet = options.darknet || options.legacy;
    const hosts = new Set(["home"]);
    if (includeDarknet) {
        hosts.add("darkweb");
        try {
            const known = JSON.parse(ns.read("/data/darknet-passwords.txt") || "{}");
            for (const host of Object.keys(known)) hosts.add(host);
        } catch {}
        try {
            for (const host of ns.dnet.getStasisLinkedServers()) hosts.add(host);
        } catch {}
    }
    const shouldRemove = (file) =>
        !options.legacy ||
        legacyPatterns.some((p) => p.test(file.replace(/^\//, "")));
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
            if (!shouldRemove(file)) continue;
            if (ns.rm(file, host)) removed++;
            else {
                failed++;
                ns.print(`Failed to remove ${host}:${file}`);
            }
        }
    }
    const summary =
        `Removed ${removed} ${options.legacy ? "legacy " : ""}temp files across ${hosts.size} servers` +
        (failed ? ` (${failed} could not be removed, probably in use)` : "");
    // Only notify the terminal for explicit darknet runs, or when legacy cleanup actually found something
    if (options.darknet || (options.legacy && removed > 0)) ns.tprint(summary);
    else ns.print(summary);
}
