// Faithful ports of the game's darknet password generation and per-attempt feedback, for offline solver tests.
// Source: ~/Repos/bitburner-src/src/DarkNet (paths cited per function). Only the models the probe's feedback and
// dictionary solvers handle are ported.
import { readFileSync } from "node:fs";

const SRC = process.env.BITBURNER_SRC ?? `${process.env.HOME}/Repos/bitburner-src`;

// models/dictionaryData.ts: the arrays are read from the engine file itself so they can't drift.
const dictText = readFileSync(`${SRC}/src/DarkNet/models/dictionaryData.ts`, "utf8");
function dictArray(name) {
  const m = dictText.match(new RegExp(`export const ${name} = (\\[[\\s\\S]*?\\])( as const)?;`));
  if (!m) throw new Error(`dictionary ${name} not found`);
  return Function(`return ${m[1]}`)();
}
export const numbers = "0123456789";
export const letters = "abcdefghijklmnopqrstuvwxyz" + "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const defaultSettingsDictionary = dictArray("defaultSettingsDictionary");
export const dogNameDictionary = dictArray("dogNameDictionary");
export const EUCountries = dictArray("EUCountries");
export const commonPasswordDictionary = dictArray("commonPasswordDictionary");
export const packetSniffPhrases = dictArray("packetSniffPhrases");
const MAX_PASSWORD_LENGTH = 50; // DarkNet/Constants.ts

const clampNumber = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// controllers/ServerGenerator.ts getPassword
export const getPassword = (length, allowLetters = false) => {
  const characters = numbers + (allowLetters ? letters : "");
  let password = "";
  const cappedLength = clampNumber(length, 1, MAX_PASSWORD_LENGTH);
  for (let i = 0; i < cappedLength; i++) password += characters[Math.floor(Math.random() * characters.length)];
  if (!allowLetters && Number(password) > Number.MAX_SAFE_INTEGER) password = password.slice(0, 15);
  if (!allowLetters) return Number(password).toString();
  return password;
};

// controllers/ServerGenerator.ts getPasswordType (what getServerDetails reports as passwordFormat)
export const getPasswordType = (password) => {
  const a = password.split("");
  if (a.every((c) => numbers.includes(c))) return "numeric";
  if (a.every((c) => letters.includes(c))) return "alphabetic";
  if (a.every((c) => numbers.includes(c) || letters.includes(c))) return "alphanumeric";
  if (a.every((c) => c.charCodeAt(0) < 128)) return "ASCII";
  return "unicode";
};

// controllers/ServerGenerator.ts smallPrimes / largePrimes / getPasswordMadeUpOfPrimesProduct
export const smallPrimes = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97];
export const largePrimes = [
  1069, 1409, 1471, 1567, 1597, 1601, 1697, 1747, 1801, 1889, 1979, 1999, 2063, 2207, 2371, 2503, 2539, 2693, 2741,
  2753, 2801, 2819, 2837, 2909, 2939, 3169, 3389, 3571, 3761, 3881, 4217, 4289, 4547, 4729, 4789, 4877, 4943, 4951,
  4957, 5393, 5417, 5419, 5441, 5519, 5527, 5647, 5779, 5881, 6007, 6089, 6133, 6389, 6451, 6469, 6547, 6661, 6719,
  6841, 7103, 7549, 7559, 7573, 7691, 7753, 7867, 8053, 8081, 8221, 8329, 8599, 8677, 8761, 8839, 8963, 9103, 9199,
  9343, 9467, 9551, 9601, 9739, 9749, 9859,
];
const getPasswordMadeUpOfPrimesProduct = (difficulty = 1) => {
  const scale = Math.min(difficulty / 2, 15);
  let password;
  do {
    password = BigInt(Math.floor(Math.random() * 5 * (scale + 1)) + 1);
    for (let i = 0; i < scale / 3; i++) {
      if (Math.random() < 0.5) password *= BigInt(Math.ceil(Math.random() * 5));
      else password *= BigInt(smallPrimes[Math.floor(Math.random() * smallPrimes.length)]);
    }
    if (difficulty > 12) password *= BigInt(largePrimes[Math.floor(Math.random() * largePrimes.length)]);
    if (difficulty > 24) password *= BigInt(largePrimes[Math.floor(Math.random() * largePrimes.length)]);
  } while (BigInt(Number(password)) !== password);
  return password.toString();
};

