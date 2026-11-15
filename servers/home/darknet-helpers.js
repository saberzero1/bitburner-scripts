const defaultSettingsDictionary = ["admin", "password", "0000", "12345"];
const dogNameDictionary = ["fido", "spot", "rover", "max"];
const euCountries = [
    "Austria",
    "Belgium",
    "Bulgaria",
    "Croatia",
    "Republic of Cyprus",
    "Czech Republic",
    "Denmark",
    "Estonia",
    "Finland",
    "France",
    "Germany",
    "Greece",
    "Hungary",
    "Ireland",
    "Italy",
    "Latvia",
    "Lithuania",
    "Luxembourg",
    "Malta",
    "Netherlands",
    "Poland",
    "Portugal",
    "Romania",
    "Slovakia",
    "Slovenia",
    "Spain",
    "Sweden",
];
const commonPasswordDictionary = [
    "123456",
    "password",
    "12345678",
    "qwerty",
    "123456789",
    "12345",
    "1234",
    "111111",
    "1234567",
    "dragon",
    "123123",
    "baseball",
    "abc123",
    "football",
    "monkey",
    "letmein",
    "696969",
    "shadow",
    "master",
    "666666",
    "qwertyuiop",
    "123321",
    "mustang",
    "1234567890",
    "michael",
    "654321",
    "superman",
    "1qaz2wsx",
    "7777777",
    "121212",
    "0",
    "qazwsx",
    "123qwe",
    "trustno1",
    "jordan",
    "jennifer",
    "zxcvbnm",
    "asdfgh",
    "hunter",
    "buster",
    "soccer",
    "harley",
    "batman",
    "andrew",
    "tigger",
    "sunshine",
    "iloveyou",
    "2000",
    "charlie",
    "robert",
    "thomas",
    "hockey",
    "ranger",
    "daniel",
    "starwars",
    "112233",
    "george",
    "computer",
    "michelle",
    "jessica",
    "pepper",
    "1111",
    "zxcvbn",
    "555555",
    "11111111",
    "131313",
    "freedom",
    "777777",
    "pass",
    "maggie",
    "159753",
    "aaaaaa",
    "ginger",
    "princess",
    "joshua",
    "cheese",
    "amanda",
    "summer",
    "love",
    "ashley",
    "6969",
    "nicole",
    "chelsea",
    "biteme",
    "matthew",
    "access",
    "yankees",
    "987654321",
    "dallas",
    "austin",
    "thunder",
    "taylor",
    "matrix",
];

const ALL_MODEL_IDS = [
    "ZeroLogon",
    "DeskMemo_3.1",
    "FreshInstall_1.0",
    "CloudBlare(tm)",
    "Laika4",
    "NIL",
    "Pr0verFl0",
    "PHP 5.4",
    "DeepGreen",
    "BellaCuore",
    "AccountsManager_4.2",
    "OctantVoxel",
    "Factori-Os",
    "OpenWebAccessPoint",
    "KingOfTheHill",
    "RateMyPix.Auth",
    "PrimeTime 2",
    "TopPass",
    "EuroZone Free",
    "2G_cellular",
    "110100100",
    "MathML",
    "OrdoXenos",
    "BigMo%od",
    "(The Labyrinth)",
];

// Solvers the orchestrator (on home) can run without per-attempt feedback. Feedback-based models
// (FEEDBACK_MODEL_IDS) are solved by the probes, which read the feedback from the server log.
const SOLVER_MAP = {
    ZeroLogon: solveZeroLogon,
    "DeskMemo_3.1": solveEchoVuln,
    "FreshInstall_1.0": solveFreshInstall,
    "CloudBlare(tm)": solveCloudBlare,
    Laika4: solveDogNames,
    Pr0verFl0: solveBufferOverflow,
    "PHP 5.4": solveSortedEchoVuln,
    BellaCuore: solveRomanNumeral,
    OctantVoxel: solveConvertToBase10,
    OpenWebAccessPoint: solvePacketSniffer,
    "PrimeTime 2": solveLargestPrimeFactor,
    TopPass: solveTopPass,
    "EuroZone Free": solveEuroZone,
    110100100: solveBinaryEncoded,
    MathML: solveParsedExpression,
    OrdoXenos: solveXorEncrypted,
};

