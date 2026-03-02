/** @param {NS} ns 
 * Self-replicating darknet probe that explores and authenticates nearby servers.
 * Designed to be deployed to darknet servers and spread autonomously.
 */
export async function main(ns) {
    const PROBE_VERSION = 5;
    const SCRIPT_NAME = ns.getScriptName();
    const targetVersion = Number(ns.args?.[0] ?? PROBE_VERSION);
    if (targetVersion !== PROBE_VERSION) return;
    const HOST = ns.getHostname();
    const LOOP_INTERVAL = 5000;
    const PASSWORD_FILE = '/data/darknet-passwords.txt';
    const PROBE_OPTIONS_FILE = '/data/darknet-probe-options.txt';
    
    const passwords = loadPasswords(ns, PASSWORD_FILE);
    while (true) {
        const nearbyServers = ns.dnet.probe();
        
        for (const hostname of nearbyServers) {
            const success = await processServer(ns, hostname, passwords, PASSWORD_FILE, SCRIPT_NAME);
            if (success) {
                await ns.sleep(100);
            }
        }
        
        await freeBlockedRam(ns);
        await handleCacheFiles(ns, HOST);
        await runOptionalActions(ns, PROBE_OPTIONS_FILE, HOST);
        await ns.sleep(LOOP_INTERVAL);
    }
}

function loadPasswords(ns, filePath) {
    const map = new Map();
    try {
        const data = ns.read(filePath);
        if (data) {
            const parsed = JSON.parse(data);
            for (const [host, pwd] of Object.entries(parsed)) {
                map.set(host, pwd);
            }
        }
    } catch { }
    return map;
}

function savePasswords(ns, filePath, passwords) {
    const data = JSON.stringify(Object.fromEntries(passwords));
    ns.write(filePath, data, 'w');
}

async function processServer(ns, hostname, passwords, passwordFile, scriptName) {
    const details = ns.dnet.getServerAuthDetails(hostname);
    
    if (!details.isOnline) {
        return false;
    }
    const hasKnownPassword = passwords.has(hostname);
    const knownPassword = hasKnownPassword ? passwords.get(hostname) : undefined;
    if (hasKnownPassword && !details.hasSession) {
        try {
            ns.dnet.connectToSession(hostname, knownPassword ?? '');
        } catch { }
    }
    const refreshedDetails = ns.dnet.getServerAuthDetails(hostname);
    if (refreshedDetails.hasSession) {
        return await deployProbe(ns, hostname, passwords.get(hostname), scriptName);
    }
    
    const password = await authenticateServer(ns, hostname, details, passwords);
    if (password !== null) {
        passwords.set(hostname, password ?? '');
        savePasswords(ns, passwordFile, passwords);
        return await deployProbe(ns, hostname, password, scriptName);
    }
    
    return false;
}

async function authenticateServer(ns, hostname, details, passwords) {
    if ((details.modelId || '').toLowerCase().includes('labyrinth')) {
        const solved = await solveLabyrinth(ns, hostname);
        if (solved) return '';
    }
    const hasKnownPassword = passwords.has(hostname);
    const knownPassword = hasKnownPassword ? passwords.get(hostname) : undefined;
    if (hasKnownPassword) {
        const result = await ns.dnet.authenticate(hostname, knownPassword ?? '');
        if (result.success) return knownPassword;
    }
    
    const hintCandidate = await tryHintBasedAuth(ns, hostname, details);
    if (hintCandidate !== null) {
        ns.toast(`Cracked ${hostname}`, 'success');
        return hintCandidate;
    }

    const solver = getSolver(details.modelId);
    if (solver) {
        const password = await solver(ns, hostname, details);
        if (password !== null) {
            const result = await ns.dnet.authenticate(hostname, password);
            if (result.success) {
                ns.toast(`Cracked ${hostname}`, 'success');
                return password;
            }
        }
    } else {
        const fallback = await tryFormatBruteforce(ns, hostname, details);
        if (fallback !== null) {
            const result = await ns.dnet.authenticate(hostname, fallback);
            if (result.success) {
                ns.toast(`Cracked ${hostname}`, 'success');
                return fallback;
            }
        }
    }
    
    try {
    const captured = await runDnetCommand(ns, buildDnetCommand(commandNames.capture, commandArgs.singleArg));
        if (captured.password) {
            const result = await ns.dnet.authenticate(hostname, captured.password);
            if (result.success) {
                ns.toast(`Captured password for ${hostname}`, 'success');
                return captured.password;
            }
        }
    } catch { }
    
    return null;
}

