export async function main(ns) {
    let port = ns.getPortHandle(ns.pid);
    const result = ns.bladeburner.setActionAutolevel(
        ns.args[0],
        ns.args[1],
        ns.args[2],
    );
    ns.atExit(() => port.write(result));
}
