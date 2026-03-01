import { runCommand } from './helpers.js'

export function autocomplete(data, args) {
    return [
        "bladeburner", "codingcontract", "corporation", "enums", "formulas", "gang", "grafting", "hacknet",
        "infiltration", "singularity", "sleeve", "stanek", "stock", "ui"
    ];
}

/** Intended to help me explore the NS namespace by dumping properties and function results.
 * @param {NS} ns */
export async function main(ns) {
    const obj = ns.args.length > 0 ? ns[ns.args[0]] : ns;
    const strObj = ns.args.length > 0 ? `ns.${ns.args[0]}` : 'ns';
    const denylist = {
        'ns.singularity': new Set(['softReset', 'installAugmentations', 'exportGame', 'stopAction']),
        'ns.ui': new Set(['resetTheme']),
    };
    // Print all keys
    ns.tprint(Object.keys(obj));
    // Attempt to print the contents of all keys that are either properties or parameterless function calls.
    for (const k of Object.keys(obj)) {
        if (denylist[strObj]?.has(k)) continue;
        const strMember = `${strObj}.${k}`
        await runCommand(ns, `try {
			const member = ${strMember};
			if(typeof member === 'function')
				ns.tprint('${strMember}(): ' + '(function)'); // JSON.stringify(member())); // Turns out running arbitrary functions has consequences
			else
				ns.tprint('${strMember}: ' + JSON.stringify(member));
		} catch { /* Ignore failures when calling functions that require parameters */ }`);
    }
}