async function solveLabyrinth(ns, hostname) {
    const initial = await ns.dnet.authenticate(hostname, 'look');
    const maze = typeof initial?.data === 'string' ? initial.data : '';
    if (!maze || !maze.includes('@')) return false;
    const path = solveMazePath(maze);
    if (!path) return false;
    for (const dir of path) {
        const result = await ns.dnet.authenticate(hostname, `go ${dir}`);
        if (result?.success || result?.code === 200) return true;
    }
    return false;
}

function solveMazePath(maze) {
    const rows = maze.split('\n').filter(line => line.trim().length > 0);
    if (rows.length === 0) return null;
    const minIndent = Math.min(...rows.map(r => r.match(/^\s*/)[0].length));
    const grid = rows.map(r => r.slice(minIndent).split(''));
    let start = null;
    const height = grid.length;
    const width = Math.max(...grid.map(r => r.length));
    const isWall = ch => ch && ch !== ' ' && ch !== '.' && ch !== '@';
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < grid[y].length; x++) {
            if (grid[y][x] === '@') start = [x, y];
        }
    }
    if (!start) return null;
    const isExit = (x, y) => {
        const ch = grid[y]?.[x] ?? ' ';
        if (isWall(ch)) return false;
        if (x === 0 || y === 0 || y === height - 1 || x === width - 1) return ch !== '@';
        return false;
    };
    const queue = [start];
    const visited = new Set([start.join(',')]);
    const prev = new Map();
    const dirs = [
        [0, -1, 'north'],
        [0, 1, 'south'],
        [-1, 0, 'west'],
        [1, 0, 'east'],
    ];
    while (queue.length > 0) {
        const [x, y] = queue.shift();
        if (isExit(x, y)) return reconstructPath(prev, [x, y]);
        for (const [dx, dy, dir] of dirs) {
            const nx = x + dx;
            const ny = y + dy;
            if (ny < 0 || ny >= height || nx < 0 || nx >= width) continue;
            const ch = grid[ny]?.[nx] ?? ' ';
            if (isWall(ch)) continue;
            const key = `${nx},${ny}`;
            if (visited.has(key)) continue;
            visited.add(key);
            prev.set(key, { from: `${x},${y}`, dir });
            queue.push([nx, ny]);
        }
    }
    return null;
}

function reconstructPath(prev, end) {
    const path = [];
    let key = end.join(',');
    while (prev.has(key)) {
        const entry = prev.get(key);
        path.push(entry.dir);
        key = entry.from;
    }
    return path.reverse();
}

async function deployProbe(ns, hostname, password, scriptName) {
    try {
        if (password !== undefined) {
            ns.dnet.connectToSession(hostname, password ?? '');
        }
        
        const procs = ns.ps(hostname);
        if (procs.some(p => p.filename === scriptName)) {
            return true;
        }
        
        ns.scp(scriptName, hostname);
        if (!ns.fileExists(scriptName, hostname)) return false;
        const pid = ns.exec(scriptName, hostname, 1);
        if (pid > 0) {
            ns.print(`Deployed probe to ${hostname}`);
            return true;
        }
    } catch { }
    return false;
}

async function freeBlockedRam(ns) {
    try {
        const result = await runDnetCommand(ns, buildDnetCommand(commandNames.mem));
        if (result && result.freedRam > 0) {
            ns.print(`Freed ${result.freedRam}GB RAM`);
        }
    } catch { }
}

async function handleCacheFiles(ns, hostname) {
    try {
        const caches = ns.ls(hostname, '.cache');
        for (const cache of caches) {
            try {
                const result = await runDnetCommand(ns, buildDnetCommand(commandNames.open, commandArgs.singleArg), [cache]);
                if (result) ns.print(`Opened ${cache}`);
            } catch { }
        }
    } catch { }
}

async function runOptionalActions(ns, optionsFile, hostname) {
    const options = loadProbeOptions(ns, optionsFile);
    if (options.enablePhishing) {
        await runPhishing(ns, hostname);
    }
    if (options.enableStockManipulation && options.targetStock) {
        await runStockBoost(ns, options.targetStock);
    }
}

function loadProbeOptions(ns, filePath) {
    const defaults = { enablePhishing: false, enableStockManipulation: false, targetStock: '' };
    try {
        const data = ns.read(filePath);
        if (!data) return defaults;
        const parsed = JSON.parse(data);
        return {
            enablePhishing: Boolean(parsed.enablePhishing),
            enableStockManipulation: Boolean(parsed.enableStockManipulation),
            targetStock: typeof parsed.targetStock === 'string' ? parsed.targetStock : '',
        };
    } catch {
        return defaults;
    }
}

async function runPhishing(ns, hostname) {
    try {
        const result = await runDnetCommand(ns, buildDnetCommand(commandNames.phish));
        if (result && (result.money > 0 || result.cache)) {
            const gained = result.money > 0 ? result.money : result.cache;
            ns.print(`Phishing on ${hostname}: ${gained}`);
        }
    } catch { }
}

