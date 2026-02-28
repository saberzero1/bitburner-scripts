/** @param {NS} ns
 * the purpose of the program-manager is to buy all the programs
 * from the darkweb we can afford so we don't have to do it manually
 * or write them ourselves. Like tor-manager, this script dies a natural death
 * once all programs are bought. **/
export async function main(ns) {
    const corePrograms = ["BruteSSH.exe", "FTPCrack.exe", "relaySMTP.exe", "HTTPWorm.exe", "SQLInject.exe"];
    
    const darknetPrograms = ["DarkscapeNavigator.exe"];
    
    const includeDarknet = ns.args.includes('--include-darknet');
    const programNames = includeDarknet ? [...corePrograms, ...darknetPrograms] : corePrograms;
    
    const interval = 2000;

    const keepRunning = ns.args.includes('-c');
    if (!keepRunning)
        ns.print(`program-manager will run once. Run with argument "-c" to run continuously.`)

    let foundMissingProgram = false;
    do {
        foundMissingProgram = false;
        for (const prog of programNames) {
            if (!ns.fileExists(prog, "home")) {
                if (ns.singularity.purchaseProgram(prog)) {
                    ns.toast(`Purchased ${prog}`, 'success');
                } else if (keepRunning) {
                    foundMissingProgram = true;
                }
            }
        }
        if (keepRunning && foundMissingProgram)
            await ns.sleep(interval);
    } while (keepRunning && foundMissingProgram);
}