import {
    log,
    disableLogs,
    getFilePath,
    getConfiguration,
    formatNumberShort,
    formatRam,
    getNsDataThroughFile,
    waitForProcessToComplete,
    getActiveSourceFiles,
    instanceCount,
    unEscapeArrayArgs,
    tail,
} from "./helpers.js";

// Name of the external script that will be created and called to generate charges
const chargeScript = "/Temp/stanek.js.charge.js";
let awakeningRep = 1e6,
    serenityRep = 100e6; // Base reputation cost - can be scaled by bitnode multipliers

const argsSchema = [
    ["reserved-ram", 32], // Don't use this RAM
    ["reserved-ram-ideal", 128], // Leave up to this much RAM free: 1/8 of home's RAM, capped at this (and at least reserved-ram)
    ["max-charges", 120], // Stop charging when all fragments have this many charges (diminishing returns - num charges is ^0.07 )
    ["charge-cap", ""], // Per-fragment charge targets below --max-charges, "id:charges,..." (autopilot: "18:120" for the charisma
    // fragment beside the hacking pair after The Red Pill: it only needs to lift darknet money, not 1000 charges)
    ["repeak", false], // Don't exit at --max-charges: charge again whenever a call twice the current peak becomes possible (autopilot: before The Red Pill)
    ["hacknet-helpers", false], // Also charge from every hacknet server at once (autopilot: after The Red Pill, with --max-charges 1000)
    ["on-startup-script", null], // Spawn this script when stanek is launched
    ["on-startup-script-args", []], // Args for the above
    // Off by default: the default startup/completion script was a plain daemon.js (with stale args), which killed
    // autopilot's daemon. autopilot.js launches daemon.js itself.
    ["no-startup-script", true],
    ["on-completion-script", null], // Spawn this script when max-charges is reached
    ["on-completion-script-args", []], // Optional args to pass to the script when launched
    ["no-completion-script", true],
    ["no-tail", true], // Tail windows stay closed by default (open them from the dashboard). Set to false to keep one open while charging (home is unusable meanwhile)
    ["reputation-threshold", 0.2], // By default, if we are this close to the rep needed for an unowned stanek upgrade (e.g. "Stanek's Gift - Serenity"), we will keep charging despite the 'max-charges' setting
];

export function autocomplete(data, args) {
    data.flags(argsSchema);
    return [];
}

let options,
    currentServer,
    maxCharges,
    idealReservedRam,
    chargeAttempts,
    sf4Level,
    shouldContinueForAug,
    helperHosts = [], // hacknet servers charging alongside home (--hacknet-helpers)
    helpersScannedAt = 0;

/** Maximizes charge on stanek fragments based on current home RAM.
 * NOTE: You should have no other scripts running on home while you do this to get the best peak charge possible
 *       Stanek stats benefit more from charges with a high avg RAM used per charge, rather than just more charges.
 * @param {NS} ns **/
