/**
 * Darknet helper functions and password solvers
 * Based on the darknet documentation and known server model types
 */

const PASSWORD_SOLVERS = {
    'ZeroLogon': solveZeroLogon,
    'SimplePin': solveSimplePin,
    'WordList': solveWordList,
    'Caesar': solveCaesar,
    'Vigenere': solveVigenere,
    'Base64': solveBase64,
    'Hexadecimal': solveHexadecimal,
    'Binary': solveBinary,
    'ROT13': solveROT13,
    'Reverse': solveReverse,
    'Atbash': solveAtbash,
    'MorseCode': solveMorseCode,
    'DateFormat': solveDateFormat,
    'PhoneWords': solvePhoneWords,
    'LeetSpeak': solveLeetSpeak,
};

export function getDarknetPasswordSolver(modelId) {
    return PASSWORD_SOLVERS[modelId] || null;
}

export function getAllModelIds() {
    return Object.keys(PASSWORD_SOLVERS);
}

async function solveZeroLogon(ns, hostname, serverInfo) {
    return '';
}

async function solveSimplePin(ns, hostname, serverInfo) {
    const hint = serverInfo.passwordHint || '';
    const format = serverInfo.passwordFormat || '';
    
    const pinLength = (format.match(/\d/g) || []).length || 4;
    const maxAttempts = Math.pow(10, pinLength);
    
    for (let i = 0; i < maxAttempts; i++) {
        const pin = i.toString().padStart(pinLength, '0');
        const result = await ns.dnet.authenticate(hostname, pin);
        if (result.success) return pin;
        
        const logs = await ns.dnet.heartbleed(hostname, { peek: true });
        if (logs.logs && logs.logs.some(l => l.includes('close') || l.includes('warm'))) {
            continue;
        }
    }
    return null;
}

async function solveWordList(ns, hostname, serverInfo) {
    const hint = serverInfo.passwordHint || '';
    
    const commonPasswords = [
        'password', 'admin', 'root', 'letmein', 'welcome', 'monkey', 'dragon',
        'master', 'qwerty', 'login', 'passw0rd', 'starwars', 'hello', 'charlie',
        '123456', 'password1', 'abc123', 'sunshine', 'princess', 'football',
        'iloveyou', 'trustno1', 'access', 'shadow', 'superman', 'michael',
        'ashley', 'bailey', 'whatever', 'hunter', 'joshua', 'maggie',
    ];
    
    const serverFiles = ns.ls(hostname, '.txt');
    for (const file of serverFiles) {
        try {
            const content = ns.read(file);
            const words = content.split(/\s+/).filter(w => w.length > 0);
            commonPasswords.push(...words);
        } catch { }
    }
    
    for (const password of commonPasswords) {
        try {
            const result = await ns.dnet.authenticate(hostname, password);
            if (result.success) return password;
        } catch { break; }
    }
    return null;
}

async function solveCaesar(ns, hostname, serverInfo) {
    const hint = serverInfo.passwordHint || '';
    
    for (let shift = 0; shift < 26; shift++) {
        const decoded = hint.replace(/[a-zA-Z]/g, c => {
            const base = c <= 'Z' ? 65 : 97;
            return String.fromCharCode((c.charCodeAt(0) - base - shift + 26) % 26 + base);
        });
        
        const result = await ns.dnet.authenticate(hostname, decoded);
        if (result.success) return decoded;
    }
    return null;
}

async function solveVigenere(ns, hostname, serverInfo) {
    const hint = serverInfo.passwordHint || '';
    const format = serverInfo.passwordFormat || '';
    
    const commonKeys = ['key', 'password', 'secret', 'admin', 'cipher', 'code'];
    
    for (const key of commonKeys) {
        const decoded = decodeVigenere(hint, key);
        try {
            const result = await ns.dnet.authenticate(hostname, decoded);
            if (result.success) return decoded;
        } catch { break; }
    }
    return null;
}

