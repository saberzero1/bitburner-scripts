import {
    log,
    unEscapeArrayArgs,
    getConfiguration,
    getFilePath,
    waitForProcessToComplete,
    runCommand,
    getNsDataThroughFile,
    formatMoney,
    getErrorInfo,
    getActiveSourceFiles,
    tail,
} from "./helpers.js";

const argsSchema = [
    ["enable-logging", false], // Set to true to pop up a tail window and generate logs.
    ["kill-all-scripts", false], // Set to true to kill all running scripts before running.
    ["no-deleting-remote-files", false], // By default, if --kill-all-scripts, we will also remove remote files to speed up save/reload
    ["on-completion-script", null], // Spawn this script when max-charges is reached
    ["on-completion-script-args", []], // Optional args to pass to the script when launched
];
export function autocomplete(data, args) {
    data.flags(argsSchema);
    const lastFlag = args.length > 1 ? args[args.length - 2] : null;
    if (["--on-completion-script"].includes(lastFlag)) return data.scripts;
    return [];
}

/** @param {NS} ns **/
export async function main(ns) {
    const options = getConfiguration(ns, argsSchema);
    if (!options) return; // Invalid options, or ran in --help mode.
    const verbose = options["enable-logging"];
    if (verbose) tail(ns);
    else ns.disableLog("ALL");

    const doc = eval("document");

    // Step 1: Check if we're already banned from the casino
    if (ns.getMoneySources().sinceInstall?.casino >= 10e9) {
        log(ns, "ERROR: Already banned from the casino!", true, "error");
        return;
    }

    // Step 2: Check for SF4 (singularity access) to auto-travel
    let hasSF4 = false;
    try {
        const sourceFiles = await getActiveSourceFiles(ns, true, true);
        hasSF4 = (sourceFiles[4] ?? 0) >= 1; // travel/navigation only needs Singularity access (SF4.1)
    } catch {
        // If we can't determine source files, we'll try manual navigation
    }

    // Step 3: Go to Aevum if we aren't already there
    const player = ns.getPlayer();
    if (player.city !== "Aevum") {
        if (player.money < 2e5) {
            log(
                ns,
                "ERROR: Sorry, you need at least 200k to travel to Aevum.",
                true,
                "error",
            );
            return;
        }
        if (hasSF4) {
            let travelled = false;
            try {
                travelled = await getNsDataThroughFile(
                    ns,
                    "ns.singularity.travelToCity(ns.args[0])",
                    null,
                    ["Aevum"],
                );
            } catch {}
            if (!travelled) {
                log(ns, "ERROR: Failed to travel to Aevum.", true, "error");
                return;
            }
        } else {
            log(
                ns,
                "INFO: You need to manually travel to Aevum for the casino.",
                true,
            );
            return;
        }
    }

    // Step 4: Navigate to the casino using singularity if available. The page needs a moment to render, and the
    // navigation can fail (e.g. no free RAM for the temp script): the button was looked for once, right away, and
    // missing it ended the run after --kill-all-scripts had already stopped everything (2026-11-16).
    let coinflip = null;
    for (let attempt = 0; attempt < 5 && !coinflip; attempt++) {
        if (hasSF4) {
            try {
                await getNsDataThroughFile(
                    ns,
                    "ns.singularity.goToLocation(ns.args[0])",
                    null,
                    ["Iker Molina Casino"],
                );
            } catch (err) {
                log(ns, `WARNING: Could not go to the Iker Molina Casino (attempt ${attempt + 1}): ${String(err?.message ?? err).slice(0, 200)}`);
            }
        }
        // Step 5: Find the coin flip game (give React time to render the casino page)
        for (let i = 0; i < 10 && !coinflip; i++) {
            coinflip = find(doc, "//button[contains(text(), 'coin flip')]");
            if (!coinflip) await ns.sleep(200);
        }
    }
    if (!coinflip) {
        log(
            ns,
            "ERROR: Could not find the coin flip button. Make sure you are at the Iker Molina Casino and rerun the script.",
            true,
            "error",
        );
        return;
    }

    /** @param {NS} ns
     *  Helper to kill all scripts on all other servers, except this one **/
    async function killAllOtherScripts(removeRemoteFiles) {
        // Kill processes on home (except this one)
        let pid = await runCommand(
            ns,
            `ns.ps().filter(s => s.filename != ns.args[0]).forEach(s => ns.kill(s.pid));`,
            "/Temp/kill-everything-but.js",
            [ns.getScriptName()],
        );
        await waitForProcessToComplete(ns, pid);
        log(ns, `INFO: Killed other scripts running on home...`, true);

        // Kill processes on all other servers
        const allServers = await getNsDataThroughFile(ns, "scanAllServers(ns)");
        const serversExceptHome = allServers.filter((s) => s != "home");
        pid = await runCommand(
            ns,
            "ns.args.forEach(host => ns.killall(host))",
            "/Temp/kill-all-scripts-on-servers.js",
            serversExceptHome,
        );
        await waitForProcessToComplete(ns, pid);
        log(ns, "INFO: Killed all scripts running on other hosts...", true);

        // If enabled, remove files on all other servers
        if (removeRemoteFiles) {
            pid = await runCommand(
                ns,
                "ns.args.forEach(host => ns.ls(host).forEach(file => ns.rm(file, host)))",
                "/Temp/delete-files-on-servers.js",
                serversExceptHome,
            );
            await waitForProcessToComplete(ns, pid);
            log(ns, "INFO: Removed all files on other hosts...", true);
        }
    }
    // Step 5.1: Kill all other scripts if enabled (note, we assume that if the temp folder is empty, they're already killed and this is a reload)
    if (options["kill-all-scripts"])
        await killAllOtherScripts(!options["no-deleting-remote-files"]);
    // Step 5.2: Clear the temp folder on home (all transient scripts / outputs)
    await waitForProcessToComplete(ns, ns.run(getFilePath("cleanup.js")));

    if (verbose) log(ns, "Started. Hold on! Calculating sequence...");
    // We killed every other script (including autopilot), so whatever happens, relaunch the completion script
    const runCompletionScript = () => {
        const completionScript = options["on-completion-script"];
        if (!completionScript) return;
        const completionArgs = unEscapeArrayArgs(options["on-completion-script-args"].map(String));
        if (ns.run(completionScript, 1, ...completionArgs))
            log(ns, `INFO: Launching ${completionScript}...`);
        else log(ns, `WARNING: Failed to launch ${completionScript}...`, false, "warning");
    };

    // Step 6: Find the game buttons and input. The coin flip page needs a moment to render after the click: looking
    // once, right away, missed the input and ended the run with everything killed (2026-11-19, BN12.93).
    let tails = null, heads = null, input = null;
    for (let i = 0; i < 25 && !(tails && heads && input); i++) {
        if (i % 5 == 0) click(find(doc, "//button[contains(text(), 'coin flip')]") ?? coinflip);
        await ns.sleep(200);
        tails = find(doc, "//button[contains(text(), 'Tail!')]");
        heads = find(doc, "//button[contains(text(), 'Head!')]");
        input = find(doc, "//input[@type='number']");
    }
    if (!(tails && heads && input)) {
        log(ns, "ERROR: Could not find the coin flip game's buttons and bet amount input!", true, "error");
        return runCompletionScript();
    }

    // Step 7: Record a sequence of 1024 coin flip outcomes (bet $0 so we don't lose anything)
    const sequence = [];
    input.value = 0;
    if (ns.ui.getGameInfo()?.versionNumber >= 44) {
        const event1 = { target: { value: 0 } };
        const tmp = Object.getOwnPropertyNames(input)
            .filter((p) => p.includes("__reactProps"))
            .pop();
        const prop = input[tmp];
        prop.onChange(event1);
    }

    for (let i = 0; i < 1024; i++) {
        click(tails);
        let isTails;
        let isHeads;
        if (ns.ui.getGameInfo()?.versionNumber >= 44) {
            isTails = find(doc, "//span[text() = 'Tail']");
            isHeads = find(doc, "//span[text() = 'Head']");
        } else {
            isTails = find(doc, "//p[text() = 'T']");
            isHeads = find(doc, "//p[text() = 'H']");
        }

        if (isTails) sequence.push("T");
        else if (isHeads) sequence.push("H");
        else {
            log(
                ns,
                "ERROR: Something went wrong while recording the sequence, aborting!",
                true,
                "error",
            );
            return runCompletionScript();
        }
        await ns.sleep(0);
    }

    // Step 8: Set the real bet and start replaying the known sequence
    let loops = 0;
    input.value = 10000;
    if (ns.ui.getGameInfo()?.versionNumber >= 44) {
        const event2 = { target: { value: 10000 } };
        const tmp = Object.getOwnPropertyNames(input)
            .filter((p) => p.includes("__reactProps"))
            .pop();
        const prop = input[tmp];
        prop.onChange(event2);
    }
    if (verbose) log(ns, "Sequence recorded. Replaying to win money...");
    await ns.sleep(4);

    // Try to navigate to the terminal so the user can do other things
    try {
        const terminal = [
            ...globalThis["document"].querySelectorAll(
                "#root > div > div > div > ul > div > div > div > div",
            ),
        ];
        terminal.filter((e) => e.textContent === "Terminal")[0]?.click();
    } catch {}
    await ns.sleep(4);

    // Sanity check: every 2000 flips, casino earnings must have gone up. If not, the replayed sequence is out of step
    // (e.g. a manual click or a second instance) and we'd be betting at even odds forever.
    let earningsAtLastCheck = ns.getMoneySources().sinceInstall.casino;

    // Step 9: Execute the sequence, winning every flip
    while (true) {
        try {
            if (sequence[loops % 1024] === "T") {
                click(tails);
            } else if (sequence[loops % 1024] === "H") {
                click(heads);
            }

            if (loops % 2000 === 0) {
                await ns.sleep(4);
                if (loops > 0) {
                    const earnings = ns.getMoneySources().sinceInstall.casino;
                    const outOfStep = earnings <= earningsAtLastCheck;
                    const cantAffordBet = ns.getServerMoneyAvailable("home") < 10000;
                    if (outOfStep || cantAffordBet) {
                        log(
                            ns,
                            `ERROR: Stopping the casino: ` +
                                (outOfStep
                                    ? `earnings didn't increase over the last 2000 flips (sequence out of step?)`
                                    : `we can no longer afford the $10k bet`),
                            true,
                            "error",
                        );
                        runCompletionScript();
                        return;
                    }
                    earningsAtLastCheck = earnings;
                }
            }
            loops++;
            if (ns.getMoneySources().sinceInstall.casino >= 10_000_000_000) {
                log(
                    ns,
                    `SUCCESS: Won ${formatMoney(10e9)} at the casino! We've been kicked out.`,
                    true,
                );
                runCompletionScript();
                return;
            }
        } catch (e) {
            log(ns, `ERROR: ${getErrorInfo(e)}`, true, "error");
            runCompletionScript();
            return;
        }
    }
}

function find(doc, xpath) {
    return doc.evaluate(
        xpath,
        doc,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null,
    ).singleNodeValue;
}

function click(elem) {
    elem[Object.keys(elem)[1]].onClick({ isTrusted: true });
}
