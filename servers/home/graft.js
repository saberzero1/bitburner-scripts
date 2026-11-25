import { getConfiguration, getNsDataThroughFile, log, formatMoney, formatDuration } from "./helpers.js";

/** Grafts augmentations for whatever gates the BitNode right now (SF10).
 *
 * Grafting applies an augmentation immediately, without an install, and grafted augmentations persist across installs.
 * Each graft costs 3x the augmentation's base price and (1h * log2(sum of mults) + 30m) / 2 divided by the intelligence
 * bonus, and adds one entropy: all multipliers x0.98 per entropy until the next install (unless violet Congruity
 * Implant is installed, which it grafts first when affordable in hacking mode).
 *
 * Modes (re-evaluated before every graft):
 *  - charisma: darknet.js is stuck at a labyrinth whose charisma requirement is above ours (each labyrinth reward must
 *    be installed, and installs reset charisma; levels scale with the multiplier). BN12.76: Merciless (1500) waited
 *    1.75h+ at 1.2k charisma; Enhanced Social Interaction Implant (x1.6, $4b, 47m) clears it on its own.
 *  - hacking: The Red Pill is installed and hacking is below the World Daemon's requirement (BN12.75: 7.7k vs 13.2k,
 *    ~28h by experience alone; grafts gave x1.7+ in a few hours).
 *  - otherwise idle.
 * Picks the eligible augmentation with the most ln(gain x 0.98 entropy) per minute (counting the wait to afford it),
 * and keeps autopilot's reserve (reserve.txt).
 */
const argsSchema = [
    ["until-hack", 0], // Hacking mode target (0 = the World Daemon's requirement)
    ["min-gain", 0.03], // Only graft if ln(gain) net of entropy is at least this
    ["exp-weight", 0.05], // Weight of the matching exp multiplier relative to the level multiplier. Level = mult x (32 ln(exp) - 200)
    // with that term ~430 late in BN12, so x m on all future exp is worth at most ~0.074 ln(m) of level, and only exp earned
    // after the graft counts. At 0.15 Neuregen (hacking exp x1.4, skill x1.0) passed (0.030) and its entropy cut the level 2%
    // at once (BN12.86's World Daemon phase); at 0.05 exp-only grafts net out below zero.
    ["reserve", null], // Keep this much money (default: reserve.txt, i.e. autopilot's reserve)
    ["focus", true], // Graft focused (unfocused work runs at 0.8x without Neuroreceptor Management Implant), stopping
    // infiltrator.js (its UI navigation takes focus away) and refocusing while grafting. --focus false to keep infiltrating.
    ["once", false], // Graft at most one augmentation, then exit
    ["no-charisma", false], // Don't graft for darknet labyrinth charisma
    ["charisma-margin", 1.3], // Charisma mode grafts up to this times the labyrinth's requirement (moves are slow near it)
    ["eta-slack", 1.5], // Hacking mode: skip grafts longer than this times the projected time to reach the target by experience
    ["no-starter", false], // Don't graft the starter augmentations first (Neuroreceptor, Enhanced Social Interaction)
    ["starter-neuroreceptor", false], // Graft Neuroreceptor Management Implant first (removes the unfocused penalty; off: graft.js keeps focus)
    ["starter-esii", false], // Also graft Enhanced Social Interaction as a starter after Cruel's install (off: the charisma Stanek layout replaces it)
];
export function autocomplete(data) {
    data.flags(argsSchema);
    return [];
}

const CONGRUITY = "violet Congruity Implant";
// Darknet labyrinths in order (outside BN15): the reward that unlocks the next one, and the charisma each requires
const LABS = [["The W1ngs of Icarus", 300], ["The B00ts of Perseus", 600], ["The H4mmer of Daedalus", 1500],
    ["The St4ff of Asclepius", 2500], ["The L4w of Bayes", 3000], ["The B1ade of Solomonoff", 3500], ["The Red Pill", 4000]];
