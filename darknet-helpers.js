const defaultSettingsDictionary = ['admin', 'password', '0000', '12345'];
const dogNameDictionary = ['fido', 'spot', 'rover', 'max'];
const euCountries = [
    'Austria', 'Belgium', 'Bulgaria', 'Croatia', 'Republic of Cyprus', 'Czech Republic', 'Denmark', 'Estonia',
    'Finland', 'France', 'Germany', 'Greece', 'Hungary', 'Ireland', 'Italy', 'Latvia', 'Lithuania', 'Luxembourg',
    'Malta', 'Netherlands', 'Poland', 'Portugal', 'Romania', 'Slovakia', 'Slovenia', 'Spain', 'Sweden',
];
const commonPasswordDictionary = [
    '123456', 'password', '12345678', 'qwerty', '123456789', '12345', '1234', '111111', '1234567', 'dragon',
    '123123', 'baseball', 'abc123', 'football', 'monkey', 'letmein', '696969', 'shadow', 'master', '666666',
    'qwertyuiop', '123321', 'mustang', '1234567890', 'michael', '654321', 'superman', '1qaz2wsx', '7777777',
    '121212', '0', 'qazwsx', '123qwe', 'trustno1', 'jordan', 'jennifer', 'zxcvbnm', 'asdfgh', 'hunter',
    'buster', 'soccer', 'harley', 'batman', 'andrew', 'tigger', 'sunshine', 'iloveyou', '2000', 'charlie',
    'robert', 'thomas', 'hockey', 'ranger', 'daniel', 'starwars', '112233', 'george', 'computer', 'michelle',
    'jessica', 'pepper', '1111', 'zxcvbn', '555555', '11111111', '131313', 'freedom', '777777', 'pass',
    'maggie', '159753', 'aaaaaa', 'ginger', 'princess', 'joshua', 'cheese', 'amanda', 'summer', 'love', 'ashley',
    '6969', 'nicole', 'chelsea', 'biteme', 'matthew', 'access', 'yankees', '987654321', 'dallas', 'austin',
    'thunder', 'taylor', 'matrix',
];

const ALL_MODEL_IDS = [
    'ZeroLogon',
    'DeskMemo_3.1',
    'FreshInstall_1.0',
    'CloudBlare(tm)',
    'Laika4',
    'NIL',
    'Pr0verFl0',
    'PHP 5.4',
    'DeepGreen',
    'BellaCuore',
    'AccountsManager_4.2',
    'OctantVoxel',
    'Factori-Os',
    'OpenWebAccessPoint',
    'KingOfTheHill',
    'RateMyPix.Auth',
    'PrimeTime 2',
    'TopPass',
    'EuroZone Free',
    '2G_cellular',
    '110100100',
    'MathML',
    'OrdoXenos',
    'BigMo%od',
    '(The Labyrinth)',
];

const SOLVER_MAP = {
    'ZeroLogon': solveZeroLogon,
    'DeskMemo_3.1': solveEchoVuln,
    'FreshInstall_1.0': solveFreshInstall,
    'CloudBlare(tm)': solveCloudBlare,
    'Laika4': solveDogNames,
    'NIL': solveYesnt,
    'Pr0verFl0': solveBufferOverflow,
    'PHP 5.4': solveSortedEchoVuln,
    'DeepGreen': solveMastermind,
    'BellaCuore': solveRomanNumeral,
    'AccountsManager_4.2': solveGuessNumber,
    'OctantVoxel': solveConvertToBase10,
    'Factori-Os': solveDivisibilityTest,
    'OpenWebAccessPoint': solvePacketSniffer,
    'KingOfTheHill': solveGlobalMaxima,
    'RateMyPix.Auth': solveSpiceLevel,
    'PrimeTime 2': solveLargestPrimeFactor,
    'TopPass': solveTopPass,
    'EuroZone Free': solveEuroZone,
    '2G_cellular': solveTimingAttack,
    '110100100': solveBinaryEncoded,
    'MathML': solveParsedExpression,
    'OrdoXenos': solveXorEncrypted,
    'BigMo%od': solveTripleModulo,
};

