/** @param {NS} ns */
export async function main(ns) {
    let destructure = true;
    try {
        const { completion, ...result } = ns.singularity.getCurrentWork();
    } catch {
        destructure = false;
    }
    if (destructure) {
        const { completion, ...result } = ns.singularity.getCurrentWork();
        ns.atExit(() => ns.port.write(ns.pid, result));
    } else
        ns.atExit(() => ns.port.write(ns.pid, ns.singularity.getCurrentWork()));
}
