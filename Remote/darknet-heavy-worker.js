import { getNsDataThroughFile } from '../helpers.js'

export async function main(ns) {
    const WORKER_VERSION = 1;
    const targetVersion = Number(ns.args?.[0] ?? WORKER_VERSION);
    if (targetVersion !== WORKER_VERSION) return;
    const enablePhishing = String(ns.args?.[1] ?? 'false') === 'true';
    const enableStock = String(ns.args?.[2] ?? 'false') === 'true';
    const targetStock = String(ns.args?.[3] ?? '');
    const hostname = ns.getHostname();

    await freeBlockedRam(ns, hostname);
    await openCacheFiles(ns, hostname);
    if (enablePhishing) await phishingAttack(ns, hostname);
    if (enableStock && targetStock) await promoteStock(ns, targetStock);
    await packetCaptureAuth(ns, hostname);
}

async function freeBlockedRam(ns, hostname) {
    try {
        const memResult = await getNsDataThroughFile(ns, 'ns.dnet.influence.memoryReallocation()');
        if (memResult && memResult.freedRam > 0) {
            ns.print(`Freed ${memResult.freedRam} RAM on ${hostname}`);
        }
    } catch { }
}

async function openCacheFiles(ns, hostname) {
    try {
        const cacheFiles = ns.ls(hostname, '.cache');
        for (const cache of cacheFiles) {
            try {
                const result = await getNsDataThroughFile(ns, 'ns.dnet.openCache(ns.args[0])', null, [cache], false, 1, 0, true);
                if (result) ns.print(`Opened cache ${cache}`);
            } catch { }
        }
    } catch { }
}

async function phishingAttack(ns, hostname) {
    try {
        const result = await getNsDataThroughFile(ns, 'ns.dnet.phishingAttack()');
        if (result && (result.money > 0 || result.cache)) {
            const gained = result.money > 0 ? result.money : result.cache;
            ns.print(`Phishing on ${hostname}: ${gained}`);
        }
    } catch { }
}

async function promoteStock(ns, targetStock) {
    try {
        await getNsDataThroughFile(ns, 'ns.dnet.promoteStock(ns.args[0])', null, [targetStock], false, 1, 0, true);
    } catch { }
}

async function packetCaptureAuth(ns, hostname) {
    const passwordFile = '/data/darknet-passwords.txt';
    try {
        const captured = await getNsDataThroughFile(ns, 'ns.dnet.packetCapture(ns.args[0])', null, [hostname], false, 1, 0, true);
        if (captured?.password) {
            const passwords = loadPasswords(ns, passwordFile);
            passwords.set(hostname, captured.password);
            savePasswords(ns, passwordFile, passwords);
        }
    } catch { }
}

function loadPasswords(ns, filePath) {
    const map = new Map();
    try {
        const data = ns.read(filePath);
        if (data) {
            const parsed = JSON.parse(data);
            for (const [host, pwd] of Object.entries(parsed)) map.set(host, pwd);
        }
    } catch { }
    return map;
}

function savePasswords(ns, filePath, passwords) {
    const data = JSON.stringify(Object.fromEntries(passwords));
    ns.write(filePath, data, 'w');
}
