/** Crash logger. Copies the game's own error list (Active Scripts > Recent Errors: every runtime error dialog, with
 * script, host, PID and stack) to /data/script-crashes.txt, one JSON line per new error, so errors are on record across
 * installs and game restarts and can be matched to run times.
 * Why: BN12.139's World Daemon phase took 69 min after two runtime error dialogs were dismissed unread (they turned out to
 * be graft.js at 12.138's Red Pill purchase). ns.getRecentScripts() can't be used: it keeps the last 50 endings and
 * darknet temp scripts push a crashed script out within ~2 s.
 * The list is the engine's ErrorState module, reached through the page's webpack require (eval: no RAM cost); found by
 * searching module sources for "UnreadErrors", since module ids change between builds. Started by autopilot.js. */
const LOG_FILE = "/data/script-crashes.txt";
const MAX_FILE_CHARS = 200_000; // keep the newer half past this

function findErrorState() {
    const req = eval("window").webpack_require;
    if (typeof req !== "function" || !req.m) return null;
    for (const id of Object.keys(req.m)) {
        if (!String(req.m[id]).includes("UnreadErrors")) continue;
        let ex;
        try { ex = req(id); } catch { continue; }
        for (const k of Object.keys(ex ?? {})) {
            let v;
            try { v = ex[k]; } catch { continue; }
            if (v && typeof v === "object" && Array.isArray(v.Errors)) return v;
        }
    }
    return null;
}

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    let state = null;
    try { state = findErrorState(); } catch {}
    if (!state) return ns.print("WARN: the game's error list wasn't found (build changed?); nothing to log.");
    // Errors already listed are on record from earlier runs of this script, or predate it
    const seen = new Map(state.Errors.map((e) => [e.id, e.occurrences]));
    while (true) {
        try {
            for (const e of state.Errors) {
                if (seen.get(e.id) === e.occurrences) continue; // new, or the same error again (the list merges repeats)
                seen.set(e.id, e.occurrences);
                const line = { t: Date.now(), time: new Date(e.time).toISOString(), type: e.errorType, script: e.scriptName,
                    host: e.server, pid: e.pid ?? null, occurrences: e.occurrences, message: String(e.message).slice(0, 2000) };
                ns.write(LOG_FILE, JSON.stringify(line) + "\n", "a");
                const text = ns.read(LOG_FILE);
                if (text.length > MAX_FILE_CHARS) ns.write(LOG_FILE, text.slice(text.indexOf("\n", text.length / 2) + 1), "w");
            }
        } catch {}
        await ns.sleep(5000);
    }
}