/** Charisma the next labyrinth requires, from the labyrinth rewards owned (undefined once all are owned). */
const nextLabCharisma = (owned) => LABS.find(([reward]) => !owned.includes(reward))?.[1];
const ENTROPY = Math.log(0.98);
const IDLE_MS = 2 * 60_000;
const STATUS_FILE = "/Temp/graft-status.txt"; // {t, mode, focus, aug, chaMult}: read by autopilot.js and darknet.js
const GRAFT_RESERVE_FILE = "/Temp/graft-reserve.txt"; // {t, amount}: cash the starter grafts need (autopilot, stockmaster)
// Starter grafts, in order, with when each may start (from the augmentations owned): Neuroreceptor Management Implant
// ($1.65b, ~11 min) removes the unfocused-work penalty for the whole BitNode (grafts no longer need focus, so
// infiltrator.js keeps running); Enhanced Social Interaction Implant ($4.1b, ~47 min, charisma x1.6) pays at every
// labyrinth from Merciless, but starts after Cruel's install (the first two labyrinths' installs come within ~15 minutes
// and would cancel it).
// The check uses installed augmentations: with queued ones counted, ESII started the moment Cruel was solved (B00ts
// queued) and held that reward's install for its whole 47 minutes (BN12.83).
// ESII is off by default since the charisma Stanek layout (2026-11-18): it gives ~x2 charisma by itself (BN12.86: Merciless
// was charisma-gated for 20 minutes until the layout charged, then solved before ESII even finished), while ESII's
// 47-minute graft holds installs as a starter and costs x0.98 entropy on everything (World Daemon hacking included).
// graft.js's charisma mode (cancellable by reward installs) stays the fallback. --starter-esii brings it back.
const STARTERS = [
    // Neuroreceptor is off by default too (2026-11-18): graft.js keeps focus during grafts anyway (pausing infiltrator.js), so
    // grafting speed is the same; it only let infiltrator keep the UI, while its entropy (x0.98 on every multiplier for the
    // BitNode, ~2% World Daemon hacking) and its 11-minute graft at the start (holding the first install) now cost more.
    // --starter-neuroreceptor brings it back.
    ["Neuroreceptor Management Implant", (installed, options) => options["starter-neuroreceptor"]],
    ["Enhanced Social Interaction Implant", (installed, options) => options["starter-esii"] && installed.includes("The B00ts of Perseus")],
];

