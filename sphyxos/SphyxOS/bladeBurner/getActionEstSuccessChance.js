/** @param {NS} ns */
export async function main(ns) {
    let port = ns.getPortHandle(ns.pid);
    const result =
        ns.args[2] !== undefined
            ? ns.bladeburner.getActionEstimatedSuccessChance(
                  ns.args[0],
                  ns.args[1],
                  ns.args[2],
              )
            : ns.bladeburner.getActionEstimatedSuccessChance(
                  ns.args[0],
                  ns.args[1],
              );
    ns.atExit(() => port.write(result));
}