// controllers/ServerGenerator.ts get*Config: [modelId, password generator]
export const GENERATORS = {
  NIL: (d) => getPassword(3 + d / 2, d > 8), // getYesn_tConfig
  "PHP 5.4": (d) => getPassword(Math.min(2 + d / 7, 9)), // getSortedEchoVulnConfig
  DeepGreen: (d) => {
    // getMastermindHintConfig
    const alphanumeric = d > 16 && Math.random() < 0.3;
    return getPassword(Math.min((alphanumeric ? -1 : 2) + d / 5, 10), alphanumeric);
  },
  "Factori-Os": (d) => getPasswordMadeUpOfPrimesProduct(d), // getDivisibilityTestConfig
  KingOfTheHill: (d) => getPassword(Math.min(1 + d / 6, 10)), // getKingOfTheHillConfig
  "RateMyPix.Auth": (d) => getPassword(3 + d / 3, d > 8), // getSpiceLevelConfig
  "2G_cellular": (d) => {
    // getTimingAttackConfig
    const alphanumeric = d > 16 && Math.random() < 0.3;
    return getPassword(Math.min((alphanumeric ? 0 : 3) + d / 4, 8), alphanumeric);
  },
  "BigMo%od": (d) => getPassword(3 + d / 5), // getTripleModuloConfig
  "FreshInstall_1.0": () => pick(defaultSettingsDictionary),
  Laika4: () => pick(dogNameDictionary),
  TopPass: () => pick(commonPasswordDictionary),
  "EuroZone Free": () => pick(EUCountries),
};
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// Casino/RNG.ts WHRNG
class WHRNG {
  constructor(seed) {
    const v = (seed / 1000) % 30000;
    this.s1 = v;
    this.s2 = v;
    this.s3 = v;
  }
  step() {
    this.s1 = (171 * this.s1) % 30269;
    this.s2 = (172 * this.s2) % 30307;
    this.s3 = (170 * this.s3) % 30323;
  }
  random() {
    this.step();
    return (this.s1 / 30269.0 + this.s2 / 30307.0 + this.s3 / 30323.0) % 1.0;
  }
}

// effects/authentication.ts getKingOfTheHillAltitude / getAltitudeGivenHillSpecs
const hill = (x, location, height, width) => height * Math.exp(((x - location) ** 2 / width ** 2) * -1);
export const getKingOfTheHillAltitude = (server, attemptedPassword) => {
  const password = Number(server.password);
  const x = Number(attemptedPassword);
  const rng = new WHRNG(password);
  const hillCount = Math.min(Math.floor(server.difficulty / 8), 4) * 2 + 1;
  const passwordHillIndex = Math.floor(rng.random() * (hillCount - 2)) + 1;
  const width = 10 ** Math.max(server.password.length - 2, 0) + 1;
  if (Math.abs((x - password) / password) < 0.03) return hill(x, password, 10000, width);
  let altitude = 0;
  for (let i = 0; i < hillCount; i++) {
    const locationOffset = (i - passwordHillIndex) * width * 3 * (rng.random() * 0.2 + 0.9);
    const heightOffset = Math.abs((i - passwordHillIndex) * 2600) * (rng.random() * 0.1 + 0.95);
    altitude += hill(x, password + locationOffset, 10000 - heightOffset, width);
  }
  return altitude;
};

