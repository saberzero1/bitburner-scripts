/** @param {NS} ns */
export async function main(ns) {
    ns.singularity.purchaseTor();
    ns.singularity.purchaseProgram("BruteSSH.exe");
    ns.singularity.purchaseProgram("FTPCrack.exe");
    ns.singularity.purchaseProgram("relaySMTP.exe");
    ns.singularity.purchaseProgram("HTTPWorm.exe");
    ns.singularity.purchaseProgram("SQLInject.exe");

    let count = 0;
    if (ns.fileExists("BruteSSH.exe", "home")) count++;
    if (ns.fileExists("FTPCrack.exe", "home")) count++;
    if (ns.fileExists("relaySMTP.exe", "home")) count++;
    if (ns.fileExists("HTTPWorm.exe", "home")) count++;
    if (ns.fileExists("SQLInject.exe", "home")) count++;

    const port = ns.getPortHandle(ns.pid);
    ns.atExit(() => port.write(count));
}
