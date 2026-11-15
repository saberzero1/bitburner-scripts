/** @param {NS} ns */
export async function main(ns) {
    const port = ns.port.getHandle(ns.pid);
    const result = ns.singularity.gymWorkout(ns.args[0], ns.args[1], false);
    ns.atExit(() => port.write(result));
}