// utils/darknetAuthUtils.ts
const getExactCorrectChars = (password, attempted) => password.split("").map((d, i) => d === attempted[i]);
const getExactCorrectCharsCount = (p, a) => getExactCorrectChars(p, a).filter((x) => x).length;
export const getSharedChars = (password, attempted) => {
  for (let i = 0; i < password.length; i++) if (password[i] !== attempted[i]) return i;
  return password.length;
};
const getMisplacedCorrectCharsCount = (password, attemptedPassword) => {
  const remainingPasswordChars = password.split("").filter((digit, i) => digit !== attemptedPassword[i]);
  const remainingAttemptedPasswordChars = attemptedPassword.split("").filter((digit, i) => digit !== password[i]);
  const misplaced = remainingAttemptedPasswordChars.filter((digit, i) => {
    const isPresentInPassword = remainingPasswordChars.includes(digit);
    const countInAttemptedPasswordThusFar = remainingAttemptedPasswordChars.slice(0, i).filter((p) => p === digit).length;
    const countInPassword = remainingPasswordChars.filter((p) => p === digit).length;
    return isPresentInPassword && countInAttemptedPasswordThusFar < countInPassword;
  });
  return misplaced.length;
};
const fail = (attemptedPassword, message, data) => ({ code: 401, message, data, passwordAttempted: attemptedPassword });

// effects/authentication.ts checkPassword (non-labyrinth branch, ported models only)
export function checkPassword(server, attemptedPassword, responseTime = 0) {
  if (server.password === attemptedPassword) return { code: 200, message: "Success", passwordAttempted: attemptedPassword };
  switch (server.modelId) {
    case "DeepGreen": {
      const e = getExactCorrectCharsCount(server.password, attemptedPassword);
      const m = getMisplacedCorrectCharsCount(server.password, attemptedPassword);
      return fail(attemptedPassword, `Hint: ${e} symbols match exactly, and ${m} symbols match but are in the wrong place.`, `${e},${m}`);
    }
    case "NIL": {
      const response = attemptedPassword.split("").map((c, i) => (c === server.password[i] ? "yes" : "yesn't")).join(",");
      return fail(attemptedPassword, "that wasn't right", response);
    }
    case "RateMyPix.Auth": {
      const exact = getExactCorrectChars(server.password, attemptedPassword);
      const pepper = exact.map((v) => (v ? "🌶️" : "")).join("") || "0";
      return fail(attemptedPassword, "Not spicy enough", `${pepper}/${server.password.length}`);
    }
    case "Factori-Os": {
      const password = Number(server.password);
      const div = Number(attemptedPassword);
      if (isNaN(+attemptedPassword) || password % div || attemptedPassword === "")
        return fail(attemptedPassword, `Password is not divisible by '${attemptedPassword}'`, "false");
      return fail(attemptedPassword, `Password IS divisible by '${attemptedPassword}'`, "true");
    }
    case "BigMo%od": {
      const password = Number(server.password);
      const input = Number(attemptedPassword);
      const result = (password % input) % (((input - 1) % 32) + 1);
      return fail(attemptedPassword, `(Password % ${input}) % (${input} % 32) = ${result}`, result.toString());
    }
    case "2G_cellular": {
      const idx = server.password.split("").findIndex((c, i) => c !== attemptedPassword[i]);
      return fail(attemptedPassword, `Found a mismatch while checking each character (${idx})`, `Response time: ${responseTime}ms`);
    }
    case "KingOfTheHill": {
      const altitude = getKingOfTheHillAltitude(server, attemptedPassword);
      return fail(attemptedPassword, `current altitude: ${altitude.toFixed(5)} m; highest peak: 10,000 m`, `${altitude}`);
    }
    case "PHP 5.4": {
      if (server.password.length < 5 || attemptedPassword.length !== server.password.length)
        return fail(attemptedPassword, server.staticPasswordHint, server.passwordHintData);
      let sq = 0;
      for (let i = 0; i < attemptedPassword.length; i++) {
        const a = Number(attemptedPassword[i]);
        const b = Number(server.password[i]);
        if (!Number.isFinite(a)) return fail(attemptedPassword, server.staticPasswordHint, server.passwordHintData);
        sq += (a - b) ** 2;
      }
      const rmsd = Math.sqrt(sq / attemptedPassword.length);
      return fail(attemptedPassword, server.staticPasswordHint, `${server.passwordHintData}; RMS Deviation:${rmsd.toFixed(3)}`);
    }
    default:
      return fail(attemptedPassword, server.staticPasswordHint, server.passwordHintData);
  }
}