async function runStockBoost(ns, targetStock) {
    try {
        await runDnetCommand(ns, buildDnetCommand(commandNames.promote, commandArgs.singleArg), [targetStock]);
    } catch { }
}

function getSolver(modelId) {
    const solvers = {
        'ZeroLogon': async () => '',
        
        'SimplePin': async (ns, hostname, details) => {
            const length = Number.isFinite(details.passwordLength) && details.passwordLength > 0
                ? details.passwordLength
                : (details.passwordHint && /^\d+$/.test(details.passwordHint) ? details.passwordHint.length : 4);
            if (length > 4) return null;
            if (details.passwordHint && /^\d+$/.test(details.passwordHint)) {
                const result = await ns.dnet.authenticate(hostname, details.passwordHint);
                if (result.success) return details.passwordHint;
            }
            const total = Math.pow(10, length);
            if (total <= 2000) {
                for (let i = 0; i < total; i++) {
                    const pin = i.toString();
                    const result = await ns.dnet.authenticate(hostname, pin);
                    if (result.success) return pin;
                }
                return null;
            }
            for (let i = 0; i < 200; i++) {
                const pin = Math.floor(Math.random() * total).toString();
                const result = await ns.dnet.authenticate(hostname, pin);
                if (result.success) return pin;
            }
            return null;
        },
        'Captcha': async (ns, hostname, details) => {
            const data = details.passwordHintData || details.passwordHint || '';
            const digits = data.match(/\d/g);
            if (!digits) return null;
            let candidate = digits.join('');
            const expectedLength = Number.isFinite(details.passwordLength) ? details.passwordLength : null;
            if (expectedLength && candidate.length > expectedLength)
                candidate = candidate.slice(candidate.length - expectedLength);
            return candidate;
        },
        'EchoVuln': async (ns, hostname, details) => {
            const hint = details.passwordHint || details.passwordHintData || '';
            const candidate = extractTrailingToken(hint);
            return candidate || null;
        },
        'SortedEchoVuln': async (ns, hostname, details) => {
            const sorted = (details.passwordHintData || details.passwordHint || '').replace(/\s+/g, '');
            if (!sorted) return null;
            if (!/^\d+$/.test(sorted)) return null;
            if (sorted.length > 7) return null;
            const attempts = { count: 0, limit: 3000 };
            let result = null;
            await permuteDigits(sorted.split(''), async (candidate) => {
                if (attempts.count >= attempts.limit) return false;
                attempts.count++;
                const auth = await ns.dnet.authenticate(hostname, candidate);
                if (auth.success) {
                    result = candidate;
                    return true;
                }
                return false;
            });
            return result;
        },
        'BufferOverflow': async (ns, hostname, details) => {
            const hint = details.passwordHint || '';
            const match = hint.match(/(\d+)/);
            if (!match) return null;
            const length = Number(match[1]);
            if (!Number.isFinite(length) || length <= 0) return null;
            return 'A'.repeat(length * 2);
        },
        'MastermindHint': async (ns, hostname, details) => {
            const length = Number.isFinite(details.passwordLength) && details.passwordLength > 0
                ? details.passwordLength
                : 4;
            if (length > 6) return null;
            const charset = getCharsetForFormat(details.passwordFormat) || '0123456789';
            if (charset.length > 12) return null;
            let best = null;
            const base = charset[0];
            const guess = base.repeat(length);
            const response = await ns.dnet.authenticate(hostname, guess);
            if (response.success) return guess;
            const counts = new Map();
            const resultData = parseMastermindData(response);
            if (resultData) counts.set(base, resultData.exact + resultData.misplaced);
            for (let i = 1; i < charset.length; i++) {
                const ch = charset[i];
                const resp = await ns.dnet.authenticate(hostname, ch.repeat(length));
                if (resp.success) return ch.repeat(length);
                const data = parseMastermindData(resp);
                if (data) counts.set(ch, data.exact + data.misplaced);
            }
            const digits = [];
            for (const [ch, count] of counts) {
                for (let i = 0; i < count; i++) digits.push(ch);
            }
            if (digits.length !== length) return null;
            if (digits.length > 7) return null;
            const attemptsRef = { count: 0, limit: 3000 };
            await permuteDigits(digits, async (candidate) => {
                if (attemptsRef.count >= attemptsRef.limit) return false;
                attemptsRef.count++;
                const auth = await ns.dnet.authenticate(hostname, candidate);
                if (auth.success) {
                    best = candidate;
                    return true;
                }
                return false;
            });
            return best;
        },
        'TimingAttack': async (ns, hostname, details) => {
            const length = Number.isFinite(details.passwordLength) && details.passwordLength > 0
                ? details.passwordLength
                : 4;
            if (length > 12) return null;
            const charset = getCharsetForFormat(details.passwordFormat) || '0123456789';
            let prefix = '';
            for (let i = 0; i < length; i++) {
                let found = false;
                for (const ch of charset) {
                    const attempt = (prefix + ch).padEnd(length, charset[0]);
                    const resp = await ns.dnet.authenticate(hostname, attempt);
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
        },
        'LargestPrimeFactor': async (ns, hostname, details) => {
            const target = extractNumber(details.passwordHintData || details.passwordHint || '');
            if (!Number.isFinite(target)) return null;
            return String(largestPrimeFactor(target));
        },
        'RomanNumeral': async (ns, hostname, details) => {
            const hintData = details.passwordHintData || '';
            if (hintData.includes(',')) {
                const [minRaw, maxRaw] = hintData.split(',');
                const min = romanToNumber(minRaw.trim());
                const max = romanToNumber(maxRaw.trim());
                if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
                let low = Math.min(min, max);
                let high = Math.max(min, max);
                while (low <= high) {
                    const mid = Math.floor((low + high) / 2);
                    const resp = await ns.dnet.authenticate(hostname, String(mid));
                    if (resp.success) return String(mid);
                    const msg = (resp.data || resp.message || '').toString().toUpperCase();
                    if (msg.includes('ALTUS')) {
                        high = mid - 1;
                    } else if (msg.includes('PARUM')) {
                        low = mid + 1;
                    } else {
                        break;
                    }
                }
                return null;
            }
            const encoded = extractRoman(details.passwordHintData || details.passwordHint || '');
            if (!encoded) return null;
            return String(romanToNumber(encoded));
        },
        'DogNames': async (ns, hostname, details) => {
            return await tryDictionary(ns, hostname, dogNameDictionary);
        },
        'CommonPasswordDictionary': async (ns, hostname, details) => {
            return await tryDictionary(ns, hostname, commonPasswordDictionary);
        },
        'EUCountryDictionary': async (ns, hostname, details) => {
            return await tryDictionary(ns, hostname, euCountries);
        },
        'Yesn_t': async (ns, hostname, details) => {
            const length = Number.isFinite(details.passwordLength) && details.passwordLength > 0
                ? details.passwordLength
                : 4;
            const charset = getCharsetForFormat(details.passwordFormat) || '0123456789';
            let current = charset[0].repeat(length);
            for (let i = 0; i < length; i++) {
                let found = false;
                for (const ch of charset) {
                    const attempt = current.substring(0, i) + ch + current.substring(i + 1);
                    const resp = await ns.dnet.authenticate(hostname, attempt);
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
        },
        'BinaryEncodedFeedback': async (ns, hostname, details) => {
            const raw = details.passwordHintData || details.passwordHint || '';
            const bytes = raw.match(/[01]{8}/g);
            if (!bytes) return null;
            return bytes.map(b => String.fromCharCode(parseInt(b, 2))).join('');
        },
        'SpiceLevel': async (ns, hostname, details) => {
            const length = Number.isFinite(details.passwordLength) && details.passwordLength > 0
                ? details.passwordLength
                : 4;
            if (length > 4) return null;
            const max = Math.pow(10, length);
            for (let i = 0; i < max; i++) {
                const candidate = i.toString().padStart(length, '0');
                const result = await ns.dnet.authenticate(hostname, candidate);
                if (result.success) return candidate;
            }
            return null;
        },
        'ConvertToBase10': async (ns, hostname, details) => {
            const hintData = details.passwordHintData || '';
            const parts = hintData.split(',');
            if (parts.length < 2) return null;
            const base = Number(parts[0]);
            const encoded = parts.slice(1).join(',').trim();
            if (!Number.isFinite(base) || !encoded) return null;
            const value = parseBaseN(encoded, base);
            if (!Number.isFinite(value)) return null;
            return String(Math.round(value));
        },
        'parsedExpression': async (ns, hostname, details) => {
            const expr = details.passwordHintData || '';
            const cleaned = cleanExpression(expr);
            if (!cleaned) return null;
            const result = evaluateExpression(cleaned);
            if (!Number.isFinite(result)) return null;
            return String(result);
        },
        'encryptedPassword': async (ns, hostname, details) => {
            const hintData = details.passwordHintData || '';
            const [encrypted, masks] = hintData.split(';');
            if (!encrypted || !masks) return null;
            const maskBits = masks.trim().split(/\s+/).map(b => parseInt(b, 2));
            if (maskBits.some(n => !Number.isFinite(n))) return null;
            let output = '';
            for (let i = 0; i < encrypted.length; i++) {
                const code = encrypted.charCodeAt(i);
                const mask = maskBits[i] ?? 0;
                output += String.fromCharCode(code ^ mask);
            }
            return output;
        },
        
        'Caesar': async (ns, hostname, details) => {
            const hint = details.passwordHint || '';
            for (let shift = 0; shift < 26; shift++) {
                const decoded = hint.replace(/[a-zA-Z]/g, c => {
                    const base = c <= 'Z' ? 65 : 97;
                    return String.fromCharCode((c.charCodeAt(0) - base - shift + 26) % 26 + base);
                });
                const result = await ns.dnet.authenticate(hostname, decoded);
                if (result.success) return decoded;
            }
            return null;
        },
        
        'ROT13': async (ns, hostname, details) => {
            const hint = details.passwordHint || '';
            const decoded = hint.replace(/[a-zA-Z]/g, c => {
                const base = c <= 'Z' ? 65 : 97;
                return String.fromCharCode((c.charCodeAt(0) - base + 13) % 26 + base);
            });
            return decoded;
        },
        
        'Reverse': async (ns, hostname, details) => {
            return (details.passwordHint || '').split('').reverse().join('');
        },
        
        'Base64': async (ns, hostname, details) => {
            try {
                return atob(details.passwordHint || '');
            } catch {
                return null;
            }
        },
        
        'Hexadecimal': async (ns, hostname, details) => {
            const hex = (details.passwordHint || '').match(/[0-9a-fA-F]+/);
            if (hex) {
                try {
                    return hex[0].match(/.{2}/g).map(b => String.fromCharCode(parseInt(b, 16))).join('');
                } catch { }
            }
            return null;
        },
        
        'Binary': async (ns, hostname, details) => {
            const binary = (details.passwordHint || '').match(/[01]+/);
            if (binary) {
                try {
                    const bytes = binary[0].match(/.{8}/g);
                    if (bytes) return bytes.map(b => String.fromCharCode(parseInt(b, 2))).join('');
                } catch { }
            }
            return null;
        },
        
        'Atbash': async (ns, hostname, details) => {
            const hint = details.passwordHint || '';
            return hint.replace(/[a-zA-Z]/g, c => {
                const base = c <= 'Z' ? 65 : 97;
                return String.fromCharCode(base + (25 - (c.charCodeAt(0) - base)));
            });
        },
        'DefaultPassword': async (ns, hostname, details) => {
            const hint = (details.passwordHint || '').toLowerCase();
            const defaults = [...defaultSettingsDictionary, 'root', 'guest', 'user', 'default', 'changeme', 'letmein',
                'passw0rd', 'welcome', 'administrator', 'qwerty'];
            if (hint) {
                for (const word of defaults) {
                    if (hint.includes(word)) return word;
                }
            }
            return defaults[0];
        },
        'GuessNumber': async (ns, hostname, details) => {
            const length = Number.isFinite(details.passwordLength) && details.passwordLength > 0
                ? details.passwordLength
                : 4;
            const maxValue = Math.pow(10, length) - 1;
            const hintDigits = (details.passwordHint || '').match(/\d+/g) || [];
            for (const digits of hintDigits) {
                const candidate = digits.slice(-length);
                const result = await ns.dnet.authenticate(hostname, candidate);
                if (result.success) return candidate;
            }
            let low = 0;
            let high = maxValue;
            for (let attempt = 0; attempt < 20 && low <= high; attempt++) {
                const guess = Math.floor((low + high) / 2);
                const result = await ns.dnet.authenticate(hostname, guess.toString());
                if (result.success) return guess.toString();
                const message = (result.message || '').toLowerCase();
                if (message.includes('too low') || message.includes('higher')) {
                    low = guess + 1;
                    continue;
                }
                if (message.includes('too high') || message.includes('lower')) {
                    high = guess - 1;
                    continue;
                }
                const peakMatch = message.match(/highest peak:\s*([\d,.]+)/i);
                if (peakMatch && typeof result.data === 'number') {
                    const peak = Number(String(peakMatch[1]).replace(/,/g, ''));
                    if (Number.isFinite(peak)) {
                        if (result.data < peak) {
                            low = guess + 1;
                            continue;
                        }
                        if (result.data > peak) {
                            high = guess - 1;
                            continue;
                        }
                    }
                }
                break;
            }
            return null;
        },
    };
    
    if (!modelId) return null;
    const normalized = modelId.toLowerCase();
    if (normalized.includes('zerologon') || normalized.includes('nopassword')) return solvers['ZeroLogon'];
    if (normalized.includes('captcha') || normalized.includes('cloudblare')) return solvers['Captcha'];
    if (normalized.includes('simplepin') || normalized.includes('pin')) return solvers['SimplePin'];
    if (normalized.includes('freshinstall') || normalized.includes('defaultpassword')) return solvers['DefaultPassword'];
    if (normalized.includes('deskmemo') || normalized.includes('echovuln')) return solvers['EchoVuln'];
    if (normalized.includes('php 5.4') || normalized.includes('sortedecho')) return solvers['SortedEchoVuln'];
    if (normalized.includes('pr0ver') || normalized.includes('bufferoverflow')) return solvers['BufferOverflow'];
    if (normalized.includes('deepgreen') || normalized.includes('mastermind')) return solvers['MastermindHint'];
    if (normalized.includes('2g_cellular') || normalized.includes('timing')) return solvers['TimingAttack'];
    if (normalized.includes('primetime')) return solvers['LargestPrimeFactor'];
    if (normalized.includes('bellacuore') || normalized.includes('roman')) return solvers['RomanNumeral'];
    if (normalized.includes('laika') || normalized.includes('dog')) return solvers['DogNames'];
    if (normalized.includes('accountsmanager') || normalized.includes('guessnumber')) return solvers['GuessNumber'];
    if (normalized.includes('toppass') || normalized.includes('commonpassword')) return solvers['CommonPasswordDictionary'];
    if (normalized.includes('eurozone') || normalized.includes('eucountry')) return solvers['EUCountryDictionary'];
    if (normalized.includes('yesn') || normalized.includes('nil')) return solvers['Yesn_t'];
    if (normalized.includes('110100100') || normalized.includes('binaryencoded')) return solvers['BinaryEncodedFeedback'];
    if (normalized.includes('ratemypix') || normalized.includes('spice')) return solvers['SpiceLevel'];
    if (normalized.includes('octantvoxel') || normalized.includes('base10')) return solvers['ConvertToBase10'];
    if (normalized.includes('mathml') || normalized.includes('expression')) return solvers['parsedExpression'];
    if (normalized.includes('factorios') || normalized.includes('divisibility')) return solvers['divisibilityTest'];
    if (normalized.includes('bigmo') || normalized.includes('modulo')) return solvers['tripleModulo'];
    if (normalized.includes('kingofthehill') || normalized.includes('globalmaxima')) return solvers['globalMaxima'];
    if (normalized.includes('ordo') || normalized.includes('xor')) return solvers['encryptedPassword'];
    if (normalized.includes('openweb') || normalized.includes('packet')) return solvers['packetSniffer'];
    if (normalized.includes('caesar')) return solvers['Caesar'];
    if (normalized.includes('vigenere')) return solvers['Vigenere'];
    if (normalized.includes('base64')) return solvers['Base64'];
    if (normalized.includes('hex')) return solvers['Hexadecimal'];
    if (normalized.includes('binary')) return solvers['Binary'];
    if (normalized.includes('rot13')) return solvers['ROT13'];
    if (normalized.includes('reverse')) return solvers['Reverse'];
    if (normalized.includes('atbash')) return solvers['Atbash'];
    if (normalized.includes('morse')) return solvers['MorseCode'];
    if (normalized.includes('date')) return solvers['DateFormat'];
    if (normalized.includes('phone')) return solvers['PhoneWords'];
    if (normalized.includes('leet')) return solvers['LeetSpeak'];
    if (normalized.includes('word')) return solvers['WordList'];
    return solvers[modelId] || null;
}

async function tryFormatBruteforce(ns, hostname, details) {
    const format = details.passwordFormat;
    const length = Number.isFinite(details.passwordLength) && details.passwordLength > 0
        ? details.passwordLength
        : null;
    const charset = getCharsetForFormat(format);
    if (!charset || !length) return null;
    if (format === 'numeric') {
        if (length > 4) return null;
        const start = length === 1 ? 0 : Math.pow(10, length - 1);
        const end = Math.pow(10, length) - 1;
        for (let i = start; i <= end; i++) {
            const pin = i.toString();
            const result = await ns.dnet.authenticate(hostname, pin);
            if (result.success) return pin;
        }
        return null;
    }
    const maxAttempts = Math.pow(charset.length, length);
    if (!Number.isFinite(maxAttempts) || maxAttempts > 200000) return null;
    const hint = details.passwordHint;
    if (hint && hint.length === length && [...hint].every(ch => charset.includes(ch))) {
        const result = await ns.dnet.authenticate(hostname, hint);
        if (result.success) return hint;
    }
    for (let i = 0; i < maxAttempts; i++) {
        const candidate = buildCandidate(i, charset, length);
        const result = await ns.dnet.authenticate(hostname, candidate);
        if (result.success) return candidate;
    }
    return null;
}

function getCharsetForFormat(format) {
    if (!format) return null;
    if (format === 'numeric') return '0123456789';
    if (format === 'alphabetic') return 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (format === 'alphanumeric') return '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    return null;
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

async function tryHintBasedAuth(ns, hostname, details) {
    const hint = (details.passwordHint || '').trim();
    const candidates = new Set();
    const maxLen = Number.isFinite(details.passwordLength) && details.passwordLength > 0
        ? details.passwordLength
        : 32;
    if (hint) {
        if (!/(prove you are human|captcha|type the numbers)/i.test(hint)) {
            candidates.add(hint);
            candidates.add(hint.replace(/\s+/g, ''));
            candidates.add(hint.toLowerCase());
            candidates.add(hint.toUpperCase());
        }
        if (/^\d+$/.test(hint)) candidates.add(Number(hint).toString());
        const hintDigits = hint.match(/\d/g);
        if (hintDigits) {
            const joined = hintDigits.join('');
            candidates.add(joined);
            const length = Number.isFinite(details.passwordLength) ? details.passwordLength : null;
            if (length && joined.length >= length) {
                for (let i = 0; i <= joined.length - length; i++)
                    candidates.add(joined.slice(i, i + length));
            }
        }
    }
    try {
        const logs = await runDnetCommand(ns, buildDnetCommand(commandNames.bleed, commandArgs.peekArg), [hostname]);
        if (logs?.logs) {
            const parsed = parseDarknetLogs(logs.logs);
            for (const p of parsed.passwords) candidates.add(p);
            for (const h of parsed.hints) {
                candidates.add(h);
                candidates.add(h.replace(/\s+/g, ''));
            }
        }
    } catch { }
    for (const candidate of candidates) {
        if (!candidate) continue;
        if (candidate.length > maxLen) continue;
        try {
            const result = await ns.dnet.authenticate(hostname, candidate);
            if (result.success) return candidate;
        } catch { }
    }
    return null;
}

function parseDarknetLogs(logs) {
    const passwords = [];
    const hints = [];
    for (const log of logs) {
        const pwdMatch = log.match(/password[:\s]+['"]?([^'"}\s]+)/i);
        if (pwdMatch) passwords.push(pwdMatch[1]);
        const authMatch = log.match(/auth(?:enticate)?[:\s]+['"]?([^'"}\s]+)/i);
        if (authMatch) passwords.push(authMatch[1]);
        const hintMatch = log.match(/hint[:\s]+(.+)/i);
        if (hintMatch) hints.push(hintMatch[1].trim());
    }
    return { passwords, hints };
}

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

function extractTrailingToken(hint) {
    if (!hint) return '';
    const match = hint.match(/([A-Za-z0-9]+)\s*$/);
    return match ? match[1] : '';
}

function extractNumber(text) {
    const match = String(text).match(/(\d+)/);
    if (!match) return NaN;
    return Number(match[1]);
}

function extractRoman(text) {
    const match = String(text).match(/([IVXLCDM]+|nulla)/i);
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

async function tryDictionary(ns, hostname, words) {
    for (const word of words) {
        const result = await ns.dnet.authenticate(hostname, word);
        if (result.success) return word;
    }
    return null;
}

function parseMastermindData(resp) {
    const data = (resp.data || resp.message || '').toString();
    const match = data.match(/(\d+)\s*,\s*(\d+)/);
    if (!match) return null;
    return { exact: Number(match[1]), misplaced: Number(match[2]) };
}

function parseMismatchIndex(resp) {
    const data = (resp.data || resp.message || '').toString();
    const match = data.match(/\((\d+)\)/);
    if (!match) return NaN;
    return Number(match[1]);
}

function parseYesnt(resp) {
    const data = (resp.data || resp.message || '').toString();
    if (!data) return null;
    return data.split(',').map(entry => entry.trim().startsWith('yes'));
}

function permuteDigits(digits, visit) {
    const counts = new Map();
    for (const d of digits) counts.set(d, (counts.get(d) || 0) + 1);
    const keys = Array.from(counts.keys());
    const targetLen = digits.length;
    const buffer = new Array(targetLen);

    const backtrack = async (idx) => {
        if (idx === targetLen) {
            return await visit(buffer.join(''));
        }
        for (const key of keys) {
            const count = counts.get(key);
            if (!count) continue;
            counts.set(key, count - 1);
            buffer[idx] = key;
            if (await backtrack(idx + 1)) return true;
            counts.set(key, count);
        }
        return false;
    };

    return backtrack(0);
}

function parseBaseN(numberString, base) {
    const characters = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = 0;
    let index = 0;
    let digit = numberString.split('.')[0].length - 1;
    while (index < numberString.length) {
        const currentDigit = numberString[index];
        if (currentDigit === '.') {
            index += 1;
            continue;
        }
        const value = characters.indexOf(currentDigit.toUpperCase());
        if (value < 0) return NaN;
        result += value * base ** digit;
        index += 1;
        digit -= 1;
    }
    return result;
}

function cleanExpression(expression) {
    return String(expression)
        .replaceAll('ҳ', '*')
        .replaceAll('÷', '/')
        .replaceAll('➕', '+')
        .replaceAll('➖', '-')
        .replaceAll('ns.exit(),', '')
        .split(',')[0];
}

function evaluateExpression(expression) {
    const tokens = tokenizeExpression(expression);
    const output = [];
    const ops = [];
    const precedence = { '+': 1, '-': 1, '*': 2, '/': 2 };
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (typeof token === 'number') {
            output.push(token);
            continue;
        }
        if (token === '(') {
            ops.push(token);
            continue;
        }
        if (token === ')') {
            while (ops.length && ops[ops.length - 1] !== '(') output.push(ops.pop());
            ops.pop();
            continue;
        }
        while (ops.length && precedence[ops[ops.length - 1]] >= precedence[token]) {
            output.push(ops.pop());
        }
        ops.push(token);
    }
    while (ops.length) output.push(ops.pop());
    const stack = [];
    for (const token of output) {
        if (typeof token === 'number') {
            stack.push(token);
            continue;
        }
        const b = stack.pop();
        const a = stack.pop();
        if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
        if (token === '+') stack.push(a + b);
        if (token === '-') stack.push(a - b);
        if (token === '*') stack.push(a * b);
        if (token === '/') stack.push(a / b);
    }
    return stack.length === 1 ? stack[0] : NaN;
}

function tokenizeExpression(expression) {
    const raw = String(expression).replace(/\s+/g, '');
    const tokens = [];
    let i = 0;
    const isOp = (t) => ['+', '-', '*', '/'].includes(t);
    while (i < raw.length) {
        const ch = raw[i];
        if (ch === '(' || ch === ')' || isOp(ch)) {
            if (ch === '-' && (tokens.length === 0 || tokens[tokens.length - 1] === '(' || isOp(tokens[tokens.length - 1]))) {
                let num = '-';
                i++;
                while (i < raw.length && /[0-9.]/.test(raw[i])) {
                    num += raw[i];
                    i++;
                }
                tokens.push(parseFloat(num));
                continue;
            }
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

const nsToken = ['n', 's'].join('');
const dnetToken = ['d', 'n', 'e', 't'].join('');
const nsPrefix = `${nsToken}.`;
const dnetPrefix = `${nsPrefix}${dnetToken}.`;
const influenceToken = ['in', 'fluence'].join('');

const commandNames = {
    capture: ['packet', 'Capture'].join(''),
    open: ['open', 'Cache'].join(''),
    phish: ['phishing', 'Attack'].join(''),
    promote: ['promote', 'Stock'].join(''),
    bleed: ['heart', 'bleed'].join(''),
    mem: `${influenceToken}.${['memory', 'Reallocation'].join('')}`,
};

const commandArgs = {
    singleArg: `${nsPrefix}args[0]`,
    peekArg: `${nsPrefix}args[0], { peek: true }`,
};

let commandCounter = 0;

function buildDnetCommand(name, args = '') {
    return `${dnetPrefix}${name}(${args})`;
}

async function runDnetCommand(ns, command, args = []) {
    const id = (commandCounter++ % 100000);
    const host = ns.getHostname();
    const resultFile = `/Temp/dnet-probe-${id}.txt`;
    const scriptFile = `/Temp/dnet-probe-${id}.js`;
    const script = `export async function main(ns){let r;try{const v=await (${command});` +
        `const w=v===undefined?{ $type:'undefined' }:v===null?{ $type:'null' }:v;` +
        `r=JSON.stringify({ $type:'result', $value:w });}catch(e){r="ERROR: "+(typeof e==='string'?e:e?.message??JSON.stringify(e));}` +
        `const f="${resultFile}"; ns.write(f,r,'w');}`;
    ns.write(scriptFile, script, 'w');
    ns.write(resultFile, '<pending>', 'w');
    const pid = ns.exec(scriptFile, host, 1, ...args);
    if (!pid) return null;
    for (let i = 0; i < 50; i++) {
        const data = ns.read(resultFile);
        if (data && data !== '<pending>') {
            return decodePayload(data);
        }
        await ns.sleep(10);
    }
    return null;
}

function decodePayload(data) {
    if (!data || typeof data !== 'string') return null;
    if (data.startsWith('ERROR:')) return null;
    try {
        const parsed = JSON.parse(data);
        if (!parsed || parsed.$type !== 'result') return parsed;
        return revivePayload(parsed.$value);
    } catch {
        return null;
    }
}

function revivePayload(value) {
    if (value && value.$type === 'null') return null;
    if (value && value.$type === 'undefined') return undefined;
    return value;
}

export function autocomplete(data) {
    return ['--tail'];
}