// Models whose password can only be found with per-attempt feedback (authentication.ts checkPassword).
const FEEDBACK_MODEL_IDS = new Set([
    "NIL", // yes/yesn't per position
    "DeepGreen", // mastermind exact/misplaced counts
    "AccountsManager_4.2", // higher/lower
    "Factori-Os", // divisibility
    "KingOfTheHill", // altitude
    "RateMyPix.Auth", // count of correct positions
    "2G_cellular", // first mismatch index
    "BigMo%od", // modulo results
]);
// Never format-brute-forced: the solver already covers every candidate (sorted echo permutations) or the
// password is read from the server log (packet sniffer).
const NO_BRUTEFORCE_MODEL_IDS = new Set(["PHP 5.4", "OpenWebAccessPoint"]);

export function getDarknetPasswordSolver(modelId) {
    if (!modelId) return null;
    if (modelId === "(The Labyrinth)") return null;
    if (SOLVER_MAP[modelId]) return SOLVER_MAP[modelId];
    const normalized = modelId.toLowerCase();
    if (normalized.includes("labyrinth")) return null;
    const fuzzyMap = [
        ["zerologon", "ZeroLogon"],
        ["deskmemo", "DeskMemo_3.1"],
        ["freshinstall", "FreshInstall_1.0"],
        ["cloudblare", "CloudBlare(tm)"],
        ["laika", "Laika4"],
        ["nil", "NIL"],
        ["pr0ver", "Pr0verFl0"],
        ["php 5.4", "PHP 5.4"],
        ["deepgreen", "DeepGreen"],
        ["bellacuore", "BellaCuore"],
        ["accountsmanager", "AccountsManager_4.2"],
        ["octantvoxel", "OctantVoxel"],
        ["factori", "Factori-Os"],
        ["openweb", "OpenWebAccessPoint"],
        ["kingofthehill", "KingOfTheHill"],
        ["ratemypix", "RateMyPix.Auth"],
        ["primetime", "PrimeTime 2"],
        ["toppass", "TopPass"],
        ["eurozone", "EuroZone Free"],
        ["2g_cellular", "2G_cellular"],
        ["110100100", "110100100"],
        ["mathml", "MathML"],
        ["ordoxenos", "OrdoXenos"],
        ["bigmo", "BigMo%od"],
    ];
    for (const [needle, target] of fuzzyMap) {
        if (normalized.includes(needle)) return SOLVER_MAP[target] || null;
    }
    return null;
}

export async function solveLabyrinth(ns, hostname) {
    const visited = new Set();
    const pathStack = [];
    // Start position is always (1,1) per source
    let pos = { x: 1, y: 1 };

    // Try labreport first to get reliable position + open directions
    try {
        const report = ns.dnet.labreport();
        if (report && report.success && report.coords) {
            pos = { x: report.coords[0], y: report.coords[1] };
        }
    } catch {}

    // Maximum iterations to prevent infinite loops (largest maze is 60x40 = 2400 cells)
    const maxIter = 5000;
    let iter = 0;

    while (iter++ < maxIter) {
        const key = `${pos.x},${pos.y}`;
        visited.add(key);

        // Get open directions — prefer labreport (free, reliable), fallback to labradar/view parsing
        let openDirs = null;
        try {
            const rpt = ns.dnet.labreport();
            if (rpt && rpt.success) {
                openDirs = [];
                if (rpt.north) openDirs.push("north");
                if (rpt.south) openDirs.push("south");
                if (rpt.east) openDirs.push("east");
                if (rpt.west) openDirs.push("west");
                if (rpt.coords) {
                    pos = { x: rpt.coords[0], y: rpt.coords[1] };
                }
            }
        } catch {}

        // Fallback: try labradar and parse the 7x7 view
        if (!openDirs) {
            try {
                const radar = ns.dnet.labradar();
                if (radar && radar.success && radar.message) {
                    openDirs = parseRadarDirections(radar.message);
                }
            } catch {}
        }

        // Last resort: send a dummy auth to get surroundings from 3x3 view data
        if (!openDirs) {
            const probe = await safeAuthenticate(ns, hostname, "go north");
            if (probe?.success) return true;
            const view = parseLabyrinthView(probe?.data);
            if (view) {
                openDirs = getOpenDirections(view);
            }
        }

        if (!openDirs) return false;

        // Find an unvisited direction (maze moves 2 cells per step)
        const nextDir = openDirs.find((dir) => {
            const delta = directionDelta(dir);
            const nk = `${pos.x + delta.dx},${pos.y + delta.dy}`;
            return !visited.has(nk);
        });

        if (nextDir) {
            pathStack.push({ position: { ...pos }, dir: nextDir });
            const moveResult = await moveLabyrinth(ns, hostname, pos, nextDir);
            if (moveResult.success) return true;
            if (moveResult.moved) {
                pos = moveResult.position;
            } else {
                // Wall hit despite directions saying it's open — pop stack entry
                pathStack.pop();
            }
            continue;
        }

        // No unvisited neighbors — backtrack
        if (pathStack.length === 0) return false;
        const back = pathStack.pop();
        const reverseDir = reverseDirection(back.dir);
        const moveBack = await moveLabyrinth(ns, hostname, pos, reverseDir);
        if (moveBack.success) return true;
        if (!moveBack.moved) return false; // Can't backtrack — stuck
        pos = moveBack.position;
    }

    return false; // Exceeded max iterations
}