/** @param {NS} ns */
export async function main(ns) {
    const options = getConfiguration(ns, argsSchema);
    if (!options) return;
    ns.disableLog("ALL");
    // A graft that disappears long before it could finish was cancelled by something else (another script starting
    // work): back off instead of paying for a new graft every few seconds.
    let lastStart = null, backoffMs = 120_000;
    let moneySample = null, moneyRate = 0; // $/ms, to count the wait for an augmentation we can't afford yet
    let statSample = null; // {at, level, mode}: how fast the gating stat rises without grafts
    let lastMode;
    let needFocus = options.focus; // false once Neuroreceptor Management Implant is owned (no focus penalty then)
    // (checked now too: restarted mid-graft, the loop only learns what's owned after the graft, and took focus meanwhile)
    if (needFocus)
        try {
            needFocus = !(await getNsDataThroughFile(ns, `ns.singularity.getOwnedAugmentations(false)`,
                "/Temp/graft-installed.txt")).includes("Neuroreceptor Management Implant");
        } catch {}
    let starterReserve = 0; // last starter-graft cash requirement (kept fresh while another graft runs)
    const chaMults = {}; // augmentation -> charisma multiplier (published while grafting it, for darknet.js's worker mode)
    while (true) {
        const work = await getNsDataThroughFile(ns, "ns.singularity.getCurrentWork()");
        if (work?.type === "GRAFTING") {
            if (chaMults[work.augmentation] === undefined)
                try {
                    chaMults[work.augmentation] = (await getNsDataThroughFile(ns, `ns.singularity.getAugmentationStats(ns.args[0])`,
                        "/Temp/graft-aug-stats.txt", [work.augmentation]))?.charisma ?? 1;
                } catch {
                    chaMults[work.augmentation] = 1;
                }
            ns.write(STATUS_FILE, JSON.stringify({ t: Date.now(), mode: lastMode ?? "grafting", focus: needFocus,
                aug: work.augmentation, chaMult: chaMults[work.augmentation] }), "w");
            ns.write(GRAFT_RESERVE_FILE, JSON.stringify({ t: Date.now(), amount: starterReserve }), "w");
            if (needFocus) {
                // Unfocused grafting runs at 0.8x (Player.focusPenalty). infiltrator.js drives the UI and takes focus;
                // autopilot doesn't relaunch it while the status says focus.
                try {
                    await getNsDataThroughFile(ns, `ns.scriptKill("infiltrator.js", "home")`, "/Temp/graft-kill-infiltrator.txt");
                    await getNsDataThroughFile(ns, `ns.singularity.isFocused() || ns.singularity.setFocus(true)`, "/Temp/graft-refocus.txt");
                } catch {}
            }
            await ns.sleep(15_000);
            continue;
        }
        if (lastStart && Date.now() - lastStart.at < Math.min(lastStart.time * 0.9, 5 * 60_000) + 30_000) {
            log(ns, `WARNING: The graft of ${lastStart.name} stopped after ${formatDuration(Date.now() - lastStart.at)} ` +
                `(of ${formatDuration(lastStart.time)}): something cancelled it. Waiting ${formatDuration(backoffMs)} before grafting again.`, true, "warning");
            await ns.sleep(backoffMs);
            backoffMs = Math.min(backoffMs * 2, 30 * 60_000);
            lastStart = null;
            continue;
        }
        // Three temp scripts rather than one: a temp script costs the sum of its functions' RAM, and the combined one
        // needed 30.6 GB, more than a full home had free (2026-11-16)
        const info = await getNsDataThroughFile(ns,
            `(() => { const p = ns.getPlayer(), owned = ns.singularity.getOwnedAugmentations(true);
                return { lastAugReset: ns.getResetInfo().lastAugReset, money: p.money, city: p.city, hack: p.skills.hacking,
                    cha: p.skills.charisma, entropy: p.entropy, owned, installed: ns.singularity.getOwnedAugmentations(false),
                    redPill: ns.singularity.getOwnedAugmentations(false).includes("The Red Pill") }; })()`,
            // (installed, not owned: between buying The Red Pill and the install, w0r1d_d43m0n doesn't exist yet and the
            // requirement lookup below threw -- two runtime error dialogs per run, BN12.138/145)
            "/Temp/graft-player.txt");
        const graftable = await getNsDataThroughFile(ns,
            `ns.grafting.getGraftableAugmentations().map(name => ({ name,
                cost: ns.grafting.getAugmentationGraftPrice(name), time: ns.grafting.getAugmentationGraftTime(name) }))`,
            "/Temp/graft-candidates.txt");
        const details = await getNsDataThroughFile(ns,
            `Object.fromEntries(ns.args.map(name => [name, { prereqs: ns.singularity.getAugmentationPrereq(name),
                stats: ns.singularity.getAugmentationStats(name) }]))`,
            "/Temp/graft-aug-details.txt", graftable.map((a) => a.name));
        info.augs = graftable.map((a) => ({ ...a, ...details[a.name] }));
        needFocus = options.focus && !info.owned.includes("Neuroreceptor Management Implant");

        // Starter grafts: worth their price for the whole BitNode, so they come first and skip the reserve. Their cost is
        // published (GRAFT_RESERVE_FILE) so autopilot adds it to reserve.txt and stockmaster keeps it as cash: autopilot
        // reserves the casino's $8b for stocks, which left graft.js ~$2b and Enhanced Social Interaction ungrafted.
        const pendingStarters = options["no-starter"] || info.redPill ? [] :
            STARTERS.filter(([name]) => !info.owned.includes(name) && info.augs.some((a) => a.name === name) &&
                (name !== "Enhanced Social Interaction Implant" || options["starter-esii"]) &&
                (name !== "Neuroreceptor Management Implant" || options["starter-neuroreceptor"])); // (no reserve for a disabled starter)
        starterReserve = pendingStarters.reduce((t, [name]) => t + info.augs.find((a) => a.name === name).cost, 0);
        ns.write(GRAFT_RESERVE_FILE, JSON.stringify({ t: Date.now(), amount: starterReserve }), "w");
        // (and none while augmentations wait to be installed, e.g. a labyrinth reward: the graft would hold that install)
        const queued = info.owned.length > info.installed.length;
        const starter = !queued && pendingStarters.find(([, ready]) => ready(info.installed, options));
        const starterAug = starter && info.augs.find((a) => a.name === starter[0]);
        if (starterAug && starterAug.cost <= info.money) {
            // (status "starter": autopilot holds installs for it like any graft. As "charisma", a labyrinth reward's install
            // could cancel it, and BN12.82's Eternal install cancelled Enhanced Social Interaction 11 minutes in: $4.1b lost,
            // and with installs 25-45 minutes apart a 47-minute graft could be cancelled again and again)
            ns.write(STATUS_FILE, JSON.stringify({ t: Date.now(), mode: "starter", focus: needFocus }), "w");
            lastMode = "starter";
            if (info.city !== "New Tokyo" &&
                !(await getNsDataThroughFile(ns, `ns.singularity.travelToCity("New Tokyo")`, "/Temp/graft-travel.txt"))) {
                await ns.sleep(60_000);
                continue;
            }
            if (await getNsDataThroughFile(ns, `ns.grafting.graftAugmentation(ns.args[0], ns.args[1])`,
                "/Temp/graft-start.txt", [starterAug.name, needFocus])) {
                log(ns, `INFO: Starter graft: ${starterAug.name} (${formatMoney(starterAug.cost)}, ${formatDuration(starterAug.time)}).`, true, "info");
                lastStart = { name: starterAug.name, at: Date.now(), time: starterAug.time };
                await ns.sleep(20_000);
            } else await ns.sleep(60_000);
            continue;
        }

        // What gates us now?
        let mode = null, target = 0;
        if (info.redPill) {
            target = options["until-hack"] ||
                (await getNsDataThroughFile(ns, `ns.getServerRequiredHackingLevel("w0r1d_d43m0n")`, "/Temp/graft-daemon-req.txt"));
            if (info.hack < target) mode = "hacking";
            else return log(ns, `SUCCESS: hacking ${info.hack} >= ${target}: done grafting.`, true, "success");
        } else if (!options["no-charisma"]) {
            let dnet = null;
            try {
                dnet = JSON.parse(ns.read("/data/darknet-anchor-status.txt") || "null");
            } catch {}
            // (status from before the last install is about a darknet that no longer exists)
            const fresh = dnet && Date.now() - dnet.t < 10 * 60_000 && dnet.t > info.lastAugReset;
            // Up to 1.3x the requirement: moves take (5 x required + base) / (charisma + 150) as long, so a labyrinth
            // found just above it is slow (BN12.79: Eternal at 3108/3000 wasn't solved within the install hold). Before the
            // labyrinth is found, the next one's requirement comes from the rewards we own (BN12.79: Uber went unfound
            // while charisma sat at 2200/2500, and no graft started because no labyrinth was known yet).
            const labCha = dnet?.labCha ?? nextLabCharisma(info.owned);
            if (fresh && dnet.phase === "push" && labCha && info.cha < options["charisma-margin"] * labCha) {
                mode = "charisma";
                target = Math.ceil(options["charisma-margin"] * labCha);
            }
        }
        // Tell autopilot whether we're in a graft series (it holds installs then; idle = installs may go ahead)
        ns.write(STATUS_FILE, JSON.stringify({ t: Date.now(), mode }), "w");
        if (mode !== lastMode) {
            log(ns, mode ? `INFO: Grafting for ${mode} (${mode === "hacking" ? info.hack : info.cha} / ${target}).` : `INFO: Nothing to graft for right now; waiting.`);
            lastMode = mode;
        }
        if (!mode) {
            await ns.sleep(IDLE_MS);
            continue;
        }

        // How soon does experience alone reach the target? A graft that finishes after that is wasted (BN12.76: a 56-minute
        // hacking graft started with the World Daemon's requirement ~4 minutes away). Levels rise fastest right after an
        // install, so the current rate underestimates the remaining time: allow --eta-slack.
        const level = mode === "hacking" ? info.hack : info.cha;
        if (!statSample || statSample.mode !== mode || level < statSample.level) statSample = { at: Date.now(), level, mode };
        const sampledMs = Date.now() - statSample.at;
        // Right after an install the scripts are still starting and levels climb slowly at first, then fast: BN12.77
        // measured 350 hacking/min over the first 2 minutes (BN12.76: ~1100/min over minutes 1-5) and grafted a 48-minute
        // augmentation the target didn't need. Measure for 5 minutes within 10 minutes of an install.
        const minSampleMs = Date.now() - info.lastAugReset < 10 * 60_000 ? 5 * 60_000 : 2 * 60_000;
        if (sampledMs < minSampleMs) {
            await ns.sleep(30_000); // measure first
            continue;
        }
        const levelRate = (level - statSample.level) / sampledMs; // levels/ms
        const etaMs = levelRate > 0 ? (target - level) / levelRate : Infinity;
        if (sampledMs > 10 * 60_000) statSample = { at: Date.now() - 5 * 60_000, level: level - levelRate * 5 * 60_000, mode }; // keep a ~5-10 min window

        const reserve = options.reserve ?? Number(ns.read("reserve.txt") || 0);
        const budget = info.money - reserve;
        const now = Date.now();
        // Smoothed income; flat or falling money pulls it down (a one-off jump must not keep us waiting forever)
        if (moneySample && now > moneySample.at)
            moneyRate = 0.5 * moneyRate + 0.5 * Math.max(0, (info.money - moneySample.money) / (now - moneySample.at));
        moneySample = { at: now, money: info.money };
        const eligible = info.augs.filter((a) => a.prereqs.every((p) => info.owned.includes(p)));
        const waitMs = (a) => (a.cost <= budget ? 0 : moneyRate > 0 ? (a.cost - budget) / moneyRate : Infinity);
        const [stat, expStat] = mode === "hacking" ? ["hacking", "hacking_exp"] : ["charisma", "charisma_exp"];
        // violet Congruity Implant stops entropy; worth it when grafting for hacking (a long series without installs)
        let choice = mode === "hacking" ? eligible.find((a) => a.name === CONGRUITY && a.cost <= budget && a.time < options["eta-slack"] * etaMs) : null;
        if (!choice) {
            const entropyPenalty = info.owned.includes(CONGRUITY) ? 0 : ENTROPY;
            const scored = eligible.map((a) => {
                const gain = Math.log(a.stats[stat] ?? 1) + options["exp-weight"] * Math.log(a.stats[expStat] ?? 1) + entropyPenalty;
                return { ...a, gain, wait: waitMs(a), rate: gain / (a.time + waitMs(a)) };
            }).filter((a) => a.gain >= options["min-gain"] && Number.isFinite(a.rate) &&
                a.time + a.wait < options["eta-slack"] * etaMs);
            scored.sort((a, b) => b.rate - a.rate);
            choice = scored[0];
            if (choice && choice.wait > 0) {
                log(ns, `INFO: Waiting ~${formatDuration(choice.wait)} to afford ${choice.name} (${formatMoney(choice.cost)}), ` +
                    `better per minute than any affordable graft.`);
                // Reserve it (autopilot adds this file to reserve.txt): after The Red Pill, hacknet RAM buying (--ram-first)
                // and others would otherwise spend the money a graft worth x1.1-1.2 hacking is waiting for
                ns.write(GRAFT_RESERVE_FILE, JSON.stringify({ t: Date.now(), amount: starterReserve + choice.cost }), "w");
                await ns.sleep(Math.min(Math.max(choice.wait, 10_000), 60_000));
                continue;
            }
        }
        if (!choice) {
            log(ns, `INFO: No graft worth starting: ${mode} ${level} / ${target} in ~${formatDuration(Math.min(etaMs, 864e5))} by experience.`);
            await ns.sleep(moneyRate ? IDLE_MS : 30_000); // nothing affordable worth grafting (yet)
            continue;
        }
        if (info.city !== "New Tokyo") {
            const travelled = await getNsDataThroughFile(ns, `ns.singularity.travelToCity("New Tokyo")`, "/Temp/graft-travel.txt");
            if (!travelled) {
                log(ns, `WARNING: Could not travel to New Tokyo to graft. Retrying in a minute.`, false, "warning");
                await ns.sleep(60_000);
                continue;
            }
        }
        const started = await getNsDataThroughFile(ns, `ns.grafting.graftAugmentation(ns.args[0], ns.args[1])`,
            "/Temp/graft-start.txt", [choice.name, needFocus]);
        if (!started) {
            log(ns, `WARNING: Failed to start grafting ${choice.name}. Retrying in a minute.`, false, "warning");
            await ns.sleep(60_000);
            continue;
        }
        log(ns, `INFO: Grafting ${choice.name} for ${mode} (${stat} x${(choice.stats[stat] ?? 1).toFixed(3)}, ${formatMoney(choice.cost)}, ` +
            `${formatDuration(choice.time)}; entropy ${info.entropy} -> ${info.owned.includes(CONGRUITY) ? info.entropy : info.entropy + 1}; ` +
            `${mode === "hacking" ? info.hack : info.cha} / ${target})`, true, "info");
        if (options.once) return;
        lastStart = { name: choice.name, at: Date.now(), time: choice.time };
        await ns.sleep(20_000);
    }
}