export function makeServer(modelId, difficulty) {
  const password = GENERATORS[modelId](difficulty);
  const s = {
    hostname: "target",
    modelId,
    difficulty,
    password,
    staticPasswordHint: "",
    passwordHintData: "",
    logTrafficInterval: 1 + 30 * 0.9 ** difficulty, // models/DarknetServerOptions.ts DnetServerBuilder
    serverLogs: [],
    lastLogTime: null,
  };
  if (modelId === "PHP 5.4") {
    s.passwordHintData = password.split("").sort().join("");
    s.staticPasswordHint = `The PIN uses ${s.passwordHintData}`;
  }
  return s;
}

// NetscriptFunctions/Darknet.ts getServerDetails (fields the solvers read)
export const serverDetails = (s) => ({
  modelId: s.modelId,
  passwordHint: s.staticPasswordHint,
  data: s.passwordHintData ?? "",
  logTrafficInterval: s.logTrafficInterval,
  passwordLength: s.password.length,
  passwordFormat: getPasswordType(s.password),
  difficulty: s.difficulty,
});

// models/packetSniffing.ts: noise (string entries; their exact text doesn't matter to the parsers, only that they
// are not JSON password responses), logPasswordAttempt, getServerLogs. MAX_LOG_LINES = 200.
const MAX_LOG_LINES = 200;
const getMostRecentAuthLog = (s) => s.serverLogs.find((l) => typeof l.message === "object")?.message ?? null;
const getLogNoise = (s, date) => {
  const r = Math.random();
  if (r < 0.2) return { message: pick(packetSniffPhrases), pid: -1 };
  if (r < 0.3) {
    const last = getMostRecentAuthLog(s);
    if (last) {
      const ok = getExactCorrectChars(s.password, last.passwordAttempted);
      const right = s.password.split("").filter((c, i) => ok[i]).slice(0, 2);
      return { message: right.length ? `The characters ${right.join(", ")} are in the right place. ` : "No characters are in the right place.", pid: -1 };
    }
  }
  if (r < 0.4) return { message: `There's definitely a ${s.password[0]} and a ${s.password[1]}...`, pid: -1 };
  if (r < 0.45) return { message: `--${getPassword(6, true)}--`, pid: -1 };
  return { message: `${new Date(date).toISOString()}: ${s.hostname} - heartbeat check (alive)`, pid: -1 };
};
export function populateServerLogsWithNoise(s, now) {
  const interval = s.logTrafficInterval;
  if (!s.lastLogTime) {
    s.serverLogs.length = 0;
    s.serverLogs.push(getLogNoise(s, now - interval * 1000), getLogNoise(s, now - interval * 2000));
    s.lastLogTime = now;
    return;
  }
  const total = Math.floor((now - s.lastLogTime) / (interval * 1000));
  if (total > 0) {
    const missing = Math.min(total, MAX_LOG_LINES);
    const latest = s.lastLogTime + total * interval * 1000;
    s.serverLogs.unshift(...Array.from({ length: missing }, (_, i) => getLogNoise(s, latest - interval * 1000 * i)));
    s.serverLogs.splice(MAX_LOG_LINES);
    s.lastLogTime = latest;
  }
}
export function logPasswordAttempt(s, response, pid, now) {
  populateServerLogsWithNoise(s, now);
  s.serverLogs.unshift({ message: response, pid });
  s.serverLogs.splice(MAX_LOG_LINES);
}
export function getServerLogs(s, n, peek, now) {
  populateServerLogsWithNoise(s, now);
  const out = peek ? s.serverLogs.slice(0, n) : s.serverLogs.splice(0, n);
  return out.map((l) => (typeof l.message === "string" ? l.message : JSON.stringify(l.message)));
}

// effects/effects.ts calculateAuthenticationTime: only the thread factor and the TimingAttack per-char delay vary here;
// everything else (charisma, backdoors, ...) is folded into `baseMs`.
export function authTime(s, threads, attempted, baseMs) {
  const tf = 1 / (1 + 0.2 * (threads - 1));
  const shared = s.modelId === "2G_cellular" ? getSharedChars(s.password, attempted) : 0;
  return baseMs * tf + shared * 50 * tf;
}