export async function main(ns) {
    const runOptions = getConfiguration(ns, argsSchema);
    if (!runOptions || (await instanceCount(ns)) > 1) return; // Prevent multiple instances of this script from being started, even with different args.
    options = runOptions; // We don't set the global "options" until we're sure this is the only running instance
    disableLogs(ns, ["sleep", "run", "getServerMaxRam", "getServerUsedRam"]);

    // Validate whether we can run
    if ((await getActiveFragments(ns)).length == 0) {
        // Try to run our helper script to set up the grid
        const pid = ns.run(getFilePath("stanek.js.create.js"));
        if (pid) await waitForProcessToComplete(ns, pid);
        else
            log(
                ns,
                "ERROR while attempting to run stanek.js.create.js (pid was 0)",
            );
        // Verify that this worked.
        if ((await getActiveFragments(ns)).length == 0)
            return log(
                ns,
                "ERROR: You must manually populate your stanek grid with your desired fragments before you run this script to charge them.",
                true,
                "error",
            );
    }

    currentServer = await getNsDataThroughFile(ns, `ns.getHostname()`);
    maxCharges = options["max-charges"]; // Don't bother adding charges beyond this amount
    idealReservedRam = 32; // Reserve this much RAM, if it wouldnt make a big difference anyway. Leaves room for other temp-scripts to spawn.
    let startupScript = options["on-startup-script"];
    let startupArgs = unEscapeArrayArgs(options["on-startup-script-args"]);
    if (!startupScript && !options["no-startup-script"]) {
        startupScript = getFilePath("daemon.js");
        if (startupArgs.length == 0)
            startupArgs = ["--reserved-ram", `${ns.getServerMaxRam("home")}`];
    }
    if (startupScript) {
        // If so configured, launch the start-up script to run alongside stanek and let it consume the RAM it needs before initiating stanek loops.
        if (ns.run(startupScript, 1, ...startupArgs)) {
            log(
                ns,
                `INFO: Stanek.js is launching accompanying 'on-startup-script': ${startupScript}...`,
                false,
                "info",
            );
            await ns.sleep(1000); // Give time for the accompanying script to start up and consume its required RAM footprint.
        } else
            log(
                ns,
                `WARNING: Stanek.js has started successfully, but failed to launch accompanying 'on-startup-script': ${startupScript}...`,
                false,
                "warning",
            );
    }
    chargeAttempts = {}; // We keep track of how many times we've charged each segment, to work around a placement bug where fragments can overlap, and then don't register charge

    const chargeScriptBody =
        "export async function main(ns) { await ns.stanek.chargeFragment(ns.args[0], ns.args[1]); }";
    const checkOnChargeScript = () => {
        // We must use this periodically since cleanup might be run while we're charging.
        // Check if our charge script exists. If not, we can create it (facilitates copying stanek.js to a new server to run)
        if (ns.read(chargeScript) != chargeScriptBody)
            ns.write(chargeScript, chargeScriptBody, "w");
    };

    // Check what augs we own and establish the theshold to continue grinding REP if we're close to one.
    const ownedSourceFiles = await getActiveSourceFiles(ns);
    sf4Level = ownedSourceFiles[4] || 0;
    shouldContinueForAug = () => false;
    if (sf4Level == 0) {
        log(
            ns,
            `INFO: SF4 required to get owned faction rep and augmentation info. Ignoring the --reputation-threshold setting.`,
        );
    } else {
        const ownedAugmentations = await getNsDataThroughFile(
            ns,
            `ns.singularity.getOwnedAugmentations(true)`,
            "/Temp/player-augs-purchased.txt",
        );
        const [strAwakening, strSerenity] = [
            "Stanek's Gift - Awakening",
            "Stanek's Gift - Serenity",
        ];
        const [awakeningOwned, serenityOwned] = [
            ownedAugmentations.includes(strAwakening),
            ownedAugmentations.includes(strSerenity),
        ];
        if (!awakeningOwned || !serenityOwned) {
            [awakeningRep, serenityRep] = await getNsDataThroughFile(
                ns,
                `[${[strAwakening, strSerenity].map((a) => `ns.singularity.getAugmentationRepReq(\"${a}\")`)}]`,
                "/Temp/stanek-aug-rep-reqs.txt",
            );
            log(
                ns,
                `INFO: Stanek Augmentations Rep Requirements are Awakening: ${formatNumberShort(awakeningRep)}, ` +
                    `Serenity: ${formatNumberShort(serenityRep)} (--reputation-threshold = ${options["reputation-threshold"]})`,
            );
        }
        shouldContinueForAug = (
            currentRep, // return true if currentRep is high enough that we should keep grinding for the next unowned aug
        ) =>
            (!awakeningOwned &&
                options["reputation-threshold"] * awakeningRep <= currentRep &&
                currentRep < awakeningRep) ||
            (!serenityOwned &&
                options["reputation-threshold"] * serenityRep <= currentRep &&
                currentRep < serenityRep);
    }

    // Start the main stanek loop
    let lastLoopSuccessful = true;
    while (true) {
        await ns.sleep(lastLoopSuccessful ? 10 : 1000); // Only sleep a short while between charges if things are going well
        lastLoopSuccessful = false;
        try {
            if (!options["no-tail"]) tail(ns); // Keep a tail window open unless otherwise configured
            checkOnChargeScript();
            const fragmentsToCharge = await getFragmentsToCharge(ns);
            if (fragmentsToCharge === undefined) continue;
            if (fragmentsToCharge.length == 0) {
                // All fragments at max desired charge. With --repeak (autopilot, before The Red Pill) keep watching: the
                // peak is the biggest single call so far, and charging early in an install, while the hacknet is still
                // being rebought, left the charisma fragment at a peak of 456 for the whole install (BN12.87; 10,496 once
                // the hacknet was maxed in BN12.86): charisma 1,888 for Uber's 2,500 and a charisma graft. When a call
                // twice the current peak is possible, charge again (it raises the peak; the charge count restarts from it).
                if (!options["repeak"]) break;
                const frags = (await getActiveFragments(ns)).filter((f) => f.id < 100);
                const peak = Math.min(...frags.map((f) => f.highestCharge));
                let possible = 0;
                try {
                    possible = await getNsDataThroughFile(ns, `(() => { let best = 0; for (const h of ["home", ...ns.scan("home").filter((x) => x.startsWith("hacknet-server-"))]) {
                        const s = ns.getServer(h); best = Math.max(best, (s.maxRam - s.ramUsed) / 2 * (1 + (s.cpuCores - 1) / 16)); } return best; })()`,
                        "/Temp/stanek-possible-peak.txt");
                } catch {}
                if (frags.length && possible > 2 * peak) {
                    log(ns, `INFO: A charge call of ~${formatNumberShort(possible)} is now possible (peak ${formatNumberShort(peak)}): charging again to raise the peak.`);
                    lastLoopSuccessful = await tryChargeAllFragments(ns, frags);
                } else await ns.sleep(60_000);
                continue;
            }
            lastLoopSuccessful = await tryChargeAllFragments(
                ns,
                fragmentsToCharge,
            );
        } catch (err) {
            log(
                ns,
                `WARNING: stanek.js Caught (and suppressed) an unexpected error in the main loop:\n` +
                    (typeof err === "string"
                        ? err
                        : err.message || JSON.stringify(err)),
                false,
                "warning",
            );
        }
    }
    log(
        ns,
        `SUCCESS: All stanek fragments at desired charge ${maxCharges}`,
        true,
        "success",
    );

    // Run the completion script before shutting down
    let completionScript = options["on-completion-script"];
    if (!completionScript && !options["no-completion-script"])
        completionScript = getFilePath("daemon.js");
    let completionArgs = unEscapeArrayArgs(
        options["on-completion-script-args"],
    );
    if (completionScript) {
        if (ns.run(completionScript, 1, ...completionArgs)) {
            log(
                ns,
                `INFO: Stanek.js shutting down and launching ${completionScript}...`,
                false,
                "info",
            );
            if (!options["no-tail"]) ns.ui.closeTail(); // Close the tail window if we opened it
        } else
            log(
                ns,
                `WARNING: Stanek.js shutting down, but failed to launch ${completionScript}...`,
                false,
                "warning",
            );
    }
}

/** Get Fragments to Charge
 * @param {NS} ns
 * @returns {Promise<ActiveFragment[]>} whether all fragments were charged successfully **/
async function getFragmentsToCharge(ns) {
    // Make sure we have the latest information about all fragments
    let fragments = await getActiveFragments(ns);
    if (fragments.length == 0) {
        log(
            ns,
            "ERROR: Stanek fragments were cleared. You must re-populate the grid before charging can continue.",
            true,
            "error",
        );
        return undefined;
    }
    // If we have SF4, get our updated faction rep, and determine if we should continue past --max-charges to earn rep for the next augmentation
    const churchRep = sf4Level
        ? await getNsDataThroughFile(
              ns,
              "ns.singularity.getFactionRep(ns.args[0])",
              null,
              ["Church of the Machine God"],
          )
        : 0;
    const shouldContinue = shouldContinueForAug(churchRep);

    // Collect information about each fragment's charge status, and prepare a status update
    let fragmentSummary = "";
    let minCharges = Number.MAX_SAFE_INTEGER;
    for (const fragment of fragments) {
        fragmentSummary +=
            `Fragment ${String(fragment.id).padStart(2)} at [${fragment.x},${fragment.y}] ` +
            (fragment.id < 100
                ? `Peak: ${formatNumberShort(fragment.highestCharge)} Charges: ${fragment.numCharge.toFixed(1)}`
                : `(booster, no charge effect)`) +
            `\n`;
        if (fragment.numCharge == 0 && (chargeAttempts[fragment.id] || 0) > 0) {
            // Ignore fragments that aren't accepting charge.
            if (chargeAttempts[fragment.id] == 1 && fragment.id < 100) {
                // First time we do this, log a message
                log(
                    ns,
                    `WARNING: Detected that fragment ${fragment.id} at [${fragment.x},${fragment.y}] is not accepting charge nano (root overlaps with another segment root?)`,
                    true,
                    "warning",
                );
                chargeAttempts[fragment.id] = 2; // Hack: We will never try to charge this fragment again. Abuse this dict value so we don't see htis log again.
            }
        } else if (fragment.id < 100)
            minCharges = Math.min(minCharges, fragment.numCharge * maxCharges / capOf(fragment)); // Track the least-charged fragment (ignoring fragments that take no charge), relative to its cap
    }
    minCharges = Math.ceil(minCharges); // Fractional charges now occur. Round these up.
    if (
        minCharges >= maxCharges &&
        !shouldContinue &&
        fragments.some((f) => (chargeAttempts[f.id] || 0) > 0)
    )
        return []; // Max charges reached
    // We will only charge non-booster fragments, and fragments that aren't stuck at 0 charge
    const fragmentsToCharge = fragments.filter(
        (f) =>
            f.id < 100 && ((chargeAttempts[f.id] || 0) < 2 || f.numCharge > 0) &&
            (shouldContinue || f.numCharge < capOf(f)), // (fragments at their --charge-cap wait for the rest)
    );
    // Log a status update
    log(
        ns,
        `Charging ${fragmentsToCharge.length}/${fragments.length} fragments ` +
            (!shouldContinue
                ? `to ${maxCharges}`
                : `until faction has ` +
                  formatNumberShort(
                      churchRep < awakeningRep ? awakeningRep : serenityRep,
                  ) +
                  ` rep (currently at ${formatNumberShort(churchRep)})`) +
            `. Curent charges:\n${fragmentSummary}`,
    );
    return fragmentsToCharge;
}

/** Try to charge all the specified fragments using available ram
 * @param {NS} ns
 * @returns {Promise<bool>} whether all fragments were charged successfully **/
async function tryChargeAllFragments(ns, fragmentsToCharge) {
    let charged = 0;
    // Charge each fragment one at a time
    for (const fragment of fragmentsToCharge) {
        let availableRam =
            ns.getServerMaxRam(currentServer) -
            ns.getServerUsedRam(currentServer);
        // Helpers' temp scripts peak above 32 GB (go.js's cheat script 35 GB, its combined turn lookup 62 GB): with 32 GB
        // left (the old 64 GB only applied below 5% of free RAM, i.e. above ~1.3 TB) charging starved them, and they
        // waited for RAM for minutes after installs (BN12.83: go.js stalled with 31 GB free of 1 TB). Charge strength
        // grows with log(threads), so leaving 1/8 of home costs little.
        const reservedRam = Math.max(options["reserved-ram"],
            Math.min(options["reserved-ram-ideal"], ns.getServerMaxRam(currentServer) / 8));
        const threads = Math.floor((availableRam - reservedRam) / 2.0);
        if (threads <= 0) {
            log(
                ns,
                `WARNING: Insufficient free RAM on ${currentServer} to charge Stanek ` +
                    `(${formatRam(availableRam)} free - ${formatRam(reservedRam)} reserved). Will try again later...`,
            );
            continue;
        }
        const pid = ns.run(
            chargeScript,
            { threads: threads, temporary: true },
            fragment.x,
            fragment.y,
        );
        // Helper charges at the same time: a fragment's bonus is ln(highestCharge + 1) x ((numCharge + 1) / 5)^0.07,
        // where highestCharge is the biggest single call (threads x the host's core bonus, 1 + (cores - 1) / 16) and each
        // call adds its size / highestCharge to numCharge. Home's call stays the biggest, but each 4 TB, 24-core hacknet
        // server adds ~0.42 charge per call (2048 x 2.44 vs home's ~8192 x 1.44): 14 of them make ~6.9 per call, so
        // 1000 charges take ~5 minutes instead of ~33 (both hacking fragments: hacking skill and exp x~1.22 vs 120 charges).
        const helperPids = [];
        // (rescanned every minute: after The Red Pill install the hacknet is rebought while we charge)
        if (options["hacknet-helpers"] && Date.now() - helpersScannedAt > 60_000) {
            helpersScannedAt = Date.now();
            try {
                helperHosts = await getNsDataThroughFile(ns, `ns.scan("home").filter((h) => h.startsWith("hacknet-server-"))`, "/Temp/stanek-helpers.txt");
            } catch {}
        }
        if (pid && options["hacknet-helpers"])
            for (const h of helperHosts) {
                try {
                    const t = Math.floor((ns.getServerMaxRam(h) - ns.getServerUsedRam(h)) / 2.0);
                    if (t < 1) continue;
                    if (!ns.fileExists(chargeScript, h)) ns.scp(chargeScript, h, "home");
                    const hp = ns.exec(chargeScript, h, { threads: t, temporary: true }, fragment.x, fragment.y);
                    if (hp) helperPids.push(hp);
                } catch {}
            }
        if (!pid) {
            log(
                ns,
                `WARNING: Failed to charge Stanek with ${threads} threads thinking there was ${formatRam(availableRam)} free on ${currentServer}. ` +
                    `Check if another script is fighting stanek.js for RAM. Will try again later...`,
            );
            continue;
        }
        await waitForProcessToComplete(ns, pid);
        for (const hp of helperPids) await waitForProcessToComplete(ns, hp);
        chargeAttempts[fragment.id] = 1 + (chargeAttempts[fragment.id] || 0);
        charged++;
    }
    // Only report success if something was actually charged. When RAM is short every fragment is skipped, and
    // reporting success would make the main loop retry every 10ms (each round spawns temp scripts), freezing the game.
    return charged > 0;
}

/** Get the current active stanek fragments
 * @param {NS} ns
 * @returns {Promise<ActiveFragment[]>} **/
async function getActiveFragments(ns) {
    return await getNsDataThroughFile(ns, "ns.stanek.activeFragments()");
}

/** A fragment's charge target: --charge-cap "id:charges,..." where given, else --max-charges. */
function capOf(fragment) {
    const caps = Object.fromEntries(String(options["charge-cap"] || "").split(",").filter((x) => x.includes(":"))
        .map((x) => x.split(":").map(Number)));
    return Math.min(caps[fragment.id] ?? maxCharges, maxCharges);
}