function decodeVigenere(ciphertext, key) {
    let result = '';
    let j = 0;
    for (let i = 0; i < ciphertext.length; i++) {
        const c = ciphertext[i];
        if (/[a-zA-Z]/.test(c)) {
            const base = c <= 'Z' ? 65 : 97;
            const keyChar = key[j % key.length].toLowerCase();
            const shift = keyChar.charCodeAt(0) - 97;
            result += String.fromCharCode((c.charCodeAt(0) - base - shift + 26) % 26 + base);
            j++;
        } else {
            result += c;
        }
    }
    return result;
}

async function solveBase64(ns, hostname, serverInfo) {
    const hint = serverInfo.passwordHint || '';
    try {
        const decoded = atob(hint);
        const result = await ns.dnet.authenticate(hostname, decoded);
        if (result.success) return decoded;
    } catch { }
    return null;
}

async function solveHexadecimal(ns, hostname, serverInfo) {
    const hint = serverInfo.passwordHint || '';
    const hexMatch = hint.match(/[0-9a-fA-F]+/g);
    
    if (hexMatch) {
        for (const hex of hexMatch) {
            try {
                const decoded = hex.match(/.{2}/g).map(b => String.fromCharCode(parseInt(b, 16))).join('');
                const result = await ns.dnet.authenticate(hostname, decoded);
                if (result.success) return decoded;
            } catch { }
        }
    }
    return null;
}

async function solveBinary(ns, hostname, serverInfo) {
    const hint = serverInfo.passwordHint || '';
    const binaryMatch = hint.match(/[01]+/g);
    
    if (binaryMatch) {
        for (const binary of binaryMatch) {
            try {
                const bytes = binary.match(/.{8}/g);
                if (bytes) {
                    const decoded = bytes.map(b => String.fromCharCode(parseInt(b, 2))).join('');
                    const result = await ns.dnet.authenticate(hostname, decoded);
                    if (result.success) return decoded;
                }
            } catch { }
        }
    }
    return null;
}

async function solveROT13(ns, hostname, serverInfo) {
    const hint = serverInfo.passwordHint || '';
    const decoded = hint.replace(/[a-zA-Z]/g, c => {
        const base = c <= 'Z' ? 65 : 97;
        return String.fromCharCode((c.charCodeAt(0) - base + 13) % 26 + base);
    });
    
    const result = await ns.dnet.authenticate(hostname, decoded);
    if (result.success) return decoded;
    return null;
}

async function solveReverse(ns, hostname, serverInfo) {
    const hint = serverInfo.passwordHint || '';
    const decoded = hint.split('').reverse().join('');
    
    const result = await ns.dnet.authenticate(hostname, decoded);
    if (result.success) return decoded;
    return null;
}

async function solveAtbash(ns, hostname, serverInfo) {
    const hint = serverInfo.passwordHint || '';
    const decoded = hint.replace(/[a-zA-Z]/g, c => {
        const base = c <= 'Z' ? 65 : 97;
        return String.fromCharCode(base + (25 - (c.charCodeAt(0) - base)));
    });
    
    const result = await ns.dnet.authenticate(hostname, decoded);
    if (result.success) return decoded;
    return null;
}

const MORSE_CODE = {
    '.-': 'a', '-...': 'b', '-.-.': 'c', '-..': 'd', '.': 'e',
    '..-.': 'f', '--.': 'g', '....': 'h', '..': 'i', '.---': 'j',
    '-.-': 'k', '.-..': 'l', '--': 'm', '-.': 'n', '---': 'o',
    '.--.': 'p', '--.-': 'q', '.-.': 'r', '...': 's', '-': 't',
    '..-': 'u', '...-': 'v', '.--': 'w', '-..-': 'x', '-.--': 'y',
    '--..': 'z', '.----': '1', '..---': '2', '...--': '3', '....-': '4',
    '.....': '5', '-....': '6', '--...': '7', '---..': '8', '----.': '9',
    '-----': '0'
};

async function solveMorseCode(ns, hostname, serverInfo) {
    const hint = serverInfo.passwordHint || '';
    
    const words = hint.split(/\s{3,}|\//).map(word => 
        word.split(/\s+/).map(code => MORSE_CODE[code] || '').join('')
    );
    const decoded = words.join(' ').trim();
    
    if (decoded) {
        const result = await ns.dnet.authenticate(hostname, decoded);
        if (result.success) return decoded;
    }
    return null;
}

