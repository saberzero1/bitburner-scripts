/**
 * Darknet helper functions and password solvers
 * Based on the darknet documentation and known server model types
 */

const PASSWORD_SOLVERS = {
    'ZeroLogon': solveZeroLogon,
    'SimplePin': solveSimplePin,
    'Captcha': solveCaptcha,
    'EchoVuln': solveEchoVuln,
    'SortedEchoVuln': solveSortedEchoVuln,
    'BufferOverflow': solveBufferOverflow,
    'MastermindHint': solveMastermindHint,
    'TimingAttack': solveTimingAttack,
    'LargestPrimeFactor': solveLargestPrimeFactor,
    'RomanNumeral': solveRomanNumeral,
    'DogNames': solveDogNames,
    'CommonPasswordDictionary': solveCommonPasswordDictionary,
    'EUCountryDictionary': solveEUCountryDictionary,
    'Yesn_t': solveYesnt,
    'BinaryEncodedFeedback': solveBinaryEncodedFeedback,
    'SpiceLevel': solveSpiceLevel,
    'ConvertToBase10': solveConvertToBase10,
    'parsedExpression': solveParsedExpression,
    'encryptedPassword': solveEncryptedPassword,
    'DefaultPassword': solveDefaultPassword,
    'GuessNumber': solveGuessNumber,
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
    if (!modelId) return null;
    const normalized = modelId.toLowerCase();
    if (normalized.includes('zerologon') || normalized.includes('nopassword')) return PASSWORD_SOLVERS['ZeroLogon'];
    if (normalized.includes('captcha') || normalized.includes('cloudblare')) return PASSWORD_SOLVERS['Captcha'];
    if (normalized.includes('simplepin') || normalized.includes('pin')) return PASSWORD_SOLVERS['SimplePin'];
    if (normalized.includes('freshinstall') || normalized.includes('defaultpassword')) return PASSWORD_SOLVERS['DefaultPassword'];
    if (normalized.includes('deskmemo') || normalized.includes('echovuln')) return PASSWORD_SOLVERS['EchoVuln'];
    if (normalized.includes('php 5.4') || normalized.includes('sortedecho')) return PASSWORD_SOLVERS['SortedEchoVuln'];
    if (normalized.includes('pr0ver') || normalized.includes('bufferoverflow')) return PASSWORD_SOLVERS['BufferOverflow'];
    if (normalized.includes('deepgreen') || normalized.includes('mastermind')) return PASSWORD_SOLVERS['MastermindHint'];
    if (normalized.includes('2g_cellular') || normalized.includes('timing')) return PASSWORD_SOLVERS['TimingAttack'];
    if (normalized.includes('primetime')) return PASSWORD_SOLVERS['LargestPrimeFactor'];
    if (normalized.includes('bellacuore') || normalized.includes('roman')) return PASSWORD_SOLVERS['RomanNumeral'];
    if (normalized.includes('laika') || normalized.includes('dog')) return PASSWORD_SOLVERS['DogNames'];
    if (normalized.includes('accountsmanager') || normalized.includes('guessnumber')) return PASSWORD_SOLVERS['GuessNumber'];
    if (normalized.includes('toppass') || normalized.includes('commonpassword')) return PASSWORD_SOLVERS['CommonPasswordDictionary'];
    if (normalized.includes('eurozone') || normalized.includes('eucountry')) return PASSWORD_SOLVERS['EUCountryDictionary'];
    if (normalized.includes('yesn') || normalized.includes('nil')) return PASSWORD_SOLVERS['Yesn_t'];
    if (normalized.includes('110100100') || normalized.includes('binaryencoded')) return PASSWORD_SOLVERS['BinaryEncodedFeedback'];
    if (normalized.includes('ratemypix') || normalized.includes('spice')) return PASSWORD_SOLVERS['SpiceLevel'];
    if (normalized.includes('octantvoxel') || normalized.includes('base10')) return PASSWORD_SOLVERS['ConvertToBase10'];
    if (normalized.includes('mathml') || normalized.includes('expression')) return PASSWORD_SOLVERS['parsedExpression'];
    if (normalized.includes('ordo') || normalized.includes('xor')) return PASSWORD_SOLVERS['encryptedPassword'];
    if (normalized.includes('labyrinth')) return null;
    if (normalized.includes('caesar')) return PASSWORD_SOLVERS['Caesar'];
    if (normalized.includes('vigenere')) return PASSWORD_SOLVERS['Vigenere'];
    if (normalized.includes('base64')) return PASSWORD_SOLVERS['Base64'];
    if (normalized.includes('hex')) return PASSWORD_SOLVERS['Hexadecimal'];
    if (normalized.includes('binary')) return PASSWORD_SOLVERS['Binary'];
    if (normalized.includes('rot13')) return PASSWORD_SOLVERS['ROT13'];
    if (normalized.includes('reverse')) return PASSWORD_SOLVERS['Reverse'];
    if (normalized.includes('atbash')) return PASSWORD_SOLVERS['Atbash'];
    if (normalized.includes('morse')) return PASSWORD_SOLVERS['MorseCode'];
    if (normalized.includes('date')) return PASSWORD_SOLVERS['DateFormat'];
    if (normalized.includes('phone')) return PASSWORD_SOLVERS['PhoneWords'];
    if (normalized.includes('leet')) return PASSWORD_SOLVERS['LeetSpeak'];
    if (normalized.includes('word')) return PASSWORD_SOLVERS['WordList'];
    return PASSWORD_SOLVERS[modelId] || null;
}