export function getDarknetPasswordSolver(modelId) {
    if (!modelId) return null;
    if (modelId === '(The Labyrinth)') return null;
    if (SOLVER_MAP[modelId]) return SOLVER_MAP[modelId];
    const normalized = modelId.toLowerCase();
    if (normalized.includes('labyrinth')) return null;
    const fuzzyMap = [
        ['zerologon', 'ZeroLogon'],
        ['deskmemo', 'DeskMemo_3.1'],
        ['freshinstall', 'FreshInstall_1.0'],
        ['cloudblare', 'CloudBlare(tm)'],
        ['laika', 'Laika4'],
        ['nil', 'NIL'],
        ['pr0ver', 'Pr0verFl0'],
        ['php 5.4', 'PHP 5.4'],
        ['deepgreen', 'DeepGreen'],
        ['bellacuore', 'BellaCuore'],
        ['accountsmanager', 'AccountsManager_4.2'],
        ['octantvoxel', 'OctantVoxel'],
        ['factori', 'Factori-Os'],
        ['openweb', 'OpenWebAccessPoint'],
        ['kingofthehill', 'KingOfTheHill'],
        ['ratemypix', 'RateMyPix.Auth'],
        ['primetime', 'PrimeTime 2'],
        ['toppass', 'TopPass'],
        ['eurozone', 'EuroZone Free'],
        ['2g_cellular', '2G_cellular'],
        ['110100100', '110100100'],
        ['mathml', 'MathML'],
        ['ordoxenos', 'OrdoXenos'],
        ['bigmo', 'BigMo%od'],
    ];
    for (const [needle, target] of fuzzyMap) {
        if (normalized.includes(needle)) return SOLVER_MAP[target] || null;
    }
    return null;
}

export async function solveLabyrinth(ns, hostname) {
    const visited = new Set();
    const stack = [];
    let position = { x: 0, y: 0 };
    let lastView = null;

    const initial = await safeAuthenticate(ns, hostname, 'go north');
    if (initial?.success) return true;
    lastView = parseLabyrinthView(initial?.data);
    if (!lastView) return false;

    while (true) {
        const key = `${position.x},${position.y}`;
        if (!visited.has(key)) visited.add(key);

        const openDirs = getOpenDirections(lastView);
        const nextDir = openDirs.find(dir => !visited.has(nextPositionKey(position, dir)));
        if (nextDir) {
            stack.push({ position: { ...position }, dir: nextDir });
            const moved = await moveLabyrinth(ns, hostname, position, nextDir);
            if (moved.success) return true;
            if (moved.moved) {
                position = moved.position;
            }
            lastView = moved.view;
            if (!lastView) return false;
            continue;
        }

        if (stack.length === 0) return false;
        const back = stack.pop();
        const reverseDir = reverseDirection(back.dir);
        const movedBack = await moveLabyrinth(ns, hostname, position, reverseDir);
        if (movedBack.success) return true;
        if (!movedBack.moved) return false;
        position = movedBack.position;
        lastView = movedBack.view;
        if (!lastView) return false;
    }
}