/**
 * Password-like tokens and hints from server logs or clue text. Only "password: X" / "password = X" counts:
 * free text such as "The password for X contains a and b" or "Password is not divisible by 7" does not.
 */
export function parseDarknetLogs(logs) {
    const passwords = [];
    const hints = [];
    const entries = Array.isArray(logs)
        ? logs
        : String(logs || "").split(/\r?\n/);
    for (const log of entries) {
        const line = String(log || "");
        const pwdMatch = line.match(/password\s*[:=]\s*['"]?([^'"}\s,]+)/i);
        if (pwdMatch) passwords.push(pwdMatch[1]);
        const authMatch = line.match(/auth(?:enticate)?\s*:\s*['"]?([^'"}\s,]+)/i);
        if (authMatch) passwords.push(authMatch[1]);
        const hintMatch = line.match(/hint[:\s]+(.+)/i);
        if (hintMatch) hints.push(hintMatch[1].trim());
    }
    return { passwords, hints };
}

export function getAllModelIds() {
    return [...ALL_MODEL_IDS];
}

export function estimateCrackDifficulty(serverInfo) {
    const modelId = serverInfo?.modelId || "";
    const tiers = {
        0: ["ZeroLogon"],
        1: ["DeskMemo_3.1", "FreshInstall_1.0", "CloudBlare(tm)"],
        2: ["Laika4", "NIL", "Pr0verFl0"],
        3: [
            "PHP 5.4",
            "DeepGreen",
            "BellaCuore",
            "AccountsManager_4.2",
            "OctantVoxel",
            "Factori-Os",
            "OpenWebAccessPoint",
            "KingOfTheHill",
            "RateMyPix.Auth",
        ],
        4: [
            "PrimeTime 2",
            "TopPass",
            "EuroZone Free",
            "2G_cellular",
            "110100100",
            "MathML",
            "OrdoXenos",
            "BigMo%od",
        ],
    };
    for (const [tier, models] of Object.entries(tiers)) {
        if (models.includes(modelId)) {
            return { tier: Number(tier), label: tierLabel(Number(tier)) };
        }
    }
    return { tier: null, label: "unknown" };
}

export async function tryFormatBruteforce(ns, hostname, serverInfo) {
    // Never blind-guess models whose solver needs feedback, or ones a solver already covers exhaustively.
    if (needsAuthFeedback(serverInfo) || NO_BRUTEFORCE_MODEL_IDS.has(serverInfo?.modelId)) return null;
    resetCrackedCheck(hostname);
    const format = serverInfo?.passwordFormat;
    const length =
        Number.isFinite(serverInfo?.passwordLength) &&
        serverInfo.passwordLength > 0
            ? serverInfo.passwordLength
            : null;
    const charset = getCharsetForFormat(format);
    if (!charset || !length) return null;
    if (format === "numeric") {
        if (length > 4) return null;
        const start = length === 1 ? 0 : Math.pow(10, length - 1);
        const end = Math.pow(10, length) - 1;
        for (let i = start; i <= end; i++) {
            const pin = i.toString();
            const result = await safeAuthenticate(ns, hostname, pin);
            if (result.success) return pin;
            if (await isAlreadyCracked(ns, hostname)) return null;
        }
        return null;
    }
    const maxAttempts = Math.pow(charset.length, length);
    if (!Number.isFinite(maxAttempts) || maxAttempts > 200000) return null;
    const hint = serverInfo?.passwordHint;
    if (
        hint &&
        hint.length === length &&
        [...hint].every((ch) => charset.includes(ch))
    ) {
        const result = await safeAuthenticate(ns, hostname, hint);
        if (result.success) return hint;
    }
    for (let i = 0; i < maxAttempts; i++) {
        const candidate = buildCandidate(i, charset, length);
        const result = await safeAuthenticate(ns, hostname, candidate);
        if (result.success) return candidate;
        if (await isAlreadyCracked(ns, hostname)) return null;
    }
    return null;
}

/**
 * True for models whose solver needs per-attempt feedback (authentication.ts). authenticate() only returns
 * that feedback (`data`) on labyrinth servers; for everything else it is written to the server log, which
 * the probes read with heartbleed. The orchestrator leaves these to the probes and never brute-forces them.
 */
export function needsAuthFeedback(serverInfo) {
    const modelId = serverInfo?.modelId || "";
    if (FEEDBACK_MODEL_IDS.has(modelId)) return true;
    // Roman numerals: the value itself below difficulty 8, a range to binary-search (needs feedback) above.
    if (modelId === "BellaCuore") return getHintData(serverInfo).includes(",");
    // Sorted echo: RMS-deviation feedback only exists for 5+ digit passwords; shorter ones are permuted.
    if (modelId === "PHP 5.4") {
        const digits = (getHintData(serverInfo) || getHint(serverInfo)).match(/\d/g);
        return getPasswordLength(serverInfo, digits?.length ?? 0) >= 5;
    }
    return false;
}

async function solveZeroLogon() {
    return "";
}

async function solveEchoVuln(ns, hostname, serverInfo) {
    const hint = getHint(serverInfo);
    const candidate = extractTrailingToken(hint);
    if (!candidate) return null;
    const result = await safeAuthenticate(ns, hostname, candidate);
    return result.success ? candidate : null;
}

async function solveFreshInstall(ns, hostname) {
    return await tryDictionary(ns, hostname, defaultSettingsDictionary);
}

async function solveCloudBlare(ns, hostname, serverInfo) {
    const data = getHintData(serverInfo) || getHint(serverInfo);
    const digits = String(data).match(/\d/g);
    if (!digits) return null;
    const joined = digits.join("");
    const length = Number.isFinite(serverInfo?.passwordLength)
        ? serverInfo.passwordLength
        : null;
    const candidates = [];
    if (length && joined.length >= length) {
        for (let i = 0; i <= joined.length - length; i++) {
            candidates.push(joined.slice(i, i + length));
        }
    } else {
        candidates.push(joined);
    }
    for (const candidate of candidates) {
        const result = await safeAuthenticate(ns, hostname, candidate);
        if (result.success) return candidate;
    }
    return null;
}

async function solveDogNames(ns, hostname) {
    return await tryDictionary(ns, hostname, dogNameDictionary);
}

async function solveBufferOverflow(ns, hostname, serverInfo) {
    const hint = getHint(serverInfo);
    const match = hint.match(/(\d+)/);
    if (!match) return null;
    const length = Number(match[1]);
    if (!Number.isFinite(length) || length <= 0) return null;
    const candidate = "A".repeat(length * 2);
    const result = await safeAuthenticate(ns, hostname, candidate);
    return result.success ? candidate : null;
}

async function solveSortedEchoVuln(ns, hostname, serverInfo) {
    resetCrackedCheck(hostname);
    const sortedRaw = (getHintData(serverInfo) || getHint(serverInfo)).replace(
        /\s+/g,
        "",
    );
    const sorted = sortedRaw.match(/\d+/g)?.join("") || "";
    if (!sorted || !/^\d+$/.test(sorted)) return null;
    // 5+ digit passwords need RMS-deviation feedback from the server log (see needsAuthFeedback); the
    // probes solve those. Shorter ones have at most 24 orderings.
    if (sorted.length >= 5) return null;
    return await solvePermutationByAuth(ns, hostname, sorted.split(""), 200);
}

async function solveRomanNumeral(ns, hostname, serverInfo) {
    // A range hint ("between X and Y") needs ALTUS/PARUM feedback from the server log: left to the probes.
    if (getHintData(serverInfo).includes(",")) return null;
    const encoded = extractRoman(
        getHintData(serverInfo) || getHint(serverInfo),
    );
    if (!encoded) return null;
    const candidate = String(romanToNumber(encoded));
    const result = await safeAuthenticate(ns, hostname, candidate);
    return result.success ? candidate : null;
}

async function solveConvertToBase10(ns, hostname, serverInfo) {
    const hintData = getHintData(serverInfo);
    const parts = hintData.split(",");
    if (parts.length < 2) return null;
    const base = Number(parts[0]);
    const encoded = parts.slice(1).join(",").trim();
    if (!Number.isFinite(base) || !encoded) return null;
    const value = parseBaseN(encoded, base);
    if (!Number.isFinite(value)) return null;
    const candidate = String(Math.round(value));
    const result = await safeAuthenticate(ns, hostname, candidate);
    return result.success ? candidate : null;
}

/**
 * OpenWebAccessPoint (packet sniffer) servers put captured traffic in the `data` of a FAILED attempt's server
 * log entry, read back with heartbleed (ns.dnet.packetCapture was removed in #2594).
 * - Easy servers (difficulty <= 16): traffic contains " <hostname>:<password> ".
 * - Hard servers: the bare password is embedded in random noise at a random offset, so the
 *   only length-L substring present in every capture is the password.
 */
async function sniffPacketPassword(ns, hostname, serverInfo, maxCaptures = 12) {
    const expectedLength = serverInfo?.passwordLength || 0;
    const tried = new Set();
    let common = null;
    const tryCandidate = async (candidate) => {
        if (!candidate || tried.has(candidate)) return false;
        if (expectedLength && candidate.length !== expectedLength) return false;
        tried.add(candidate);
        const r = await safeAuthenticate(ns, hostname, candidate);
        return !!r?.success;
    };
    for (let i = 0; i < maxCaptures; i++) {
        const probeGuess = "0".repeat(Math.max(1, expectedLength || 1));
        const r = await safeAuthenticate(ns, hostname, probeGuess);
        if (r?.success) return probeGuess;
        tried.add(probeGuess);
        // authenticate() only returns feedback data on labyrinth servers; elsewhere it's in the server log,
        // as JSON of the response ({code, message, data, passwordAttempted}). data holds the captured packets.
        let text = "";
        try {
            const bleed = await ns.dnet.heartbleed(hostname, { peek: true, logsToCapture: 8 });
            for (const line of bleed?.logs ?? []) {
                try {
                    const entry = JSON.parse(String(line));
                    if (entry?.passwordAttempted === probeGuess && typeof entry.data === "string") {
                        text = entry.data;
                        break;
                    }
                } catch {}
            }
        } catch {}
        if (!text) continue;
        for (const m of text.matchAll(/(\S+):(\S+)/g)) {
            if (m[1] === hostname && (await tryCandidate(m[2]))) return m[2];
        }
        if (!expectedLength || text.length < expectedLength) continue;
        const subs = new Set();
        for (let j = 0; j + expectedLength <= text.length; j++)
            subs.add(text.slice(j, j + expectedLength));
        common = common ? new Set([...common].filter((s) => subs.has(s))) : subs;
        if (common.size === 0) common = null; // capture didn't contain it; start over
        else if (common.size <= 3 && i > 0) {
            for (const c of common) if (await tryCandidate(c)) return c;
            common = null;
        }
        if (await isAlreadyCracked(ns, hostname)) return null;
    }
    return null;
}

async function solvePacketSniffer(ns, hostname, serverInfo) {
    resetCrackedCheck(hostname);
    const sniffed = await sniffPacketPassword(ns, hostname, serverInfo);
    if (sniffed !== null) return sniffed;

    const candidates = new Set();
    const hint = getHint(serverInfo);
    if (hint) {
        candidates.add(hint.trim());
        candidates.add(hint.replace(/\s+/g, ""));
    }
    for (const value of defaultSettingsDictionary) candidates.add(value);
    for (const value of commonPasswordDictionary) candidates.add(value);
    const expectedLength = serverInfo?.passwordLength;
    const format = serverInfo?.passwordFormat;
    for (const candidate of candidates) {
        if (!candidate) continue;
        if (expectedLength && candidate.length !== expectedLength) continue;
        if (format === "numeric" && !/^\d+$/.test(candidate)) continue;
        if (format === "alphabetic" && !/^[a-zA-Z]+$/.test(candidate)) continue;
        if (format === "alphanumeric" && !/^[a-zA-Z0-9]+$/.test(candidate))
            continue;
        const result = await safeAuthenticate(ns, hostname, candidate);
        if (result.success) return candidate;
        if (await isAlreadyCracked(ns, hostname)) return null;
    }
    return null;
}

async function solveLargestPrimeFactor(ns, hostname, serverInfo) {
    const target = extractNumber(
        getHintData(serverInfo) || getHint(serverInfo),
    );
    if (!Number.isFinite(target)) return null;
    const candidate = String(largestPrimeFactor(target));
    const result = await safeAuthenticate(ns, hostname, candidate);
    return result.success ? candidate : null;
}

async function solveTopPass(ns, hostname) {
    return await tryDictionary(ns, hostname, commonPasswordDictionary);
}

async function solveEuroZone(ns, hostname) {
    return await tryDictionary(ns, hostname, euCountries);
}

async function solveBinaryEncoded(ns, hostname, serverInfo) {
    const raw = getHintData(serverInfo) || getHint(serverInfo);
    const bytes = String(raw).match(/[01]{8}/g);
    if (!bytes) return null;
    const candidate = bytes
        .map((b) => String.fromCharCode(parseInt(b, 2)))
        .join("");
    const result = await safeAuthenticate(ns, hostname, candidate);
    return result.success ? candidate : null;
}

async function solveParsedExpression(ns, hostname, serverInfo) {
    const expr = cleanExpression(getHintData(serverInfo));
    if (!expr) return null;
    const value = evaluateExpression(expr);
    if (!Number.isFinite(value)) return null;

    const candidates = buildExpressionCandidates(value);
    for (const candidate of candidates) {
        const result = await safeAuthenticate(ns, hostname, candidate);
        if (result.success) return candidate;
    }
    return null;
}

async function solveXorEncrypted(ns, hostname, serverInfo) {
    const hintData = getHintData(serverInfo);
    const [encrypted, masksRaw] = hintData.split(";");
    if (!encrypted || !masksRaw) return null;
    const masks = masksRaw
        .trim()
        .split(/\s+/)
        .map((mask) => parseInt(mask, 2));
    if (masks.some((n) => !Number.isFinite(n))) return null;
    let output = "";
    for (let i = 0; i < encrypted.length; i++) {
        const code = encrypted.charCodeAt(i);
        const mask = masks[i] ?? 0;
        output += String.fromCharCode(code ^ mask);
    }
    const result = await safeAuthenticate(ns, hostname, output);
    return result.success ? output : null;
}

function getHint(serverInfo) {
    return String(
        serverInfo?.staticPasswordHint ?? serverInfo?.passwordHint ?? "",
    ).trim();
}

function getHintData(serverInfo) {
    return String(
        serverInfo?.data ?? serverInfo?.passwordHintData ?? "",
    ).trim();
}

function getPasswordLength(serverInfo, fallback) {
    return Number.isFinite(serverInfo?.passwordLength) &&
        serverInfo.passwordLength > 0
        ? serverInfo.passwordLength
        : fallback;
}

async function safeAuthenticate(ns, hostname, password) {
    try {
        return await ns.dnet.authenticate(hostname, password);
    } catch (err) {
        logError(
            ns,
            `Darknet auth failed for ${hostname} with candidate "${password}"`,
            err,
        );
        return { success: false, code: 0, message: String(err), data: null };
    }
}

function logError(ns, message, err) {
    try {
        const detail = err?.message ?? String(err);
        if (ns?.print) ns.print(`${message}: ${detail}`);
        else if (ns?.tprint) ns.tprint(`${message}: ${detail}`);
    } catch {}
}

/** Auth-attempt counter per hostname — used to throttle isAlreadyCracked checks. */
const _crackedCheckCounters = new Map();
const _CRACKED_CHECK_INTERVAL = 25;

/**
 * Throttled check: has another agent already cracked this server?
 * Only actually queries every _CRACKED_CHECK_INTERVAL calls per hostname.
 * Returns true if server already has admin rights (cracked by someone else).
 */
async function isAlreadyCracked(ns, hostname) {
    const count = (_crackedCheckCounters.get(hostname) || 0) + 1;
    _crackedCheckCounters.set(hostname, count);
    if (count % _CRACKED_CHECK_INTERVAL !== 0) return false;
    try {
        return ns.hasRootAccess(hostname) === true;
    } catch {
        return false;
    }
}

/** Reset the cracked-check counter for a hostname (call at start of each solver). */
function resetCrackedCheck(hostname) {
    _crackedCheckCounters.delete(hostname);
}

async function tryDictionary(ns, hostname, words, serverInfo) {
    resetCrackedCheck(hostname);
    const expectedLength = serverInfo?.passwordLength;
    const format = serverInfo?.passwordFormat;
    for (const word of words) {
        if (expectedLength && word.length !== expectedLength) continue;
        if (format === "numeric" && !/^\d+$/.test(word)) continue;
        if (format === "alphabetic" && !/^[a-zA-Z]+$/.test(word)) continue;
        if (format === "alphanumeric" && !/^[a-zA-Z0-9]+$/.test(word)) continue;
        const result = await safeAuthenticate(ns, hostname, word);
        if (result.success) return word;
        if (await isAlreadyCracked(ns, hostname)) return null;
    }
    return null;
}

function extractTrailingToken(hint) {
    const match = String(hint || "").match(/([A-Za-z0-9]+)\s*$/);
    return match ? match[1] : "";
}

function extractNumber(text) {
    const match = String(text || "").match(/(\d+)/);
    return match ? Number(match[1]) : NaN;
}

function extractRoman(text) {
    const match = String(text || "").match(/([IVXLCDM]+|nulla)/i);
    return match ? match[1] : "";
}

function romanToNumber(input) {
    if (!input) return NaN;
    if (input.toLowerCase() === "nulla") return 0;
    const romanToInt = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
    let total = 0;
    let prev = 0;
    const upper = input.toUpperCase();
    for (let i = upper.length - 1; i >= 0; i--) {
        const value = romanToInt[upper[i]];
        if (!value) return NaN;
        if (value < prev) total -= value;
        else total += value;
        prev = value;
    }
    return total;
}

function largestPrimeFactor(n) {
    let num = Math.floor(n);
    if (num < 2) return num;
    let factor = 2;
    let last = 1;
    while (factor * factor <= num) {
        if (num % factor === 0) {
            last = factor;
            num = Math.floor(num / factor);
        } else {
            factor += factor === 2 ? 1 : 2;
        }
    }
    return Math.max(last, num);
}

function getCharsetForFormat(format) {
    if (!format) return null;
    if (format === "numeric") return "0123456789";
    if (format === "alphabetic")
        return "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    if (format === "alphanumeric")
        return "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    return null;
}

function buildCandidate(index, charset, length) {
    let value = index;
    let output = "";
    for (let i = 0; i < length; i++) {
        output = charset[value % charset.length] + output;
        value = Math.floor(value / charset.length);
    }
    return output;
}

async function solvePermutationByAuth(ns, hostname, digits, limit) {
    resetCrackedCheck(hostname);
    const counts = new Map();
    for (const d of digits) counts.set(d, (counts.get(d) || 0) + 1);
    const keys = Array.from(counts.keys());
    const buffer = new Array(digits.length);
    let attempts = 0;

    const backtrack = async (idx) => {
        if (attempts >= limit) return null;
        if (idx === digits.length) {
            attempts++;
            const candidate = buffer.join("");
            const resp = await safeAuthenticate(ns, hostname, candidate);
            if (resp.success) return candidate;
            if (await isAlreadyCracked(ns, hostname)) return null;
            return null;
        }
        for (const key of keys) {
            const count = counts.get(key) || 0;
            if (!count) continue;
            counts.set(key, count - 1);
            buffer[idx] = key;
            const result = await backtrack(idx + 1);
            if (result) return result;
            counts.set(key, count);
        }
        return null;
    };

    return await backtrack(0);
}

function parseBaseN(encoded, base) {
    const characters = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const upper = encoded.toUpperCase();
    const [intPart, fracPart] = upper.split(".");
    let value = 0;
    for (const ch of intPart) {
        const digit = characters.indexOf(ch);
        if (digit < 0) return NaN;
        value = value * base + digit;
    }
    if (fracPart) {
        for (let i = 0; i < fracPart.length; i++) {
            const digit = characters.indexOf(fracPart[i]);
            if (digit < 0) return NaN;
            value += digit / Math.pow(base, i + 1);
        }
    }
    return value;
}

function cleanExpression(expression) {
    let cleaned = String(expression || "")
        .replaceAll("ҳ", "*")
        .replaceAll("÷", "/")
        .replaceAll("➕", "+")
        .replaceAll("➖", "-")
        .replaceAll("×", "*");
    if (cleaned.includes("ns.exit(),"))
        cleaned = cleaned.split("ns.exit(),")[0];
    if (cleaned.includes(",")) cleaned = cleaned.split(",")[0];
    return cleaned.trim();
}

function evaluateExpression(expression) {
    const tokens = tokenizeExpression(expression);
    let index = 0;

    const parseExpression = () => {
        let value = parseTerm();
        while (
            index < tokens.length &&
            (tokens[index] === "+" || tokens[index] === "-")
        ) {
            const op = tokens[index++];
            const right = parseTerm();
            value = op === "+" ? value + right : value - right;
        }
        return value;
    };

    const parseTerm = () => {
        let value = parsePower();
        while (
            index < tokens.length &&
            (tokens[index] === "*" || tokens[index] === "/")
        ) {
            const op = tokens[index++];
            const right = parsePower();
            value = op === "*" ? value * right : value / right;
        }
        return value;
    };

    const parsePower = () => {
        let value = parseUnary();
        if (tokens[index] === "^") {
            index++;
            const right = parsePower();
            value = Math.pow(value, right);
        }
        return value;
    };

    const parseUnary = () => {
        if (tokens[index] === "+") {
            index++;
            return parseUnary();
        }
        if (tokens[index] === "-") {
            index++;
            return -parseUnary();
        }
        return parsePrimary();
    };

    const parsePrimary = () => {
        const token = tokens[index++];
        if (token === "(") {
            const value = parseExpression();
            if (tokens[index] === ")") index++;
            return value;
        }
        if (typeof token === "number") return token;
        return NaN;
    };

    const result = parseExpression();
    return Number.isFinite(result) ? result : NaN;
}

function tokenizeExpression(expression) {
    const raw = String(expression || "").replace(/\s+/g, "");
    const tokens = [];
    let i = 0;
    while (i < raw.length) {
        const ch = raw[i];
        if ("+-*/^()".includes(ch)) {
            tokens.push(ch);
            i++;
            continue;
        }
        if (/[0-9.]/.test(ch)) {
            let num = "";
            while (i < raw.length && /[0-9.]/.test(raw[i])) {
                num += raw[i];
                i++;
            }
            tokens.push(parseFloat(num));
            continue;
        }
        i++;
    }
    return tokens;
}

function buildExpressionCandidates(value) {
    const candidates = [];
    if (Number.isFinite(value)) {
        if (Math.abs(value - Math.round(value)) < 1e-6) {
            candidates.push(String(Math.round(value)));
        }
        candidates.push(String(value));
        candidates.push(value.toFixed(2));
        candidates.push(value.toFixed(3));
    }
    return Array.from(new Set(candidates));
}

function tierLabel(tier) {
    if (tier === 0) return "trivial";
    if (tier === 1) return "easy";
    if (tier === 2) return "medium";
    if (tier === 3) return "hard";
    if (tier === 4) return "expert";
    return "unknown";
}

function parseLabyrinthView(data) {
    if (typeof data !== "string") return null;
    const rows = data.split("\n").filter((line) => line.length > 0);
    if (rows.length < 3) return null;
    const trimmed = rows.slice(0, 3).map((r) => r.slice(0, 3));
    if (trimmed.length < 3) return null;
    return trimmed.map((row) => row.split(""));
}

function getOpenDirections(view) {
    const open = [];
    if (!view || view.length < 3) return open;
    if (view[0]?.[1] !== "█") open.push("north");
    if (view[2]?.[1] !== "█") open.push("south");
    if (view[1]?.[0] !== "█") open.push("west");
    if (view[1]?.[2] !== "█") open.push("east");
    return open;
}

function directionDelta(dir) {
    if (dir === "north") return { dx: 0, dy: -2 };
    if (dir === "south") return { dx: 0, dy: 2 };
    if (dir === "west") return { dx: -2, dy: 0 };
    return { dx: 2, dy: 0 };
}

function reverseDirection(dir) {
    if (dir === "north") return "south";
    if (dir === "south") return "north";
    if (dir === "west") return "east";
    return "west";
}

async function moveLabyrinth(ns, hostname, position, dir) {
    const resp = await safeAuthenticate(ns, hostname, `go ${dir}`);
    if (resp.success) return { success: true, moved: true, position };

    // Parse movement from message text
    // Moved: "You have moved to X,Y."
    // Wall:  "You cannot go that way. You are still at X,Y."
    const msg = resp.message || "";
    const movedMatch = msg.match(/moved to (\d+),(\d+)/);
    if (movedMatch) {
        const newX = parseInt(movedMatch[1], 10);
        const newY = parseInt(movedMatch[2], 10);
        return {
            success: false,
            moved: true,
            position: { x: newX, y: newY },
        };
    }

    // Not moved (wall or invalid command)
    return { success: false, moved: false, position };
}

function parseRadarDirections(radarText) {
    // labradar returns a 7x7 grid with @ at center (row 3, col 3 in 0-indexed)
    // We only need the immediate neighbors (1 cell away) to check for walls
    const rows = radarText.split("\n");
    if (rows.length < 7) return null;
    const dirs = [];
    // North: row 2, col 3 (one cell above center in the 7x7 grid)
    if (rows[2]?.[3] !== "\u2588") dirs.push("north");
    // South: row 4, col 3
    if (rows[4]?.[3] !== "\u2588") dirs.push("south");
    // West: row 3, col 2
    if (rows[3]?.[2] !== "\u2588") dirs.push("west");
    // East: row 3, col 4
    if (rows[3]?.[4] !== "\u2588") dirs.push("east");
    return dirs;
}
