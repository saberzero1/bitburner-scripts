import { getConfiguration, formatRam, formatMoney } from './helpers.js'

const argsSchema = [
    ['hide-stats', false],
];

export function autocomplete(data, _) {
    data.flags(argsSchema);
    return [];
}

/** @param {NS} ns */
export function main(ns) {
    const options = getConfiguration(ns, argsSchema);
    const showStats = !options['hide-stats'];
    
    if (!ns.fileExists('DarkscapeNavigator.exe', 'home')) {
        ns.tprint('ERROR: DarkscapeNavigator.exe required. Buy from darkweb.');
        return;
    }

    const css = `<style id="dnetScanCSS">
        .dnetscan {white-space:pre; color:#c0c; font:14px consolas,monospace; line-height: 16px; }
        .dnetscan .server {color:#808; cursor:pointer; text-decoration:underline;}
        .dnetscan .authenticated {color:#f0f;}
        .dnetscan .offline {color:#666;}
        .dnetscan .online {color:#0f0;}
        .dnetscan .stasis {color:#ff0;}
        .dnetscan .cache {color:#0ff;}
        .dnetscan .serverStats {color:#a8a;}
        .dnetscan .model {color:#88f;}
    </style>`;

    const doc = eval("document");
    const terminalInput = doc.getElementById("terminal-input");
    if (!terminalInput) throw new Error("Run from terminal");
    const terminalEventHandlerKey = Object.keys(terminalInput)[1];

    function terminalInsert(html) {
        const term = doc.getElementById("terminal");
        if (!term) throw new Error("Run from terminal");
        term.insertAdjacentHTML('beforeend', `<li>${html}</li>`);
    }

    const passwordFile = '/data/darknet-passwords.txt';
    const knownPasswords = loadPasswords(ns, passwordFile);
    const visited = new Set();
    const serverTree = {};
    const serverInfo = {};

    function loadPasswords(ns, filePath) {
        try {
            const data = ns.read(filePath);
            if (data) return new Map(Object.entries(JSON.parse(data)));
        } catch { }
        return new Map();
    }

    function explore(hostname, parent) {
        if (visited.has(hostname)) return;
        visited.add(hostname);

        const nearby = ns.dnet.probe();
        serverTree[hostname] = [];

        for (const neighbor of nearby) {
            if (!visited.has(neighbor)) {
                serverTree[hostname].push(neighbor);
                
                const details = ns.dnet.getServerAuthDetails(neighbor);
                serverInfo[neighbor] = {
                    ...details,
                    hasPassword: knownPasswords.has(neighbor)
                };
            }
        }
    }

    const currentHost = ns.getHostname();
    const currentProbe = ns.dnet.probe();
    
    function buildOutput() {
        let output = `\n<span class="server authenticated">[${currentHost}]</span> (current)\n`;

        for (const server of currentProbe) {
            const details = ns.dnet.getServerAuthDetails(server);
            const hasPassword = knownPasswords.has(server);

            let statusClass = details.isOnline ? 'online' : 'offline';
            if (details.hasAdminRights) statusClass = 'authenticated';

            const stasisMark = details.hasStasisLink ? ' <span class="stasis">[STASIS]</span>' : '';
            const cacheMark = hasCacheFiles(ns, server, details) ? ' <span class="cache">@</span>' : '';

            output += `├─ <span class="server ${statusClass}">${server}</span>`;
            output += ` <span class="model">(${details.modelId || 'unknown'})</span>`;
            output += stasisMark + cacheMark;

            if (showStats && details.isOnline) {
                try {
                    const maxRam = ns.getServerMaxRam(server);
                    output += ` <span class="serverStats">RAM: ${formatRam(maxRam)}</span>`;
                } catch { }
            }

            output += '\n';

            if (details.passwordHint && !details.hasAdminRights) {
                output += `│  └─ Hint: ${truncate(details.passwordHint, 50)}\n`;
            }
        }

        if (currentProbe.length === 0) {
            output += '└─ (no darknet servers nearby)\n';
        }

        return output;
    }

    function hasCacheFiles(ns, hostname, details) {
        if (!details.hasAdminRights) return false;
        try {
            return ns.ls(hostname, '.cache').length > 0;
        } catch {
            return false;
        }
    }

    function truncate(str, maxLen) {
        if (str.length <= maxLen) return str;
        return str.substring(0, maxLen - 3) + '...';
    }

    doc.getElementById("dnetScanCSS")?.remove();
    doc.head.insertAdjacentHTML('beforeend', css);

    const summary = `Darknet Scan from ${currentHost}\n` +
        `Known passwords: ${knownPasswords.size}\n` +
        `Nearby servers: ${currentProbe.length}`;

    terminalInsert(`<div class="dnetscan">${summary}${buildOutput()}</div>`);
}