export function parseDarknetLogs(logs) {
    const passwords = [];
    const hints = [];
    const entries = Array.isArray(logs) ? logs : String(logs || '').split(/\r?\n/);
    for (const log of entries) {
        const line = String(log || '');
        const pwdMatch = line.match(/password[:\s]+['"]?([^'"}\s]+)/i);
        if (pwdMatch) passwords.push(pwdMatch[1]);
        const authMatch = line.match(/auth(?:enticate)?[:\s]+['"]?([^'"}\s]+)/i);
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
    const modelId = serverInfo?.modelId || '';
    const tiers = {
        0: ['ZeroLogon'],
        1: ['DeskMemo_3.1', 'FreshInstall_1.0', 'CloudBlare(tm)'],
        2: ['Laika4', 'NIL', 'Pr0verFl0'],
        3: ['PHP 5.4', 'DeepGreen', 'BellaCuore', 'AccountsManager_4.2', 'OctantVoxel', 'Factori-Os',
            'OpenWebAccessPoint', 'KingOfTheHill', 'RateMyPix.Auth'],
        4: ['PrimeTime 2', 'TopPass', 'EuroZone Free', '2G_cellular', '110100100', 'MathML', 'OrdoXenos', 'BigMo%od'],
    };
    for (const [tier, models] of Object.entries(tiers)) {
        if (models.includes(modelId)) {
            return { tier: Number(tier), label: tierLabel(Number(tier)) };
        }
    }
    return { tier: null, label: 'unknown' };
}

export async function tryFormatBruteforce(ns, hostname, serverInfo) {
    const format = serverInfo?.passwordFormat;
    const length = Number.isFinite(serverInfo?.passwordLength) && serverInfo.passwordLength > 0
        ? serverInfo.passwordLength
        : null;
    const charset = getCharsetForFormat(format);
    if (!charset || !length) return null;
    if (format === 'numeric') {
        if (length > 4) return null;
        const start = length === 1 ? 0 : Math.pow(10, length - 1);
        const end = Math.pow(10, length) - 1;
        for (let i = start; i <= end; i++) {
            const pin = i.toString();
            const result = await safeAuthenticate(ns, hostname, pin);
            if (result.success) return pin;
        }
        return null;
    }
    const maxAttempts = Math.pow(charset.length, length);
    if (!Number.isFinite(maxAttempts) || maxAttempts > 200000) return null;
    const hint = serverInfo?.passwordHint;
    if (hint && hint.length === length && [...hint].every(ch => charset.includes(ch))) {
        const result = await safeAuthenticate(ns, hostname, hint);
        if (result.success) return hint;
    }
    for (let i = 0; i < maxAttempts; i++) {
        const candidate = buildCandidate(i, charset, length);
        const result = await safeAuthenticate(ns, hostname, candidate);
        if (result.success) return candidate;
    }
    return null;
}

async function solveZeroLogon() {
    return '';
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
    const joined = digits.join('');
    const length = Number.isFinite(serverInfo?.passwordLength) ? serverInfo.passwordLength : null;
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

async function solveYesnt(ns, hostname, serverInfo) {
    const length = getPasswordLength(serverInfo, 4);
    const charset = getCharsetForFormat(serverInfo?.passwordFormat) || defaultCharset();
    let current = charset[0].repeat(length);
    for (let i = 0; i < length; i++) {
        let found = false;
        for (const ch of charset) {
            const attempt = current.substring(0, i) + ch + current.substring(i + 1);
            const resp = await safeAuthenticate(ns, hostname, attempt);
            if (resp.success) return attempt;
            const flags = parseYesnt(resp);
            if (flags && flags[i]) {
                current = attempt;
                found = true;
                break;
            }
        }
        if (!found) return null;
    }
    return current;
}

async function solveBufferOverflow(ns, hostname, serverInfo) {
    const hint = getHint(serverInfo);
    const match = hint.match(/(\d+)/);
    if (!match) return null;
    const length = Number(match[1]);
    if (!Number.isFinite(length) || length <= 0) return null;
    const candidate = 'A'.repeat(length * 2);
    const result = await safeAuthenticate(ns, hostname, candidate);
    return result.success ? candidate : null;
}

async function solveSortedEchoVuln(ns, hostname, serverInfo) {
    const sortedRaw = (getHintData(serverInfo) || getHint(serverInfo)).replace(/\s+/g, '');
    const sorted = sortedRaw.match(/\d+/g)?.join('') || '';
    if (!sorted || !/^\d+$/.test(sorted)) return null;
    const length = sorted.length;

    if (length < 5 || length <= 7) {
        const result = await solvePermutationByAuth(ns, hostname, sorted.split(''), 10000);
        return result;
    }

    const attempts = 2500;
    let bestCandidate = shuffleString(sorted);
    let bestScore = Infinity;
    let stagnation = 0;

    for (let i = 0; i < attempts; i++) {
        const resp = await safeAuthenticate(ns, hostname, bestCandidate);
        if (resp.success) return bestCandidate;
        const rmsd = parseRmsd(resp);
        if (!Number.isFinite(rmsd)) break;
        if (rmsd < bestScore) {
            bestScore = rmsd;
            stagnation = 0;
        } else {
            stagnation++;
        }
        const next = mutateSwap(bestCandidate);
        const nextResp = await safeAuthenticate(ns, hostname, next);
        if (nextResp.success) return next;
        const nextRmsd = parseRmsd(nextResp);
        if (Number.isFinite(nextRmsd) && nextRmsd <= bestScore) {
            bestCandidate = next;
            bestScore = nextRmsd;
        }
        if (stagnation > 50) {
            bestCandidate = shuffleString(sorted);
            stagnation = 0;
        }
    }
    return null;
}

async function solveMastermind(ns, hostname, serverInfo) {
    const length = getPasswordLength(serverInfo, 4);
    const charset = getCharsetForFormat(serverInfo?.passwordFormat) || '0123456789';
    const constraints = [];
    const counts = new Map();

    for (const ch of charset) {
        const attempt = ch.repeat(length);
        const resp = await safeAuthenticate(ns, hostname, attempt);
        if (resp.success) return attempt;
        const feedback = parseMastermindData(resp);
        if (feedback) {
            counts.set(ch, feedback.exact + feedback.misplaced);
            constraints.push({ guess: attempt, exact: feedback.exact, misplaced: feedback.misplaced });
        }
    }

    const multiset = [];
    for (const [ch, count] of counts.entries()) {
        for (let i = 0; i < count; i++) multiset.push(ch);
    }

    if (multiset.length !== length || multiset.length === 0) {
        return await bruteMastermind(ns, hostname, charset, length, constraints);
    }

    const tries = { count: 0, limit: 6000 };
    const checkCandidate = async (candidate) => {
        for (const c of constraints) {
            const feedback = compareMastermind(candidate, c.guess);
            if (feedback.exact !== c.exact || feedback.misplaced !== c.misplaced) return false;
        }
        const resp = await safeAuthenticate(ns, hostname, candidate);
        if (resp.success) return candidate;
        const feedback = parseMastermindData(resp);
        if (feedback) constraints.push({ guess: candidate, exact: feedback.exact, misplaced: feedback.misplaced });
        return false;
    };

    return await permuteWithConstraints(multiset, tries, checkCandidate);
}

async function solveRomanNumeral(ns, hostname, serverInfo) {
    const hintData = getHintData(serverInfo);
    if (hintData.includes(',')) {
        const [minRaw, maxRaw] = hintData.split(',');
        const min = romanToNumber(minRaw.trim());
        const max = romanToNumber(maxRaw.trim());
        if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
        let low = Math.min(min, max);
        let high = Math.max(min, max);
        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            const resp = await safeAuthenticate(ns, hostname, String(mid));
            if (resp.success) return String(mid);
            const msg = String(resp.data || resp.message || '').toUpperCase();
            if (msg.includes('ALTUS')) high = mid - 1;
            else if (msg.includes('PARUM')) low = mid + 1;
            else break;
        }
        return null;
    }

    const encoded = extractRoman(getHintData(serverInfo) || getHint(serverInfo));
    if (!encoded) return null;
    const candidate = String(romanToNumber(encoded));
    const result = await safeAuthenticate(ns, hostname, candidate);
    return result.success ? candidate : null;
}

async function solveGuessNumber(ns, hostname, serverInfo) {
    const length = getPasswordLength(serverInfo, 4);
    const maxValue = Math.pow(10, length) - 1;
    let low = 0;
    let high = maxValue;
    for (let attempt = 0; attempt < 32 && low <= high; attempt++) {
        const guess = Math.floor((low + high) / 2);
        const resp = await safeAuthenticate(ns, hostname, String(guess));
        if (resp.success) return String(guess);
        const direction = String(resp.data || '').toLowerCase();
        if (direction === 'higher') {
            low = guess + 1;
        } else if (direction === 'lower') {
            high = guess - 1;
        } else {
            break;
        }
    }
    return null;
}

async function solveConvertToBase10(ns, hostname, serverInfo) {
    const hintData = getHintData(serverInfo);
    const parts = hintData.split(',');
    if (parts.length < 2) return null;
    const base = Number(parts[0]);
    const encoded = parts.slice(1).join(',').trim();
    if (!Number.isFinite(base) || !encoded) return null;
    const value = parseBaseN(encoded, base);
    if (!Number.isFinite(value)) return null;
    const candidate = String(Math.round(value));
    const result = await safeAuthenticate(ns, hostname, candidate);
    return result.success ? candidate : null;
}

async function solveDivisibilityTest(ns, hostname) {
    const primes = generatePrimes(997);
    let product = 1n;
    for (const prime of primes) {
        const primeValue = BigInt(prime);
        const divisible = await isDivisibleBy(ns, hostname, primeValue);
        if (!divisible) continue;
        let power = primeValue;
        while (true) {
            const nextPower = power * primeValue;
            const divisiblePower = await isDivisibleBy(ns, hostname, nextPower);
            if (!divisiblePower) break;
            power = nextPower;
        }
        let temp = power;
        while (temp > 1n) {
            product *= primeValue;
            temp /= primeValue;
        }
    }
    if (product <= 1n) return null;
    const candidate = product.toString();
    const result = await safeAuthenticate(ns, hostname, candidate);
    return result.success ? candidate : null;
}

async function solvePacketSniffer(ns, hostname, serverInfo) {
    const candidates = new Set();
    const hint = getHint(serverInfo);
    if (hint) {
        candidates.add(hint.trim());
        candidates.add(hint.replace(/\s+/g, ''));
    }
    for (const value of defaultSettingsDictionary) candidates.add(value);
    for (const value of commonPasswordDictionary) candidates.add(value);
    for (const candidate of candidates) {
        if (!candidate) continue;
        const result = await safeAuthenticate(ns, hostname, candidate);
        if (result.success) return candidate;
    }
    return null;
}

async function solveGlobalMaxima(ns, hostname, serverInfo) {
    const length = getPasswordLength(serverInfo, 3);
    const width = Math.pow(10, Math.max(length - 2, 0)) + 1;
    let low = 0;
    let high = width - 1;
    const cache = new Map();

    const altitudeAt = async (x) => {
        if (cache.has(x)) return cache.get(x);
        const resp = await safeAuthenticate(ns, hostname, String(x));
        if (resp.success) return { success: true, altitude: Number(resp.data) };
        const altitude = parseAltitude(resp);
        const value = { success: false, altitude };
        cache.set(x, value);
        return value;
    };

    while (high - low > 3) {
        const m1 = Math.floor(low + (high - low) / 3);
        const m2 = Math.floor(high - (high - low) / 3);
        const a1 = await altitudeAt(m1);
        if (a1.success) return String(m1);
        const a2 = await altitudeAt(m2);
        if (a2.success) return String(m2);
        if (a1.altitude < a2.altitude) low = m1 + 1;
        else high = m2 - 1;
    }

    let best = { x: low, altitude: -Infinity };
    for (let x = low; x <= high; x++) {
        const resp = await safeAuthenticate(ns, hostname, String(x));
        if (resp.success) return String(x);
        const altitude = parseAltitude(resp);
        if (altitude > best.altitude) best = { x, altitude };
    }
    return best ? String(best.x) : null;
}

async function solveSpiceLevel(ns, hostname, serverInfo) {
    const length = getPasswordLength(serverInfo, null);
    const charset = getCharsetForFormat(serverInfo?.passwordFormat) || defaultCharset();
    if (!length) return null;

    let guess = charset[0].repeat(length);
    let baseResp = await safeAuthenticate(ns, hostname, guess);
    if (baseResp.success) return guess;
    let baseCount = parsePepperCount(baseResp);
    if (!Number.isFinite(baseCount)) return null;

    for (let i = 0; i < length; i++) {
        let bestChar = guess[i];
        let bestCount = baseCount;
        for (const ch of charset) {
            const attempt = guess.substring(0, i) + ch + guess.substring(i + 1);
            const resp = await safeAuthenticate(ns, hostname, attempt);
            if (resp.success) return attempt;
            const count = parsePepperCount(resp);
            if (Number.isFinite(count) && count > bestCount) {
                bestCount = count;
                bestChar = ch;
            }
        }
        guess = guess.substring(0, i) + bestChar + guess.substring(i + 1);
        baseCount = bestCount;
    }
    const finalResp = await safeAuthenticate(ns, hostname, guess);
    return finalResp.success ? guess : null;
}

async function solveLargestPrimeFactor(ns, hostname, serverInfo) {
    const target = extractNumber(getHintData(serverInfo) || getHint(serverInfo));
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

async function solveTimingAttack(ns, hostname, serverInfo) {
    const length = getPasswordLength(serverInfo, 4);
    const charset = getCharsetForFormat(serverInfo?.passwordFormat) || defaultCharset();
    let prefix = '';
    for (let i = 0; i < length; i++) {
        let found = false;
        for (const ch of charset) {
            const attempt = (prefix + ch).padEnd(length, charset[0]);
            const resp = await safeAuthenticate(ns, hostname, attempt);
            if (resp.success) return attempt;
            const idx = parseMismatchIndex(resp);
            if (Number.isFinite(idx) && idx > i) {
                prefix += ch;
                found = true;
                break;
            }
        }
        if (!found) return null;
    }
    return prefix;
}

async function solveBinaryEncoded(ns, hostname, serverInfo) {
    const raw = getHintData(serverInfo) || getHint(serverInfo);
    const bytes = String(raw).match(/[01]{8}/g);
    if (!bytes) return null;
    const candidate = bytes.map(b => String.fromCharCode(parseInt(b, 2))).join('');
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
    const [encrypted, masksRaw] = hintData.split(';');
    if (!encrypted || !masksRaw) return null;
    const masks = masksRaw.trim().split(/\s+/).map(mask => parseInt(mask, 2));
    if (masks.some(n => !Number.isFinite(n))) return null;
    let output = '';
    for (let i = 0; i < encrypted.length; i++) {
        const code = encrypted.charCodeAt(i);
        const mask = masks[i] ?? 0;
        output += String.fromCharCode(code ^ mask);
    }
    const result = await safeAuthenticate(ns, hostname, output);
    return result.success ? output : null;
}

async function solveTripleModulo(ns, hostname, serverInfo) {
    const length = getPasswordLength(serverInfo, null);
    if (!length) return null;
    const max = BigInt(Math.pow(10, length) - 1);
    const moduli = [31, 29, 27, 25, 23];
    const residues = [];
    for (const mod of moduli) {
        const n = nextAlignedGreater(max, mod);
        const resp = await safeAuthenticate(ns, hostname, n.toString());
        if (resp.success) return n.toString();
        const result = parseModuloResult(resp);
        if (!Number.isFinite(result)) return null;
        residues.push(BigInt(result));
    }
    const modulus = moduli.reduce((acc, m) => acc * BigInt(m), 1n);
    let candidate = crt(residues, moduli.map(m => BigInt(m)));
    if (candidate < 0n) candidate = ((candidate % modulus) + modulus) % modulus;
    while (candidate > max) candidate -= modulus;
    for (let k = 0n; candidate + k * modulus <= max; k++) {
        const attempt = candidate + k * modulus;
        const result = await safeAuthenticate(ns, hostname, attempt.toString());
        if (result.success) return attempt.toString();
    }
    return null;
}

function getHint(serverInfo) {
    return String(serverInfo?.staticPasswordHint ?? serverInfo?.passwordHint ?? '').trim();
}

function getHintData(serverInfo) {
    return String(serverInfo?.passwordHintData ?? '').trim();
}

function getPasswordLength(serverInfo, fallback) {
    return Number.isFinite(serverInfo?.passwordLength) && serverInfo.passwordLength > 0
        ? serverInfo.passwordLength
        : fallback;
}

async function safeAuthenticate(ns, hostname, password) {
    try {
        return await ns.dnet.authenticate(hostname, password);
    } catch (err) {
        logError(ns, `Darknet auth failed for ${hostname} with candidate "${password}"`, err);
        return { success: false, code: 0, message: String(err), data: null };
    }
}

function logError(ns, message, err) {
    try {
        const detail = err?.message ?? String(err);
        if (ns?.print) ns.print(`${message}: ${detail}`);
        else if (ns?.tprint) ns.tprint(`${message}: ${detail}`);
    } catch {
    }
}

async function tryDictionary(ns, hostname, words) {
    for (const word of words) {
        const result = await safeAuthenticate(ns, hostname, word);
        if (result.success) return word;
    }
    return null;
}

function extractTrailingToken(hint) {
    const match = String(hint || '').match(/([A-Za-z0-9]+)\s*$/);
    return match ? match[1] : '';
}

function extractNumber(text) {
    const match = String(text || '').match(/(\d+)/);
    return match ? Number(match[1]) : NaN;
}

function extractRoman(text) {
    const match = String(text || '').match(/([IVXLCDM]+|nulla)/i);
    return match ? match[1] : '';
}

function romanToNumber(input) {
    if (!input) return NaN;
    if (input.toLowerCase() === 'nulla') return 0;
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
    if (format === 'numeric') return '0123456789';
    if (format === 'alphabetic') return 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (format === 'alphanumeric') return '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    return null;
}

function defaultCharset() {
    return '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
}

function buildCandidate(index, charset, length) {
    let value = index;
    let output = '';
    for (let i = 0; i < length; i++) {
        output = charset[value % charset.length] + output;
        value = Math.floor(value / charset.length);
    }
    return output;
}

function parseYesnt(resp) {
    const data = String(resp?.data ?? '').trim();
    if (!data) return null;
    return data.split(',').map(entry => entry.trim().startsWith('yes'));
}

function parseMismatchIndex(resp) {
    const text = String(resp?.message ?? resp?.data ?? '');
    const match = text.match(/\((\d+)\)/);
    return match ? Number(match[1]) : NaN;
}

function parseMastermindData(resp) {
    const data = String(resp?.data ?? resp?.message ?? '');
    const match = data.match(/(\d+)\s*,\s*(\d+)/);
    if (!match) return null;
    return { exact: Number(match[1]), misplaced: Number(match[2]) };
}

function compareMastermind(candidate, guess) {
    let exact = 0;
    const remainingCandidate = [];
    const remainingGuess = [];
    for (let i = 0; i < candidate.length; i++) {
        if (candidate[i] === guess[i]) exact++;
        else {
            remainingCandidate.push(candidate[i]);
            remainingGuess.push(guess[i]);
        }
    }
    const counts = new Map();
    for (const ch of remainingCandidate) counts.set(ch, (counts.get(ch) || 0) + 1);
    let misplaced = 0;
    for (const ch of remainingGuess) {
        const count = counts.get(ch) || 0;
        if (count > 0) {
            misplaced++;
            counts.set(ch, count - 1);
        }
    }
    return { exact, misplaced };
}

async function bruteMastermind(ns, hostname, charset, length, constraints) {
    const total = Math.pow(charset.length, length);
    if (!Number.isFinite(total) || total > 300000) return null;
    for (let i = 0; i < total; i++) {
        const candidate = buildCandidate(i, charset, length);
        let ok = true;
        for (const c of constraints) {
            const feedback = compareMastermind(candidate, c.guess);
            if (feedback.exact !== c.exact || feedback.misplaced !== c.misplaced) {
                ok = false;
                break;
            }
        }
        if (!ok) continue;
        const resp = await safeAuthenticate(ns, hostname, candidate);
        if (resp.success) return candidate;
        const feedback = parseMastermindData(resp);
        if (feedback) constraints.push({ guess: candidate, exact: feedback.exact, misplaced: feedback.misplaced });
    }
    return null;
}

async function permuteWithConstraints(multiset, tries, checkCandidate) {
    const counts = new Map();
    for (const d of multiset) counts.set(d, (counts.get(d) || 0) + 1);
    const keys = Array.from(counts.keys());
    const targetLen = multiset.length;
    const buffer = new Array(targetLen);

    const backtrack = async (idx) => {
        if (tries.count >= tries.limit) return null;
        if (idx === targetLen) {
            tries.count++;
            const candidate = buffer.join('');
            const match = await checkCandidate(candidate);
            return match || null;
        }
        for (const key of keys) {
            const count = counts.get(key);
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

async function solvePermutationByAuth(ns, hostname, digits, limit) {
    const counts = new Map();
    for (const d of digits) counts.set(d, (counts.get(d) || 0) + 1);
    const keys = Array.from(counts.keys());
    const buffer = new Array(digits.length);
    let attempts = 0;

    const backtrack = async (idx) => {
        if (attempts >= limit) return null;
        if (idx === digits.length) {
            attempts++;
            const candidate = buffer.join('');
            const resp = await safeAuthenticate(ns, hostname, candidate);
            if (resp.success) return candidate;
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

function parseRmsd(resp) {
    const text = String(resp?.data ?? resp?.message ?? '');
    const match = text.match(/RMS\s*Deviation\s*:?\s*([0-9.]+)/i);
    return match ? Number(match[1]) : NaN;
}

function shuffleString(value) {
    const chars = value.split('');
    for (let i = chars.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
}

function mutateSwap(value) {
    if (value.length < 2) return value;
    const chars = value.split('');
    const i = Math.floor(Math.random() * chars.length);
    let j = Math.floor(Math.random() * chars.length);
    if (i === j) j = (j + 1) % chars.length;
    [chars[i], chars[j]] = [chars[j], chars[i]];
    return chars.join('');
}

function parsePepperCount(resp) {
    const data = String(resp?.data ?? '');
    if (!data) return NaN;
    if (data.startsWith('0/')) return 0;
    const count = (data.match(/🌶️/g) || []).length;
    if (count > 0) return count;
    const match = data.match(/^(\d+)\//);
    return match ? Number(match[1]) : NaN;
}

function parseAltitude(resp) {
    if (resp?.data !== undefined && resp?.data !== null && resp?.data !== '') {
        const value = Number(resp.data);
        if (Number.isFinite(value)) return value;
    }
    const text = String(resp?.message ?? '');
    const match = text.match(/current altitude:\s*([0-9.]+)/i);
    return match ? Number(match[1]) : NaN;
}

function parseBaseN(encoded, base) {
    const characters = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const upper = encoded.toUpperCase();
    const [intPart, fracPart] = upper.split('.');
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
    let cleaned = String(expression || '')
        .replaceAll('ҳ', '*')
        .replaceAll('÷', '/')
        .replaceAll('➕', '+')
        .replaceAll('➖', '-')
        .replaceAll('×', '*');
    if (cleaned.includes('ns.exit(),')) cleaned = cleaned.split('ns.exit(),')[0];
    if (cleaned.includes(',')) cleaned = cleaned.split(',')[0];
    return cleaned.trim();
}

function evaluateExpression(expression) {
    const tokens = tokenizeExpression(expression);
    let index = 0;

    const parseExpression = () => {
        let value = parseTerm();
        while (index < tokens.length && (tokens[index] === '+' || tokens[index] === '-')) {
            const op = tokens[index++];
            const right = parseTerm();
            value = op === '+' ? value + right : value - right;
        }
        return value;
    };

    const parseTerm = () => {
        let value = parsePower();
        while (index < tokens.length && (tokens[index] === '*' || tokens[index] === '/')) {
            const op = tokens[index++];
            const right = parsePower();
            value = op === '*' ? value * right : value / right;
        }
        return value;
    };

    const parsePower = () => {
        let value = parseUnary();
        if (tokens[index] === '^') {
            index++;
            const right = parsePower();
            value = Math.pow(value, right);
        }
        return value;
    };

    const parseUnary = () => {
        if (tokens[index] === '+') {
            index++;
            return parseUnary();
        }
        if (tokens[index] === '-') {
            index++;
            return -parseUnary();
        }
        return parsePrimary();
    };

    const parsePrimary = () => {
        const token = tokens[index++];
        if (token === '(') {
            const value = parseExpression();
            if (tokens[index] === ')') index++;
            return value;
        }
        if (typeof token === 'number') return token;
        return NaN;
    };

    const result = parseExpression();
    return Number.isFinite(result) ? result : NaN;
}

function tokenizeExpression(expression) {
    const raw = String(expression || '').replace(/\s+/g, '');
    const tokens = [];
    let i = 0;
    while (i < raw.length) {
        const ch = raw[i];
        if ('+-*/^()'.includes(ch)) {
            tokens.push(ch);
            i++;
            continue;
        }
        if (/[0-9.]/.test(ch)) {
            let num = '';
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

function generatePrimes(limit) {
    const sieve = new Array(limit + 1).fill(true);
    sieve[0] = false;
    sieve[1] = false;
    for (let i = 2; i * i <= limit; i++) {
        if (!sieve[i]) continue;
        for (let j = i * i; j <= limit; j += i) sieve[j] = false;
    }
    const primes = [];
    for (let i = 2; i <= limit; i++) if (sieve[i]) primes.push(i);
    return primes;
}

async function isDivisibleBy(ns, hostname, divisor) {
    const resp = await safeAuthenticate(ns, hostname, divisor.toString());
    if (resp.success) return true;
    const data = String(resp?.data ?? '').toLowerCase();
    if (data === 'true') return true;
    if (data === 'false') return false;
    const msg = String(resp?.message ?? '').toLowerCase();
    if (msg.includes('is divisible')) return true;
    if (msg.includes('not divisible')) return false;
    return false;
}

function parseModuloResult(resp) {
    const data = resp?.data ?? resp?.message ?? '';
    const match = String(data).match(/(-?\d+)/);
    return match ? Number(match[1]) : NaN;
}

function nextAlignedGreater(max, mod) {
    const maxMod = Number(max % 32n);
    let delta = (mod - maxMod + 32) % 32;
    if (delta === 0) delta = 32;
    return max + BigInt(delta);
}

function crt(residues, moduli) {
    let x = 0n;
    let m = 1n;
    for (let i = 0; i < residues.length; i++) {
        const r = residues[i];
        const mod = moduli[i];
        const inv = modInverse(m, mod);
        const t = ((r - x) % mod + mod) % mod;
        const k = (t * inv) % mod;
        x = x + m * k;
        m *= mod;
        x = ((x % m) + m) % m;
    }
    return x;
}

function modInverse(a, mod) {
    const { g, x } = extendedGcd(a, mod);
    if (g !== 1n) return 0n;
    return (x % mod + mod) % mod;
}

function extendedGcd(a, b) {
    if (b === 0n) return { g: a, x: 1n, y: 0n };
    const { g, x: x1, y: y1 } = extendedGcd(b, a % b);
    return { g, x: y1, y: x1 - (a / b) * y1 };
}

function tierLabel(tier) {
    if (tier === 0) return 'trivial';
    if (tier === 1) return 'easy';
    if (tier === 2) return 'medium';
    if (tier === 3) return 'hard';
    if (tier === 4) return 'expert';
    return 'unknown';
}

function parseLabyrinthView(data) {
    if (typeof data !== 'string') return null;
    const rows = data.split('\n').filter(line => line.length > 0);
    if (rows.length < 3) return null;
    const trimmed = rows.slice(0, 3).map(r => r.slice(0, 3));
    if (trimmed.length < 3) return null;
    return trimmed.map(row => row.split(''));
}

function getOpenDirections(view) {
    const open = [];
    if (!view || view.length < 3) return open;
    if (view[0]?.[1] !== '█') open.push('north');
    if (view[2]?.[1] !== '█') open.push('south');
    if (view[1]?.[0] !== '█') open.push('west');
    if (view[1]?.[2] !== '█') open.push('east');
    return open;
}

function nextPositionKey(position, dir) {
    const delta = directionDelta(dir);
    return `${position.x + delta.dx},${position.y + delta.dy}`;
}

function directionDelta(dir) {
    if (dir === 'north') return { dx: 0, dy: -2 };
    if (dir === 'south') return { dx: 0, dy: 2 };
    if (dir === 'west') return { dx: -2, dy: 0 };
    return { dx: 2, dy: 0 };
}

function reverseDirection(dir) {
    if (dir === 'north') return 'south';
    if (dir === 'south') return 'north';
    if (dir === 'west') return 'east';
    return 'west';
}

async function moveLabyrinth(ns, hostname, position, dir) {
    const resp = await safeAuthenticate(ns, hostname, `go ${dir}`);
    if (resp.success) return { success: true };
    const view = parseLabyrinthView(resp.data);
    const moved = resp?.code !== 401;
    if (moved) {
        const delta = directionDelta(dir);
        return { success: false, moved: true, position: { x: position.x + delta.dx, y: position.y + delta.dy }, view };
    }
    return { success: false, moved: false, position, view };
}