export async function tryHintBasedAuth(ns, hostname, serverInfo) {
    const hint = (serverInfo.passwordHint || '').trim();
    const candidates = new Set();
    const maxLen = Number.isFinite(serverInfo.passwordLength) && serverInfo.passwordLength > 0
        ? serverInfo.passwordLength
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
            const length = Number.isFinite(serverInfo.passwordLength) ? serverInfo.passwordLength : null;
            if (length && joined.length >= length) {
                for (let i = 0; i <= joined.length - length; i++)
                    candidates.add(joined.slice(i, i + length));
            }
        }
    }
    try {
        const logs = await ns.dnet.heartbleed(hostname, { peek: true });
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

export async function solveLabyrinth(ns, hostname) {
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

export async function tryFormatBruteforce(ns, hostname, serverInfo) {
    const format = serverInfo.passwordFormat;
    const length = Number.isFinite(serverInfo.passwordLength) && serverInfo.passwordLength > 0
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
            const result = await ns.dnet.authenticate(hostname, pin);
            if (result.success) return pin;
        }
        return null;
    }
    const maxAttempts = Math.pow(charset.length, length);
    if (!Number.isFinite(maxAttempts) || maxAttempts > 200000) return null;
    const hint = serverInfo.passwordHint;
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

export function getAllModelIds() {
    return Object.keys(PASSWORD_SOLVERS);
}

async function solveZeroLogon(ns, hostname, serverInfo) {
    return '';
}

async function solveSimplePin(ns, hostname, serverInfo) {
    const hint = serverInfo.passwordHintData || serverInfo.passwordHint || '';
    const format = (serverInfo.passwordFormat || '').trim();
    const pinLength = Number.isFinite(serverInfo.passwordLength) && serverInfo.passwordLength > 0
        ? serverInfo.passwordLength
        : (hint && /^\d+$/.test(hint) ? hint.length : 4);
    if (pinLength > 4) return null;
    if (/^\d+$/.test(hint)) {
        const result = await ns.dnet.authenticate(hostname, hint);
        if (result.success) return hint;
    }
    const total = Math.pow(10, pinLength);
    const maxAttempts = 2000;
    if (total <= maxAttempts) {
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
}

async function solveCaptcha(ns, hostname, serverInfo) {
    const data = serverInfo.passwordHint || '';
    const digits = data.match(/\d/g);
    if (!digits) return null;
    const joined = digits.join('');
    const expectedLength = Number.isFinite(serverInfo.passwordLength) ? serverInfo.passwordLength : null;
    const candidates = [];
    if (expectedLength && joined.length >= expectedLength) {
        for (let i = 0; i <= joined.length - expectedLength; i++)
            candidates.push(joined.slice(i, i + expectedLength));
    } else {
        candidates.push(joined);
    }
    for (const candidate of candidates) {
        const result = await ns.dnet.authenticate(hostname, candidate);
        if (result.success) return candidate;
    }
    return null;
}

async function solveDefaultPassword(ns, hostname, serverInfo) {
    const hint = (serverInfo.passwordHint || '').toLowerCase();
    const defaults = [...defaultSettingsDictionary, 'root', 'guest', 'user', 'default', 'changeme', 'letmein',
        'passw0rd', 'welcome', 'administrator', 'qwerty'];
    if (hint) {
        for (const word of defaults) {
            if (hint.includes(word)) {
                const result = await ns.dnet.authenticate(hostname, word);
                if (result.success) return word;
            }
        }
    }
    for (const word of defaults) {
        const result = await ns.dnet.authenticate(hostname, word);
        if (result.success) return word;
    }
    return null;
}

async function solveGuessNumber(ns, hostname, serverInfo) {
    const length = Number.isFinite(serverInfo.passwordLength) && serverInfo.passwordLength > 0
        ? serverInfo.passwordLength
        : 4;
    const maxValue = Math.pow(10, length) - 1;
    const hintDigits = (serverInfo.passwordHint || '').match(/\d+/g) || [];
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

async function solveEchoVuln(ns, hostname, serverInfo) {
    const hint = serverInfo.passwordHint || serverInfo.passwordHintData || '';
    const candidate = extractTrailingToken(hint);
    if (!candidate) return null;
    const result = await ns.dnet.authenticate(hostname, candidate);
    return result.success ? candidate : null;
}

async function solveSortedEchoVuln(ns, hostname, serverInfo) {
    const sorted = (serverInfo.passwordHintData || serverInfo.passwordHint || '').replace(/\s+/g, '');
    if (!sorted || !/^\d+$/.test(sorted) || sorted.length > 7) return null;
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
}

async function solveBufferOverflow(ns, hostname, serverInfo) {
    const hint = serverInfo.passwordHint || '';
    const match = hint.match(/(\d+)/);
    if (!match) return null;
    const length = Number(match[1]);
    if (!Number.isFinite(length) || length <= 0) return null;
    const candidate = 'A'.repeat(length * 2);
    const result = await ns.dnet.authenticate(hostname, candidate);
    return result.success ? candidate : null;
}

async function solveMastermindHint(ns, hostname, serverInfo) {
    const length = Number.isFinite(serverInfo.passwordLength) && serverInfo.passwordLength > 0
        ? serverInfo.passwordLength
        : 4;
    if (length > 6) return null;
    const charset = getCharsetForFormat(serverInfo.passwordFormat) || '0123456789';
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
    if (digits.length !== length || digits.length > 7) return null;
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
}

async function solveTimingAttack(ns, hostname, serverInfo) {
    const length = Number.isFinite(serverInfo.passwordLength) && serverInfo.passwordLength > 0
        ? serverInfo.passwordLength
        : 4;
    if (length > 12) return null;
    const charset = getCharsetForFormat(serverInfo.passwordFormat) || '0123456789';
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
}

async function solveLargestPrimeFactor(ns, hostname, serverInfo) {
    const target = extractNumber(serverInfo.passwordHintData || serverInfo.passwordHint || '');
    if (!Number.isFinite(target)) return null;
    const candidate = String(largestPrimeFactor(target));
    const result = await ns.dnet.authenticate(hostname, candidate);
    return result.success ? candidate : null;
}

async function solveRomanNumeral(ns, hostname, serverInfo) {
    const hintData = serverInfo.passwordHintData || '';
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
            if (msg.includes('ALTUS')) high = mid - 1;
            else if (msg.includes('PARUM')) low = mid + 1;
            else break;
        }
        return null;
    }
    const encoded = extractRoman(serverInfo.passwordHintData || serverInfo.passwordHint || '');
    if (!encoded) return null;
    const candidate = String(romanToNumber(encoded));
    const result = await ns.dnet.authenticate(hostname, candidate);
    return result.success ? candidate : null;
}

async function solveDogNames(ns, hostname, serverInfo) {
    return await tryDictionary(ns, hostname, dogNameDictionary);
}

async function solveCommonPasswordDictionary(ns, hostname, serverInfo) {
    return await tryDictionary(ns, hostname, commonPasswordDictionary);
}

async function solveEUCountryDictionary(ns, hostname, serverInfo) {
    return await tryDictionary(ns, hostname, euCountries);
}

async function solveYesnt(ns, hostname, serverInfo) {
    const length = Number.isFinite(serverInfo.passwordLength) && serverInfo.passwordLength > 0
        ? serverInfo.passwordLength
        : 4;
    const charset = getCharsetForFormat(serverInfo.passwordFormat) || '0123456789';
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
}

async function solveBinaryEncodedFeedback(ns, hostname, serverInfo) {
    const raw = serverInfo.passwordHintData || serverInfo.passwordHint || '';
    const bytes = raw.match(/[01]{8}/g);
    if (!bytes) return null;
    const candidate = bytes.map(b => String.fromCharCode(parseInt(b, 2))).join('');
    const result = await ns.dnet.authenticate(hostname, candidate);
    return result.success ? candidate : null;
}

async function solveSpiceLevel(ns, hostname, serverInfo) {
    const length = Number.isFinite(serverInfo.passwordLength) && serverInfo.passwordLength > 0
        ? serverInfo.passwordLength
        : 4;
    if (length > 4) return null;
    const max = Math.pow(10, length);
    for (let i = 0; i < max; i++) {
        const candidate = i.toString().padStart(length, '0');
        const result = await ns.dnet.authenticate(hostname, candidate);
        if (result.success) return candidate;
    }
    return null;
}

async function solveConvertToBase10(ns, hostname, serverInfo) {
    const hintData = serverInfo.passwordHintData || '';
    const parts = hintData.split(',');
    if (parts.length < 2) return null;
    const base = Number(parts[0]);
    const encoded = parts.slice(1).join(',').trim();
    if (!Number.isFinite(base) || !encoded) return null;
    const value = parseBaseN(encoded, base);
    if (!Number.isFinite(value)) return null;
    const candidate = String(Math.round(value));
    const result = await ns.dnet.authenticate(hostname, candidate);
    return result.success ? candidate : null;
}

async function solveParsedExpression(ns, hostname, serverInfo) {
    const expr = serverInfo.passwordHintData || '';
    const cleaned = cleanExpression(expr);
    if (!cleaned) return null;
    const resultValue = evaluateExpression(cleaned);
    if (!Number.isFinite(resultValue)) return null;
    const candidate = String(resultValue);
    const result = await ns.dnet.authenticate(hostname, candidate);
    return result.success ? candidate : null;
}

async function solveEncryptedPassword(ns, hostname, serverInfo) {
    const hintData = serverInfo.passwordHintData || '';
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
    const result = await ns.dnet.authenticate(hostname, output);
    return result.success ? output : null;
}

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
