/** Runs scripts requested through a file, for external tooling (the Remote API can write files but not run scripts).
 * Write lines "script.js arg1 arg2" (optionally prefixed "id:" to tag them) to /Temp/cmd-queue.txt; each line is
 * run once with ns.run and the outcome appended to /Temp/cmd-results.txt. 2.6 GB. */
const QUEUE = "/Temp/cmd-queue.txt";
const RESULTS = "/Temp/cmd-results.txt";

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    if (ns.ps("home").filter((p) => p.filename === ns.getScriptName()).length > 1) return; // one runner
    while (true) {
        const text = ns.read(QUEUE);
        if (text.trim()) {
            ns.write(QUEUE, "", "w");
            for (const raw of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
                const m = raw.match(/^([\w-]+):\s*(.*)$/);
                const [tag, line] = m ? [m[1], m[2]] : ["", raw];
                if (line.startsWith("!kill ")) {
                    // "!kill script.js": kill every instance of a script on home
                    const killed = ns.scriptKill(line.slice(6).trim(), "home");
                    ns.write(RESULTS, JSON.stringify({ t: Date.now(), tag, line, killed }) + "\n", "a");
                    continue;
                }
                const [script, ...rest] = line.split(/\s+/);
                const args = rest.map((a) => (a !== "" && !isNaN(Number(a)) ? Number(a) : a));
                let pid = 0, error = null;
                try {
                    pid = ns.run(script, 1, ...args);
                } catch (e) {
                    error = String(e).slice(0, 300);
                }
                ns.write(RESULTS, JSON.stringify({ t: Date.now(), tag, line, pid, error }) + "\n", "a");
            }
        }
        await ns.sleep(1000);
    }
}