async function solveDateFormat(ns, hostname, serverInfo) {
    const hint = serverInfo.passwordHint || '';
    
    const dateFormats = [
        /(\d{4})-(\d{2})-(\d{2})/,
        /(\d{2})\/(\d{2})\/(\d{4})/,
        /(\d{2})\.(\d{2})\.(\d{4})/,
    ];
    
    for (const regex of dateFormats) {
        const match = hint.match(regex);
        if (match) {
            const variations = [
                match[0],
                match[0].replace(/[-\/\.]/g, ''),
                `${match[1]}${match[2]}${match[3]}`,
            ];
            for (const v of variations) {
                try {
                    const result = await ns.dnet.authenticate(hostname, v);
                    if (result.success) return v;
                } catch { break; }
            }
        }
    }
    return null;
}

const PHONE_TO_LETTERS = {
    '2': 'abc', '3': 'def', '4': 'ghi', '5': 'jkl',
    '6': 'mno', '7': 'pqrs', '8': 'tuv', '9': 'wxyz'
};

async function solvePhoneWords(ns, hostname, serverInfo) {
    const hint = serverInfo.passwordHint || '';
    const digits = hint.replace(/\D/g, '');
    
    if (digits.length < 3 || digits.length > 8) return null;
    
    function* generateCombinations(digits, current = '') {
        if (digits.length === 0) {
            yield current;
            return;
        }
        const d = digits[0];
        const letters = PHONE_TO_LETTERS[d] || d;
        for (const l of letters) {
            yield* generateCombinations(digits.slice(1), current + l);
        }
    }
    
    for (const combo of generateCombinations(digits)) {
        try {
            const result = await ns.dnet.authenticate(hostname, combo);
            if (result.success) return combo;
        } catch { break; }
    }
    return null;
}

const LEET_MAP = {
    'a': ['4', '@', 'a'], 'b': ['8', 'b'], 'c': ['(', 'c'],
    'e': ['3', 'e'], 'g': ['6', '9', 'g'], 'i': ['1', '!', 'i'],
    'l': ['1', '|', 'l'], 'o': ['0', 'o'], 's': ['5', '$', 's'],
    't': ['7', '+', 't'], 'z': ['2', 'z']
};

async function solveLeetSpeak(ns, hostname, serverInfo) {
    const hint = serverInfo.passwordHint || '';
    
    const decoded = hint.toLowerCase().replace(/[4@831!|05$7+2]/g, c => {
        for (const [letter, codes] of Object.entries(LEET_MAP)) {
            if (codes.includes(c)) return letter;
        }
        return c;
    });
    
    const result = await ns.dnet.authenticate(hostname, decoded);
    if (result.success) return decoded;
    
    const result2 = await ns.dnet.authenticate(hostname, hint);
    if (result2.success) return hint;
    
    return null;
}

export async function bruteForcePassword(ns, hostname, serverInfo, maxAttempts = 10000) {
    const format = serverInfo.passwordFormat || '';
    const charset = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const length = format.length || 4;
    
    for (let i = 0; i < Math.min(maxAttempts, Math.pow(charset.length, length)); i++) {
        let password = '';
        let n = i;
        for (let j = 0; j < length; j++) {
            password = charset[n % charset.length] + password;
            n = Math.floor(n / charset.length);
        }
        
        try {
            const result = await ns.dnet.authenticate(hostname, password);
            if (result.success) return password;
        } catch { break; }
    }
    return null;
}

export function parseDarknetLogs(logs) {
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

export function estimateCrackDifficulty(serverInfo) {
    const easyModels = ['ZeroLogon', 'Base64', 'ROT13', 'Reverse', 'Atbash'];
    const mediumModels = ['SimplePin', 'Caesar', 'Binary', 'Hexadecimal', 'MorseCode'];
    const hardModels = ['WordList', 'Vigenere', 'PhoneWords', 'LeetSpeak', 'DateFormat'];
    
    if (easyModels.includes(serverInfo.modelId)) return 'easy';
    if (mediumModels.includes(serverInfo.modelId)) return 'medium';
    if (hardModels.includes(serverInfo.modelId)) return 'hard';
    return 'unknown';
}
