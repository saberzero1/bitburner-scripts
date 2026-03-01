/** @param {NS} ns 
 * Self-replicating darknet probe that explores and authenticates nearby servers.
 * Designed to be deployed to darknet servers and spread autonomously.
 */
export async function main(ns) {
    const PROBE_VERSION = 2;
    const SCRIPT_NAME = ns.getScriptName();
    const targetVersion = Number(ns.args?.[0] ?? PROBE_VERSION);
    if (targetVersion !== PROBE_VERSION) return;
    const HOST = ns.getHostname();
    const LOOP_INTERVAL = 5000;
    const PASSWORD_FILE = '/data/darknet-passwords.txt';
    
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
        await openCacheFiles(ns, HOST);
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
    const knownPassword = passwords.get(hostname);
    if (knownPassword && !details.hasSession) {
        try {
            ns.dnet.connectToSession(hostname, knownPassword);
        } catch { }
    }
    const refreshedDetails = ns.dnet.getServerAuthDetails(hostname);
    if (refreshedDetails.hasSession) {
        return await deployProbe(ns, hostname, passwords.get(hostname), scriptName);
    }
    
    const password = await authenticateServer(ns, hostname, details, passwords);
    if (password !== null) {
        passwords.set(hostname, password);
        savePasswords(ns, passwordFile, passwords);
        return await deployProbe(ns, hostname, password, scriptName);
    }
    
    return false;
}

async function authenticateServer(ns, hostname, details, passwords) {
    const knownPassword = passwords.get(hostname);
    if (knownPassword) {
        const result = await ns.dnet.authenticate(hostname, knownPassword);
        if (result.success) return knownPassword;
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
        const captured = await ns.dnet.packetCapture(hostname);
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

async function deployProbe(ns, hostname, password, scriptName) {
    try {
        if (password) {
            ns.dnet.connectToSession(hostname, password);
        }
        
        const procs = ns.ps(hostname);
        if (procs.some(p => p.filename === scriptName)) {
            return true;
        }
        
        ns.scp(scriptName, hostname);
        const pid = ns.exec(scriptName, hostname, { preventDuplicates: true });
        if (pid > 0) {
            ns.print(`Deployed probe to ${hostname}`);
            return true;
        }
    } catch { }
    return false;
}

async function freeBlockedRam(ns) {
    try {
        const result = ns.dnet.influence.memoryReallocation();
        if (result && result.freedRam > 0) {
            ns.print(`Freed ${result.freedRam}GB RAM`);
        }
    } catch { }
}

async function openCacheFiles(ns, hostname) {
    try {
        const caches = ns.ls(hostname, '.cache');
        for (const cache of caches) {
            try {
                const result = ns.dnet.openCache(cache);
                if (result) ns.print(`Opened ${cache}`);
            } catch { }
        }
    } catch { }
}

function getSolver(modelId) {
    const solvers = {
        'ZeroLogon': async () => '',
        
        'SimplePin': async (ns, hostname, details) => {
            const length = Number.isFinite(details.passwordLength) && details.passwordLength > 0
                ? details.passwordLength
                : (details.passwordHint && /^\d+$/.test(details.passwordHint) ? details.passwordHint.length : 4);
            for (let i = 0; i < Math.pow(10, length); i++) {
                const pin = i.toString();
                const result = await ns.dnet.authenticate(hostname, pin);
                if (result.success) return pin;
            }
            return null;
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
    };
    
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

export function autocomplete(data) {
    return ['--tail'];
}
