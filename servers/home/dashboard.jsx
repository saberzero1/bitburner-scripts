// dashboard.jsx — BitBurner Dashboard (Phase 1)
// Renders a React dashboard in a tail window via ns.printRaw()
// RAM: ~4.6 GB (ns.ps, ns.read, ns.scan, ns.killall, ns.getServerMaxRam, ns.getServerUsedRam, ns.exec, ns.kill, ns.isRunning)

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    ns.ui.openTail();

    // Auto-size and position the tail window
    const [winW, winH] = ns.ui.windowSize();
    ns.ui.resizeTail(Math.floor(winW * 0.7), Math.floor(winH * 0.9));
    ns.ui.moveTail(Math.floor(winW * 0.15), Math.floor(winH * 0.05));

    // Set a custom tail title
    ns.ui.setTailTitle("⚡ Command Deck");

    // Detect the user's game theme colors
    const gameTheme = ns.ui.getTheme();

    ns.printRaw(<Dashboard ns={ns} gameTheme={gameTheme} />);
    while (true) {
        await ns.asleep(60000);
    }
}

function formatNumberShort(num) {
    if (!Number.isFinite(num)) return "-";
    const abs = Math.abs(num);
    const sign = num < 0 ? "-" : "";
    if (abs < 1000) return `${sign}${Math.round(abs)}`;
    const scales = [
        { value: 1e3, symbol: "k" },
        { value: 1e6, symbol: "m" },
        { value: 1e9, symbol: "b" },
        { value: 1e12, symbol: "t" },
        { value: 1e15, symbol: "q" },
    ];
    const scale =
        scales
            .slice()
            .reverse()
            .find((item) => abs >= item.value) || scales[0];
    const value = abs / scale.value;
    const decimals = value >= 100 ? 0 : value >= 10 ? 1 : 2;
    return `${sign}${value.toFixed(decimals)}${scale.symbol}`;
}

function formatMoney(num) {
    if (!Number.isFinite(num)) return "-$";
    return `$${formatNumberShort(num)}`;
}

function formatDuration(ms) {
    if (!Number.isFinite(ms)) return "-";
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (hours > 0 || minutes > 0) parts.push(`${minutes}m`);
    parts.push(`${seconds}s`);
    return parts.join(" ");
}

function getFilePath(file) {
    return file;
}

function scanAllServers(ns) {
    const visited = new Set(["home"]);
    const queue = ["home"];
    while (queue.length > 0) {
        const host = queue.shift();
        for (const neighbor of ns.scan(host)) {
            if (!visited.has(neighbor)) {
                visited.add(neighbor);
                queue.push(neighbor);
            }
        }
    }
    return [...visited];
}

// Scripts that support --no-tail-windows to suppress tail window auto-opening
const SUPPORTS_NO_TAIL_WINDOWS = [
    "autopilot.js",
    "daemon.js",
    "work-for-factions.js",
];
// Scripts that support --no-tail instead
const SUPPORTS_NO_TAIL = ["stanek.js", "infiltrator.js"];

const TABS = [
    { id: "overview", label: "📊 Overview" },
    { id: "hacking", label: "💻 Hacking" },
    { id: "gang", label: "🔫 Gang" },
    { id: "stocks", label: "📈 Stocks" },
    { id: "sleeves", label: "🧬 Sleeves" },
    { id: "bladeburner", label: "🗡️ Bladeburner" },
    { id: "corp", label: "🏢 Corp" },
    { id: "factions", label: "🤝 Factions" },
    { id: "infra", label: "🖥️ Infrastructure" },
];

const AUTOPILOT_MANAGED = [
    "daemon.js",
    "stockmaster.js",
    "sleeve.js",
    "gangs.js",
    "work-for-factions.js",
    "infiltrator.js",
    "bladeburner.js",
    "casino.js",
    "faction-manager.js",
    "ascend.js",
    "stanek.js",
];
const DAEMON_ASYNC = [
    "stats.js",
    "go.js",
    "stockmaster.js",
    "hacknet-upgrade-manager.js",
    "spend-hacknet-hashes.js",
    "sleeve.js",
    "gangs.js",
    "work-for-factions.js",
    "bladeburner.js",
    "darknet.js",
    "corporation.js",
    "infiltrator.js",
];
const DAEMON_PERIODIC = [
    "/Tasks/tor-manager.js",
    "/Tasks/program-manager.js",
    "/Tasks/contractor.js",
    "/Tasks/ram-manager.js",
    "/Tasks/backdoor-all-servers.js",
    "hacknet-upgrade-manager.js",
    "host-manager.js",
    "faction-manager.js",
];

const ORCHESTRATORS = ["autopilot.js", "daemon.js"];
const LONG_LIVED = [...new Set(DAEMON_ASYNC)];
const PERIODIC = [...new Set(DAEMON_PERIODIC)];
const OTHER = AUTOPILOT_MANAGED.filter(
    (name) =>
        !ORCHESTRATORS.includes(name) &&
        !LONG_LIVED.includes(name) &&
        !PERIODIC.includes(name),
);

const THEME = {
    background: "#1a1a2e",
    surface: "#16213e",
    text: "#e0e0e0",
    accent: "#0f3460",
    green: "#00ff41",
    red: "#ff4444",
    orange: "#ffa500",
    border: "#333355",
};

function Dashboard({ ns, gameTheme }) {
    const [activeTab, setActiveTab] = React.useState("overview");
    const [scripts, setScripts] = React.useState([]);
    const [maxRam, setMaxRam] = React.useState(0);
    const [freeRam, setFreeRam] = React.useState(0);
    const [actionError, setActionError] = React.useState(null);

    React.useEffect(() => {
        let timeoutId;
        const poll = () => {
            let nextScripts = [];
            try {
                const processes = ns.ps("home") || [];
                nextScripts = normalizeProcesses(processes);
            } catch (error) {}

            setScripts((prev) =>
                areProcessListsEqual(prev, nextScripts) ? prev : nextScripts,
            );

            let nextMax = 0;
            try {
                nextMax = ns.getServerMaxRam("home") || 0;
            } catch (error) {}

            let nextUsed = 0;
            try {
                nextUsed = ns.getServerUsedRam("home") || 0;
            } catch (error) {}
            const nextFree = Math.max(0, nextMax - nextUsed);

            setMaxRam((prev) => (prev === nextMax ? prev : nextMax));
            setFreeRam((prev) => (prev === nextFree ? prev : nextFree));

            timeoutId = setTimeout(poll, 2000);
        };
        poll();
        return () => clearTimeout(timeoutId);
    }, [ns]);

    const resolvedTheme = React.useMemo(
        () => ({
            ...THEME,
            background: gameTheme?.backgroundprimary || THEME.background,
            surface: gameTheme?.backgroundsecondary || THEME.surface,
            text: gameTheme?.primarylight || THEME.text,
            accent: gameTheme?.info || THEME.accent,
            green: gameTheme?.success || THEME.green,
            red: gameTheme?.error || THEME.red,
            orange: gameTheme?.warning || THEME.orange,
            border: gameTheme?.well || THEME.border,
        }),
        [gameTheme],
    );

    const content = (() => {
        switch (activeTab) {
            case "overview":
                return (
                    <OverviewTab
                        ns={ns}
                        scripts={scripts}
                        freeRam={freeRam}
                        maxRam={maxRam}
                        actionError={actionError}
                        onActionError={setActionError}
                    />
                );
            case "hacking":
                return <HackingTab ns={ns} freeRam={freeRam} />;
            case "gang":
                return <GangTab ns={ns} freeRam={freeRam} />;
            case "stocks":
                return <StocksTab ns={ns} freeRam={freeRam} />;
            case "sleeves":
                return <SleevesTab ns={ns} freeRam={freeRam} />;
            case "bladeburner":
                return <BladeburnerTab ns={ns} freeRam={freeRam} />;
            case "corp":
                return <CorpTab ns={ns} freeRam={freeRam} />;
            case "factions":
                return <FactionsTab ns={ns} freeRam={freeRam} />;
            case "infra":
                return <InfraTab ns={ns} freeRam={freeRam} />;
            default:
                return null;
        }
    })();

    return (
        <div
            style={{
                ...styles.container,
                backgroundColor: resolvedTheme.background,
                color: resolvedTheme.text,
                borderColor: resolvedTheme.border,
            }}
        >
            <div style={styles.header}>
                <div style={styles.title}>BitBurner Command Deck</div>
                <div style={styles.subtitle}>
                    Overview · Hacking · Gang · Stocks · Sleeves · Bladeburner ·
                    Corp · Factions · Infrastructure
                </div>
            </div>
            <TabBar
                tabs={TABS}
                activeTab={activeTab}
                onTabChange={setActiveTab}
            />
            <div style={styles.body}>{content}</div>
        </div>
    );
}

function TabBar({ tabs, activeTab, onTabChange }) {
    return (
        <div style={styles.tabBar}>
            {tabs.map((tab) => {
                const isActive = tab.id === activeTab;
                return (
                    <button
                        key={tab.id}
                        onClick={() => onTabChange(tab.id)}
                        type="button"
                        style={{
                            ...styles.tabButton,
                            ...(isActive ? styles.tabButtonActive : null),
                        }}
                        title={tab.label}
                    >
                        {tab.label}
                    </button>
                );
            })}
        </div>
    );
}

function OverviewTab({
    ns,
    scripts,
    freeRam,
    maxRam,
    actionError,
    onActionError,
}) {
    const usedRam = Math.max(0, maxRam - freeRam);
    const usedPercent =
        maxRam > 0 ? Math.min(100, (usedRam / maxRam) * 100) : 0;
    const [killAllConfirm, setKillAllConfirm] = React.useState(false);

    const autopilotRunning = isScriptRunning("autopilot.js", scripts);
    const daemonRunning = isScriptRunning("daemon.js", scripts);

    const scriptGroups = [
        { label: "Orchestrators", scripts: ORCHESTRATORS },
        { label: "Long-lived", scripts: LONG_LIVED },
        { label: "Periodic", scripts: PERIODIC },
        { label: "Other", scripts: OTHER },
    ];

    const handleActionError = (scriptName, error) => {
        const message = error?.message ? error.message : "Action failed";
        onActionError({ script: scriptName, message });
        setTimeout(() => {
            onActionError((prev) =>
                prev && prev.script === scriptName ? null : prev,
            );
        }, 3000);
    };

    const killAllExceptDashboard = () => {
        try {
            const allServers = scanAllServers(ns);
            for (const server of allServers) {
                if (server === "home") {
                    ns.killall("home", true);
                } else {
                    try {
                        ns.killall(server);
                    } catch (error) {
                        // Ignore errors for individual servers
                    }
                }
            }
            setKillAllConfirm(false);
        } catch (error) {
            onActionError({
                script: "kill-all",
                message: error?.message || "Failed to kill all scripts",
            });
        }
    };

    React.useEffect(() => {
        if (!killAllConfirm) return;
        const timeoutId = setTimeout(() => {
            setKillAllConfirm(false);
        }, 5000);
        return () => clearTimeout(timeoutId);
    }, [killAllConfirm]);

    return (
        <div style={styles.sectionStack}>
            <section style={styles.section}>
                <div style={styles.sectionTitle}>System Status</div>
                <div style={styles.rowBetween}>
                    <div style={styles.label}>Home RAM</div>
                    <div style={styles.mono}>
                        {usedRam.toFixed(1)}GB / {maxRam.toFixed(1)}GB
                    </div>
                </div>
                <div style={styles.ramBarTrack}>
                    <div
                        style={{
                            ...styles.ramBarFill,
                            width: `${usedPercent}%`,
                        }}
                    />
                </div>
                <div style={styles.rowBetween}>
                    <div style={styles.label}>Running scripts</div>
                    <div style={styles.mono}>{scripts.length}</div>
                </div>
            </section>

            <section style={styles.section}>
                <div style={styles.sectionTitle}>Orchestration</div>
                <div style={styles.rowBetween}>
                    <StatusPill label="Autopilot" active={autopilotRunning} />
                    <StatusPill label="Daemon" active={daemonRunning} />
                </div>
            </section>

            <section style={styles.section}>
                <div style={styles.sectionTitle}>Script List</div>
                {scriptGroups.map((group) => (
                    <div key={group.label} style={styles.groupBlock}>
                        <div style={styles.groupTitle}>{group.label}</div>
                        <div style={styles.groupList}>
                            {group.scripts.map((scriptName) => (
                                <ScriptRow
                                    key={scriptName}
                                    ns={ns}
                                    scriptName={scriptName}
                                    scripts={scripts}
                                    autopilotRunning={autopilotRunning}
                                    daemonRunning={daemonRunning}
                                    onError={handleActionError}
                                    actionError={actionError}
                                />
                            ))}
                        </div>
                    </div>
                ))}
            </section>

            <section style={styles.dangerSection}>
                <div style={styles.sectionTitle}>Danger Zone</div>
                {!killAllConfirm ? (
                    <button
                        style={styles.dangerButton}
                        onClick={() => setKillAllConfirm(true)}
                        type="button"
                        title="Kill all scripts on all servers except this dashboard"
                    >
                        ☠️ Kill All Scripts
                    </button>
                ) : (
                    <div>
                        <div style={styles.dangerConfirmText}>
                            Kill ALL scripts on ALL servers (except this
                            dashboard)?
                        </div>
                        <div style={{ display: "flex", gap: "6px" }}>
                            <button
                                style={styles.dangerButton}
                                onClick={killAllExceptDashboard}
                                type="button"
                            >
                                Confirm Kill All
                            </button>
                            <button
                                style={styles.cancelButton}
                                onClick={() => setKillAllConfirm(false)}
                                type="button"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
            </section>
        </div>
    );
}

const ScriptRow = React.memo(function ScriptRow({
    ns,
    scriptName,
    scripts,
    autopilotRunning,
    daemonRunning,
    onError,
    actionError,
}) {
    const filename = getFilePath(scriptName);
    const runningProcesses = scripts.filter(
        (process) => process.filename === filename,
    );
    const isRunning = runningProcesses.length > 0;

    const managedByAutopilot = AUTOPILOT_MANAGED.includes(scriptName);
    const managedByDaemon =
        !managedByAutopilot &&
        (DAEMON_ASYNC.includes(scriptName) ||
            DAEMON_PERIODIC.includes(scriptName));
    const managedBy = managedByAutopilot
        ? "autopilot"
        : managedByDaemon
          ? "daemon"
          : null;
    const managerRunning =
        (managedBy === "autopilot" && autopilotRunning) ||
        (managedBy === "daemon" && daemonRunning);

    const startDisabled = Boolean(managerRunning && managedBy);
    const stopWarn = Boolean(managerRunning && managedBy);

    const rowError = actionError && actionError.script === scriptName;

    const startScript = () => {
        try {
            const noTailArgs = SUPPORTS_NO_TAIL_WINDOWS.includes(scriptName)
                ? ["--no-tail-windows"]
                : SUPPORTS_NO_TAIL.includes(scriptName)
                  ? ["--no-tail"]
                  : [];
            ns.exec(
                filename,
                "home",
                { threads: 1, temporary: false },
                ...noTailArgs,
            );
        } catch (error) {
            onError(scriptName, error);
        }
    };

    const stopScript = () => {
        if (runningProcesses.length === 0) return;
        try {
            for (const process of runningProcesses) {
                ns.kill(process.pid);
            }
        } catch (error) {
            onError(scriptName, error);
        }
    };

    const restartScript = () => {
        try {
            for (const process of runningProcesses) {
                ns.kill(process.pid);
            }
            const noTailArgs = SUPPORTS_NO_TAIL_WINDOWS.includes(scriptName)
                ? ["--no-tail-windows"]
                : SUPPORTS_NO_TAIL.includes(scriptName)
                  ? ["--no-tail"]
                  : [];
            ns.exec(
                filename,
                "home",
                { threads: 1, temporary: false },
                ...noTailArgs,
            );
        } catch (error) {
            onError(scriptName, error);
        }
    };

    const openLogs = () => {
        if (runningProcesses.length === 0) return;
        try {
            for (const process of runningProcesses) {
                ns.ui.openTail(process.pid);
            }
        } catch (error) {
            onError(scriptName, error);
        }
    };

    return (
        <div style={styles.scriptRow}>
            <div style={styles.scriptInfo}>
                <span
                    style={{
                        ...styles.statusDot,
                        backgroundColor: isRunning ? THEME.green : THEME.red,
                    }}
                />
                <span style={styles.scriptName}>{scriptName}</span>
                {managedBy && (
                    <span style={styles.managedBadge}>
                        managed by {managedBy}
                    </span>
                )}
                {rowError && (
                    <span style={styles.errorBadge}>{actionError.message}</span>
                )}
            </div>
            <div style={styles.scriptActions}>
                <button
                    style={{
                        ...styles.actionButton,
                        ...(startDisabled ? styles.actionButtonDisabled : null),
                    }}
                    onClick={startScript}
                    type="button"
                    disabled={startDisabled}
                    title={
                        startDisabled
                            ? `Managed by ${managedBy}`
                            : "Start script"
                    }
                >
                    Start
                </button>
                <button
                    style={{
                        ...styles.actionButton,
                        ...(stopWarn ? styles.actionButtonWarn : null),
                    }}
                    onClick={stopScript}
                    type="button"
                    title={
                        stopWarn
                            ? `Stopping ${scriptName} may be reverted by ${managedBy}.`
                            : "Stop script"
                    }
                >
                    Stop
                </button>
                <button
                    style={styles.actionButton}
                    onClick={restartScript}
                    type="button"
                    title="Restart script"
                >
                    Restart
                </button>
                <button
                    style={{
                        ...styles.actionButton,
                        ...(isRunning ? null : styles.actionButtonDisabled),
                    }}
                    onClick={openLogs}
                    type="button"
                    disabled={!isRunning}
                    title={
                        isRunning ? "Open tail window" : "Script not running"
                    }
                >
                    Logs
                </button>
            </div>
        </div>
    );
});

function HackingTab({ ns, freeRam }) {
    const [targets, setTargets] = React.useState([]);
    const [status, setStatus] = React.useState("Waiting for daemon data...");

    React.useEffect(() => {
        let timeoutId;
        const poll = () => {
            if (freeRam < 32) {
                setStatus((prev) =>
                    prev === "Insufficient RAM for detail polling"
                        ? prev
                        : "Insufficient RAM for detail polling",
                );
                setTargets((prev) => (prev.length === 0 ? prev : []));
                timeoutId = setTimeout(poll, 3000);
                return;
            }

            let text = "";
            try {
                text = ns.read("/Temp/targets.txt") || "";
            } catch (error) {
                text = "";
            }

            const parsed = parseTargets(text);
            if (parsed.length === 0) {
                setStatus((prev) =>
                    prev === "Waiting for daemon data..."
                        ? prev
                        : "Waiting for daemon data...",
                );
                setTargets((prev) => (prev.length === 0 ? prev : []));
            } else {
                setStatus((prev) => (prev === "" ? prev : ""));
                setTargets((prev) =>
                    areTargetsEqual(prev, parsed) ? prev : parsed,
                );
            }

            timeoutId = setTimeout(poll, 3000);
        };
        poll();
        return () => clearTimeout(timeoutId);
    }, [ns, freeRam]);

    return (
        <div style={styles.sectionStack}>
            <section style={styles.section}>
                <div style={styles.sectionTitle}>Hacking Targets</div>
                <div style={styles.sectionHint}>
                    Polling every {formatDuration(3000)}
                </div>
                {status ? (
                    <div style={styles.placeholder}>{status}</div>
                ) : (
                    <div style={styles.table}>
                        <div style={styles.tableHeader}>
                            <span>Server</span>
                            <span>Money</span>
                            <span>Security</span>
                            <span>TTW</span>
                            <span>Hack</span>
                        </div>
                        {targets.map((target) => (
                            <HackingRow key={target.server} target={target} />
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}

const HackingRow = React.memo(function HackingRow({ target }) {
    return (
        <div style={styles.tableRow}>
            <span style={styles.mono}>{target.server}</span>
            <span style={styles.mono}>
                {target.moneyNow} / {target.moneyMax}
            </span>
            <span style={styles.mono}>
                {target.secNow} / {target.secMin}
            </span>
            <span style={styles.mono}>{target.ttw}</span>
            <span style={styles.mono}>{target.hack}</span>
        </div>
    );
});

function GangTab({ ns, freeRam }) {
    const [gangData, setGangData] = React.useState(null);
    const [rawData, setRawData] = React.useState("");
    const [status, setStatus] = React.useState("Waiting for gang data...");

    React.useEffect(() => {
        let timeoutId;
        const poll = () => {
            if (freeRam < 32) {
                setStatus((prev) =>
                    prev === "Insufficient RAM for detail polling"
                        ? prev
                        : "Insufficient RAM for detail polling",
                );
                setGangData((prev) => (prev === null ? prev : null));
                setRawData((prev) => (prev === "" ? prev : ""));
                timeoutId = setTimeout(poll, 3000);
                return;
            }

            let text = "";
            try {
                text = ns.read("/Temp/gang-stats.txt") || "";
            } catch (error) {
                text = "";
            }

            if (!text.trim()) {
                setStatus((prev) =>
                    prev === "Waiting for gang data..."
                        ? prev
                        : "Waiting for gang data...",
                );
                setGangData((prev) => (prev === null ? prev : null));
                setRawData((prev) => (prev === "" ? prev : ""));
            } else {
                let parsed = null;
                try {
                    parsed = JSON.parse(text);
                } catch (error) {
                    parsed = null;
                }

                if (parsed && typeof parsed === "object") {
                    setGangData((prev) =>
                        areGangDataEqual(prev, parsed) ? prev : parsed,
                    );
                    setRawData((prev) => (prev === "" ? prev : ""));
                    setStatus((prev) => (prev === "" ? prev : ""));
                } else {
                    setGangData((prev) => (prev === null ? prev : null));
                    setRawData((prev) => (prev === text ? prev : text));
                    setStatus((prev) => (prev === "" ? prev : ""));
                }
            }

            timeoutId = setTimeout(poll, 3000);
        };
        poll();
        return () => clearTimeout(timeoutId);
    }, [ns, freeRam]);

    return (
        <div style={styles.sectionStack}>
            <section style={styles.section}>
                <div style={styles.sectionTitle}>Gang Overview</div>
                <div style={styles.sectionHint}>
                    Polling every {formatDuration(3000)}
                </div>
                {status ? (
                    <div style={styles.placeholder}>{status}</div>
                ) : gangData ? (
                    <div style={styles.grid}>
                        <InfoCard
                            label="Faction"
                            value={gangData.faction || "-"}
                        />
                        <InfoCard
                            label="Respect"
                            value={formatNumberShort(gangData.respect || 0)}
                        />
                        <InfoCard
                            label="Territory"
                            value={
                                typeof gangData.territory === "number"
                                    ? `${(gangData.territory * 100).toFixed(1)}%`
                                    : "-"
                            }
                        />
                        <InfoCard
                            label="Wanted"
                            value={formatNumberShort(
                                gangData.wantedLevel || gangData.wanted || 0,
                            )}
                        />
                        <InfoCard
                            label="Members"
                            value={
                                Array.isArray(gangData.members)
                                    ? gangData.members.length
                                    : typeof gangData.memberCount === "number"
                                      ? gangData.memberCount
                                      : "-"
                            }
                        />
                    </div>
                ) : (
                    <pre style={styles.rawBlock}>{rawData}</pre>
                )}
            </section>
        </div>
    );
}

function StocksTab({ ns, freeRam }) {
    const [stocks, setStocks] = React.useState([]);
    const [status, setStatus] = React.useState("Waiting for stock data...");

    React.useEffect(() => {
        let timeoutId;
        const poll = () => {
            if (freeRam < 32) {
                setStatus((prev) =>
                    prev === "Insufficient RAM for detail polling"
                        ? prev
                        : "Insufficient RAM for detail polling",
                );
                setStocks((prev) => (prev.length === 0 ? prev : []));
                timeoutId = setTimeout(poll, 3000);
                return;
            }

            let text = "";
            try {
                text = ns.read("/Temp/stock-probabilities.txt") || "";
            } catch (error) {
                text = "";
            }

            if (!text.trim()) {
                setStatus((prev) =>
                    prev === "Waiting for stock data..."
                        ? prev
                        : "Waiting for stock data...",
                );
                setStocks((prev) => (prev.length === 0 ? prev : []));
            } else {
                let parsed = null;
                try {
                    parsed = JSON.parse(text);
                } catch (error) {
                    parsed = null;
                }

                if (parsed && typeof parsed === "object") {
                    const entries = Object.entries(parsed)
                        .map(([symbol, data]) => ({
                            symbol,
                            prob: Number.isFinite(data?.prob) ? data.prob : 0,
                            sharesLong: Number.isFinite(data?.sharesLong)
                                ? data.sharesLong
                                : 0,
                            sharesShort: Number.isFinite(data?.sharesShort)
                                ? data.sharesShort
                                : 0,
                        }))
                        .sort((a, b) => b.prob - a.prob);

                    if (entries.length === 0) {
                        setStatus((prev) =>
                            prev === "Waiting for stock data..."
                                ? prev
                                : "Waiting for stock data...",
                        );
                        setStocks((prev) => (prev.length === 0 ? prev : []));
                    } else {
                        setStatus((prev) => (prev === "" ? prev : ""));
                        setStocks((prev) =>
                            areStockDataEqual(prev, entries) ? prev : entries,
                        );
                    }
                } else {
                    setStatus((prev) =>
                        prev === "Waiting for stock data..."
                            ? prev
                            : "Waiting for stock data...",
                    );
                    setStocks((prev) => (prev.length === 0 ? prev : []));
                }
            }

            timeoutId = setTimeout(poll, 3000);
        };
        poll();
        return () => clearTimeout(timeoutId);
    }, [ns, freeRam]);

    const positionCount = stocks.filter(
        (entry) => entry.sharesLong > 0 || entry.sharesShort > 0,
    ).length;
    const totalLong = stocks.reduce((sum, entry) => sum + entry.sharesLong, 0);
    const totalShort = stocks.reduce(
        (sum, entry) => sum + entry.sharesShort,
        0,
    );

    return (
        <div style={styles.sectionStack}>
            <section style={styles.section}>
                <div style={styles.sectionTitle}>Stock Positions</div>
                <div style={styles.sectionHint}>
                    Polling every {formatDuration(3000)}
                </div>
                {status ? (
                    <div style={styles.placeholder}>{status}</div>
                ) : (
                    <div style={styles.grid}>
                        <InfoCard label="Positions" value={positionCount} />
                        <InfoCard
                            label="Total Long"
                            value={formatNumberShort(totalLong)}
                        />
                        <InfoCard
                            label="Total Short"
                            value={formatNumberShort(totalShort)}
                        />
                    </div>
                )}
            </section>
            <section style={styles.section}>
                <div style={styles.sectionTitle}>Signals</div>
                {status ? (
                    <div style={styles.placeholder}>{status}</div>
                ) : (
                    <div style={styles.table}>
                        <div style={styles.stockTableHeader}>
                            <span>Symbol</span>
                            <span>Probability</span>
                            <span>Direction</span>
                            <span>Long</span>
                            <span>Short</span>
                        </div>
                        {stocks.map((stock) => (
                            <StockRow key={stock.symbol} stock={stock} />
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}

const StockRow = React.memo(function StockRow({ stock }) {
    const isUp = stock.prob > 0.5;
    const directionSymbol = isUp ? "▲" : "▼";
    const directionStyle = isUp ? styles.directionUp : styles.directionDown;
    const probability = Number.isFinite(stock.prob)
        ? `${(stock.prob * 100).toFixed(1)}%`
        : "-";

    return (
        <div style={styles.stockTableRow}>
            <span style={styles.mono}>{stock.symbol}</span>
            <span style={styles.mono}>{probability}</span>
            <span style={{ ...styles.mono, ...directionStyle }}>
                {directionSymbol}
            </span>
            <span style={styles.mono}>
                {formatNumberShort(stock.sharesLong)}
            </span>
            <span style={styles.mono}>
                {formatNumberShort(stock.sharesShort)}
            </span>
        </div>
    );
});

function SleevesTab({ ns, freeRam }) {
    const [sleeves, setSleeves] = React.useState([]);
    const [status, setStatus] = React.useState("Waiting for sleeve data...");

    React.useEffect(() => {
        let timeoutId;
        const poll = () => {
            if (freeRam < 32) {
                setStatus((prev) =>
                    prev === "Insufficient RAM for detail polling"
                        ? prev
                        : "Insufficient RAM for detail polling",
                );
                setSleeves((prev) => (prev.length === 0 ? prev : []));
                timeoutId = setTimeout(poll, 3000);
                return;
            }

            const sleeveParsed = readJsonFile(
                ns,
                "/Temp/sleeve-getSleeve-all.txt",
            );
            const taskParsed = readJsonFile(ns, "/Temp/sleeve-getTask-all.txt");

            if (Array.isArray(sleeveParsed) && sleeveParsed.length > 0) {
                const tasks = Array.isArray(taskParsed) ? taskParsed : [];
                const entries = sleeveParsed.map((sleeve, index) => {
                    const sync = Number.isFinite(sleeve?.sync)
                        ? sleeve.sync
                        : 0;
                    const shock = Number.isFinite(sleeve?.shock)
                        ? sleeve.shock
                        : 0;
                    const city = sleeve?.city || "-";
                    const task = tasks[index] || null;
                    const taskLabel = formatSleeveTask(task);
                    const { name: topStatName, value: topStatValue } =
                        getTopSleeveStat(sleeve?.skills);
                    return {
                        index,
                        city,
                        sync,
                        shock,
                        taskLabel,
                        topStatName,
                        topStatValue,
                    };
                });

                setStatus((prev) => (prev === "" ? prev : ""));
                setSleeves((prev) =>
                    areSleeveDataEqual(prev, entries) ? prev : entries,
                );
            } else {
                setStatus((prev) =>
                    prev === "Waiting for sleeve data..."
                        ? prev
                        : "Waiting for sleeve data...",
                );
                setSleeves((prev) => (prev.length === 0 ? prev : []));
            }

            timeoutId = setTimeout(poll, 3000);
        };
        poll();
        return () => clearTimeout(timeoutId);
    }, [ns, freeRam]);

    const sleeveCount = sleeves.length;
    const avgSync =
        sleeveCount > 0
            ? sleeves.reduce((sum, sleeve) => sum + sleeve.sync, 0) /
              sleeveCount
            : 0;
    const avgShock =
        sleeveCount > 0
            ? sleeves.reduce((sum, sleeve) => sum + sleeve.shock, 0) /
              sleeveCount
            : 0;

    return (
        <div style={styles.sectionStack}>
            <section style={styles.section}>
                <div style={styles.sectionTitle}>Sleeves</div>
                <div style={styles.sectionHint}>
                    Polling every {formatDuration(3000)}
                </div>
                {status ? (
                    <div style={styles.placeholder}>{status}</div>
                ) : (
                    <div style={styles.grid}>
                        <InfoCard label="Sleeves" value={sleeveCount} />
                        <InfoCard
                            label="Average Sync"
                            value={`${avgSync.toFixed(1)}%`}
                        />
                        <InfoCard
                            label="Average Shock"
                            value={`${avgShock.toFixed(1)}%`}
                        />
                    </div>
                )}
            </section>
            <section style={styles.section}>
                <div style={styles.sectionTitle}>Assignments</div>
                {status ? (
                    <div style={styles.placeholder}>{status}</div>
                ) : (
                    <div style={styles.table}>
                        <div style={styles.sleeveHeader}>
                            <span>#</span>
                            <span>City</span>
                            <span>Sync</span>
                            <span>Shock</span>
                            <span>Task</span>
                            <span>Top Stat</span>
                        </div>
                        {sleeves.map((sleeve) => (
                            <SleeveRow key={sleeve.index} sleeve={sleeve} />
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}

const SleeveRow = React.memo(function SleeveRow({ sleeve }) {
    const syncStyle =
        sleeve.sync > 90 ? styles.sleeveMetricGood : styles.sleeveMetricNeutral;
    const shockStyle =
        sleeve.shock > 0 ? styles.sleeveMetricWarn : styles.sleeveMetricNeutral;
    const topStat = sleeve.topStatName
        ? `${sleeve.topStatName} ${formatNumberShort(sleeve.topStatValue)}`
        : "-";

    return (
        <div style={styles.sleeveRow}>
            <span style={styles.mono}>{sleeve.index + 1}</span>
            <span style={styles.mono}>{sleeve.city}</span>
            <span style={{ ...styles.mono, ...syncStyle }}>
                {sleeve.sync.toFixed(1)}%
            </span>
            <span style={{ ...styles.mono, ...shockStyle }}>
                {sleeve.shock.toFixed(1)}%
            </span>
            <span style={styles.mono}>{sleeve.taskLabel}</span>
            <span style={styles.mono}>{topStat}</span>
        </div>
    );
});

function BladeburnerTab({ ns, freeRam }) {
    const [bladeData, setBladeData] = React.useState(null);
    const [status, setStatus] = React.useState(
        "Waiting for bladeburner data...",
    );

    React.useEffect(() => {
        let timeoutId;
        const poll = () => {
            if (freeRam < 32) {
                setStatus((prev) =>
                    prev === "Insufficient RAM for detail polling"
                        ? prev
                        : "Insufficient RAM for detail polling",
                );
                setBladeData((prev) => (prev === null ? prev : null));
                timeoutId = setTimeout(poll, 3000);
                return;
            }

            const nextData = {
                action: null,
                rank: null,
                stamina: null,
                skillPoints: null,
                actions: [],
            };

            nextData.action = readJsonFile(
                ns,
                "/Temp/ns-bladeburner-getCurrentAction.txt",
            );
            nextData.rank = readJsonFile(
                ns,
                "/Temp/ns-bladeburner-getRank.txt",
            );
            nextData.stamina = readJsonFile(
                ns,
                "/Temp/ns-bladeburner-getStamina.txt",
            );
            nextData.skillPoints = readJsonFile(
                ns,
                "/Temp/ns-bladeburner-getSkillPoints.txt",
            );

            const actionCounts = readJsonFile(
                ns,
                "/Temp/bladeburner-getActionCountRemaining-all.txt",
            );
            const actionChances = readJsonFile(
                ns,
                "/Temp/bladeburner-getActionEstimatedSuccessChance-all.txt",
            );

            const actionNames = new Set([
                ...Object.keys(actionCounts || {}),
                ...Object.keys(actionChances || {}),
            ]);

            if (actionNames.size > 0) {
                nextData.actions = [...actionNames]
                    .map((name) => ({
                        name,
                        remaining: Number.isFinite(actionCounts?.[name])
                            ? actionCounts[name]
                            : null,
                        chance: Array.isArray(actionChances?.[name])
                            ? actionChances[name]
                            : null,
                    }))
                    .sort((a, b) => a.name.localeCompare(b.name));
            }

            const hasAnyData = Boolean(
                nextData.action ||
                    Number.isFinite(nextData.rank) ||
                    Number.isFinite(nextData.skillPoints) ||
                    (Array.isArray(nextData.stamina) &&
                        nextData.stamina.length === 2) ||
                    nextData.actions.length > 0,
            );

            if (!hasAnyData) {
                setStatus((prev) =>
                    prev === "Waiting for bladeburner data..."
                        ? prev
                        : "Waiting for bladeburner data...",
                );
                setBladeData((prev) => (prev === null ? prev : null));
            } else {
                setStatus((prev) => (prev === "" ? prev : ""));
                setBladeData((prev) =>
                    areBladeburnerDataEqual(prev, nextData) ? prev : nextData,
                );
            }

            timeoutId = setTimeout(poll, 3000);
        };
        poll();
        return () => clearTimeout(timeoutId);
    }, [ns, freeRam]);

    const currentAction = bladeData?.action
        ? `${bladeData.action.type || "Action"}: ${bladeData.action.name || "-"}`
        : "-";
    const stamina = formatStamina(bladeData?.stamina);

    return (
        <div style={styles.sectionStack}>
            <section style={styles.section}>
                <div style={styles.sectionTitle}>Bladeburner Status</div>
                <div style={styles.sectionHint}>
                    Polling every {formatDuration(3000)}
                </div>
                {status ? (
                    <div style={styles.placeholder}>{status}</div>
                ) : (
                    <div style={styles.grid}>
                        <InfoCard
                            label="Current Action"
                            value={currentAction}
                        />
                        <InfoCard
                            label="Rank"
                            value={formatNumberShort(bladeData?.rank || 0)}
                        />
                        <InfoCard label="Stamina" value={stamina} />
                        <InfoCard
                            label="Skill Points"
                            value={formatNumberShort(
                                bladeData?.skillPoints || 0,
                            )}
                        />
                    </div>
                )}
            </section>
            <section style={styles.section}>
                <div style={styles.sectionTitle}>Actions</div>
                {status ? (
                    <div style={styles.placeholder}>{status}</div>
                ) : bladeData?.actions?.length ? (
                    <div style={styles.table}>
                        <div style={styles.bladeTableHeader}>
                            <span>Action</span>
                            <span>Remaining</span>
                            <span>Success Chance</span>
                        </div>
                        {bladeData.actions.map((action) => (
                            <BladeburnerRow key={action.name} action={action} />
                        ))}
                    </div>
                ) : (
                    <div style={styles.placeholder}>No action data found.</div>
                )}
            </section>
        </div>
    );
}

const BladeburnerRow = React.memo(function BladeburnerRow({ action }) {
    const remaining = Number.isFinite(action.remaining)
        ? action.remaining
        : "-";
    const chance = Array.isArray(action.chance)
        ? `${(action.chance[0] * 100).toFixed(1)}% - ${(action.chance[1] * 100).toFixed(1)}%`
        : "-";

    return (
        <div style={styles.bladeTableRow}>
            <span style={styles.mono}>{action.name}</span>
            <span style={styles.mono}>{remaining}</span>
            <span style={styles.mono}>{chance}</span>
        </div>
    );
});

function CorpTab({ ns, freeRam }) {
    const [corpData, setCorpData] = React.useState(null);
    const [status, setStatus] = React.useState(
        "Waiting for corporation data... (Run stats.js or corporation.js)",
    );

    React.useEffect(() => {
        let timeoutId;
        const poll = () => {
            if (freeRam < 32) {
                setStatus((prev) =>
                    prev === "Insufficient RAM for detail polling"
                        ? prev
                        : "Insufficient RAM for detail polling",
                );
                setCorpData((prev) => (prev === null ? prev : null));
                timeoutId = setTimeout(poll, 3000);
                return;
            }

            const parsed = readJsonFile(
                ns,
                "/Temp/ns-corporation-getCorporation.txt",
            );

            if (parsed && typeof parsed === "object") {
                setStatus((prev) => (prev === "" ? prev : ""));
                setCorpData((prev) =>
                    areCorpDataEqual(prev, parsed) ? prev : parsed,
                );
            } else {
                setStatus((prev) =>
                    prev ===
                    "Waiting for corporation data... (Run stats.js or corporation.js)"
                        ? prev
                        : "Waiting for corporation data... (Run stats.js or corporation.js)",
                );
                setCorpData((prev) => (prev === null ? prev : null));
            }

            timeoutId = setTimeout(poll, 3000);
        };
        poll();
        return () => clearTimeout(timeoutId);
    }, [ns, freeRam]);

    const revenue = Number.isFinite(corpData?.revenue) ? corpData.revenue : 0;
    const expenses = Number.isFinite(corpData?.expenses)
        ? corpData.expenses
        : 0;
    const profit = revenue - expenses;
    const divisions = Array.isArray(corpData?.divisions)
        ? corpData.divisions
              .map((division) => division?.name || division)
              .filter(Boolean)
        : [];

    return (
        <div style={styles.sectionStack}>
            <section style={styles.section}>
                <div style={styles.sectionTitle}>Corporation</div>
                <div style={styles.sectionHint}>
                    Polling every {formatDuration(3000)}
                </div>
                {status ? (
                    <div style={styles.placeholder}>{status}</div>
                ) : (
                    <div style={styles.grid}>
                        <InfoCard
                            label="Funds"
                            value={formatMoney(corpData?.funds || 0)}
                        />
                        <InfoCard
                            label="Revenue/s"
                            value={formatMoney(revenue)}
                        />
                        <InfoCard
                            label="Expenses/s"
                            value={formatMoney(expenses)}
                        />
                        <InfoCard
                            label="Profit/s"
                            value={formatMoney(profit)}
                        />
                        <InfoCard label="Divisions" value={divisions.length} />
                        <InfoCard
                            label="Shares"
                            value={formatNumberShort(corpData?.numShares || 0)}
                        />
                    </div>
                )}
            </section>
            <section style={styles.section}>
                <div style={styles.sectionTitle}>Divisions</div>
                {status ? (
                    <div style={styles.placeholder}>{status}</div>
                ) : divisions.length ? (
                    <div style={styles.badgeRow}>
                        {divisions.map((name) => (
                            <span key={name} style={styles.divisionBadge}>
                                {name}
                            </span>
                        ))}
                    </div>
                ) : (
                    <div style={styles.placeholder}>No divisions reported.</div>
                )}
            </section>
        </div>
    );
}

function FactionsTab({ ns, freeRam }) {
    const [factionData, setFactionData] = React.useState(null);
    const [status, setStatus] = React.useState("Waiting for faction data...");

    React.useEffect(() => {
        let timeoutId;
        const poll = () => {
            if (freeRam < 32) {
                setStatus((prev) =>
                    prev === "Insufficient RAM for detail polling"
                        ? prev
                        : "Insufficient RAM for detail polling",
                );
                setFactionData((prev) => (prev === null ? prev : null));
                timeoutId = setTimeout(poll, 5000);
                return;
            }

            const nextData = {
                currentWork: null,
                augSummary: null,
                factions: [],
            };

            // Current work
            nextData.currentWork = readJsonFile(
                ns,
                "/Temp/ns-singularity-getCurrentWork.txt",
            );

            // Augmentation summary (plain JSON, no wrapper)
            let augText = "";
            try {
                augText = ns.read("/Temp/affordable-augs.txt") || "";
            } catch (error) {
                augText = "";
            }
            if (augText.trim()) {
                try {
                    nextData.augSummary = JSON.parse(augText);
                } catch (error) {
                    nextData.augSummary = null;
                }
            }

            // Faction rep & favor
            const repMap = readJsonFile(
                ns,
                "/Temp/singularity-getFactionRep-all.txt",
            );
            const favorMap =
                readJsonFile(ns, "/Temp/singularity-getFactionFavor-all.txt") ||
                readJsonFile(ns, "/Temp/getFactionFavors.txt");

            if (repMap && typeof repMap === "object") {
                nextData.factions = Object.entries(repMap)
                    .map(([name, rep]) => ({
                        name,
                        rep: Number.isFinite(rep) ? rep : 0,
                        favor: Number.isFinite(favorMap?.[name])
                            ? favorMap[name]
                            : 0,
                    }))
                    .sort((a, b) => b.rep - a.rep);
            }

            const hasAnyData = Boolean(
                nextData.currentWork ||
                    nextData.augSummary ||
                    nextData.factions.length > 0,
            );

            if (!hasAnyData) {
                setStatus((prev) =>
                    prev === "Waiting for faction data..."
                        ? prev
                        : "Waiting for faction data...",
                );
                setFactionData((prev) => (prev === null ? prev : null));
            } else {
                setStatus((prev) => (prev === "" ? prev : ""));
                setFactionData((prev) =>
                    areFactionDataEqual(prev, nextData) ? prev : nextData,
                );
            }

            timeoutId = setTimeout(poll, 5000);
        };
        poll();
        return () => clearTimeout(timeoutId);
    }, [ns, freeRam]);

    const work = factionData?.currentWork;
    const workLabel = work
        ? work.type === "FACTION"
            ? `Faction: ${work.factionName || "-"}`
            : work.type === "COMPANY"
              ? `Company: ${work.companyName || "-"}`
              : work.type === "CRIME"
                ? `Crime: ${work.crimeType || "-"}`
                : work.type === "CLASS"
                  ? `Class: ${work.classType || "-"} (${work.location || "-"})`
                  : work.type || "Working"
        : "Idle";

    const aug = factionData?.augSummary;

    return (
        <div style={styles.sectionStack}>
            <section style={styles.section}>
                <div style={styles.sectionTitle}>Current Work</div>
                <div style={styles.sectionHint}>
                    Polling every {formatDuration(5000)}
                </div>
                {status ? (
                    <div style={styles.placeholder}>{status}</div>
                ) : (
                    <div style={styles.grid}>
                        <InfoCard label="Activity" value={workLabel} />
                    </div>
                )}
            </section>
            <section style={styles.section}>
                <div style={styles.sectionTitle}>Augmentations</div>
                {status ? (
                    <div style={styles.placeholder}>{status}</div>
                ) : aug ? (
                    <div style={styles.grid}>
                        <InfoCard
                            label="Installed"
                            value={aug.installed_count ?? "-"}
                        />
                        <InfoCard
                            label="Purchased"
                            value={aug.purchased_count ?? "-"}
                        />
                        <InfoCard
                            label="Affordable"
                            value={aug.affordable_count ?? "-"}
                        />
                        <InfoCard
                            label="Unpurchased"
                            value={aug.unpurchased_count ?? "-"}
                        />
                        <InfoCard
                            label="Rep Cost"
                            value={formatMoney(aug.total_rep_cost || 0)}
                        />
                        <InfoCard
                            label="Aug Cost"
                            value={formatMoney(aug.total_aug_cost || 0)}
                        />
                    </div>
                ) : (
                    <div style={styles.placeholder}>
                        No augmentation data. Run faction-manager.js.
                    </div>
                )}
            </section>
            <section style={styles.section}>
                <div style={styles.sectionTitle}>Faction Reputation</div>
                {status ? (
                    <div style={styles.placeholder}>{status}</div>
                ) : factionData?.factions?.length ? (
                    <div style={styles.table}>
                        <div style={styles.factionTableHeader}>
                            <span>Faction</span>
                            <span>Reputation</span>
                            <span>Favor</span>
                        </div>
                        {factionData.factions.map((faction) => (
                            <FactionRow key={faction.name} faction={faction} />
                        ))}
                    </div>
                ) : (
                    <div style={styles.placeholder}>
                        No faction data. Run work-for-factions.js or
                        faction-manager.js.
                    </div>
                )}
            </section>
        </div>
    );
}

const FactionRow = React.memo(function FactionRow({ faction }) {
    return (
        <div style={styles.factionTableRow}>
            <span style={styles.mono}>{faction.name}</span>
            <span style={styles.mono}>{formatNumberShort(faction.rep)}</span>
            <span style={styles.mono}>{formatNumberShort(faction.favor)}</span>
        </div>
    );
});

function InfraTab({ ns, freeRam }) {
    const [infraData, setInfraData] = React.useState(null);
    const [status, setStatus] = React.useState(
        "Waiting for infrastructure data...",
    );

    React.useEffect(() => {
        let timeoutId;
        const poll = () => {
            if (freeRam < 32) {
                setStatus((prev) =>
                    prev === "Insufficient RAM for detail polling"
                        ? prev
                        : "Insufficient RAM for detail polling",
                );
                setInfraData((prev) => (prev === null ? prev : null));
                timeoutId = setTimeout(poll, 5000);
                return;
            }

            const allServers = scanAllServers(ns);
            const nextData = {
                homeMaxRam: 0,
                homeUsedRam: 0,
                totalServers: allServers.length,
                totalMaxRam: 0,
                totalUsedRam: 0,
                rootedCount: 0,
                purchasedServers: [],
                targets: [],
            };

            // Compute per-server stats
            for (const host of allServers) {
                let maxRam = 0;
                let usedRam = 0;
                try {
                    maxRam = ns.getServerMaxRam(host) || 0;
                } catch (error) {
                    maxRam = 0;
                }
                try {
                    usedRam = ns.getServerUsedRam(host) || 0;
                } catch (error) {
                    usedRam = 0;
                }

                nextData.totalMaxRam += maxRam;
                nextData.totalUsedRam += usedRam;

                if (host === "home") {
                    nextData.homeMaxRam = maxRam;
                    nextData.homeUsedRam = usedRam;
                } else if (
                    host.startsWith("pserv-") ||
                    host.startsWith("daemon")
                ) {
                    nextData.purchasedServers.push({
                        name: host,
                        maxRam,
                        usedRam,
                    });
                }

                if (maxRam > 0) {
                    nextData.rootedCount += 1;
                }
            }

            nextData.purchasedServers.sort((a, b) => b.maxRam - a.maxRam);

            // Parse hacking targets
            let targetsText = "";
            try {
                targetsText = ns.read("/Temp/targets.txt") || "";
            } catch (error) {
                targetsText = "";
            }
            nextData.targets = parseTargets(targetsText).slice(0, 10);

            setStatus((prev) => (prev === "" ? prev : ""));
            setInfraData((prev) =>
                areInfraDataEqual(prev, nextData) ? prev : nextData,
            );

            timeoutId = setTimeout(poll, 5000);
        };
        poll();
        return () => clearTimeout(timeoutId);
    }, [ns, freeRam]);

    const homePercent =
        infraData && infraData.homeMaxRam > 0
            ? Math.min(
                  100,
                  (infraData.homeUsedRam / infraData.homeMaxRam) * 100,
              )
            : 0;
    const totalPercent =
        infraData && infraData.totalMaxRam > 0
            ? Math.min(
                  100,
                  (infraData.totalUsedRam / infraData.totalMaxRam) * 100,
              )
            : 0;

    return (
        <div style={styles.sectionStack}>
            <section style={styles.section}>
                <div style={styles.sectionTitle}>Network Overview</div>
                <div style={styles.sectionHint}>
                    Polling every {formatDuration(5000)}
                </div>
                {status ? (
                    <div style={styles.placeholder}>{status}</div>
                ) : (
                    <div>
                        <div style={styles.grid}>
                            <InfoCard
                                label="Total Servers"
                                value={infraData?.totalServers ?? 0}
                            />
                            <InfoCard
                                label="Rooted"
                                value={infraData?.rootedCount ?? 0}
                            />
                            <InfoCard
                                label="Purchased"
                                value={infraData?.purchasedServers?.length ?? 0}
                            />
                        </div>
                        <div style={{ marginTop: "10px" }}>
                            <div style={styles.rowBetween}>
                                <div style={styles.label}>Home RAM</div>
                                <div style={styles.mono}>
                                    {(infraData?.homeUsedRam || 0).toFixed(1)}GB
                                    / {(infraData?.homeMaxRam || 0).toFixed(1)}
                                    GB
                                </div>
                            </div>
                            <div style={styles.ramBarTrack}>
                                <div
                                    style={{
                                        ...styles.ramBarFill,
                                        width: `${homePercent}%`,
                                    }}
                                />
                            </div>
                            <div style={styles.rowBetween}>
                                <div style={styles.label}>Network RAM</div>
                                <div style={styles.mono}>
                                    {formatNumberShort(
                                        infraData?.totalUsedRam || 0,
                                    )}
                                    GB /{" "}
                                    {formatNumberShort(
                                        infraData?.totalMaxRam || 0,
                                    )}
                                    GB
                                </div>
                            </div>
                            <div style={styles.ramBarTrack}>
                                <div
                                    style={{
                                        ...styles.ramBarFill,
                                        width: `${totalPercent}%`,
                                    }}
                                />
                            </div>
                        </div>
                    </div>
                )}
            </section>
            {!status && infraData?.purchasedServers?.length > 0 && (
                <section style={styles.section}>
                    <div style={styles.sectionTitle}>Purchased Servers</div>
                    <div style={styles.table}>
                        <div style={styles.infraServerHeader}>
                            <span>Server</span>
                            <span>RAM</span>
                            <span>Usage</span>
                        </div>
                        {infraData.purchasedServers.map((server) => {
                            const pct =
                                server.maxRam > 0
                                    ? `${((server.usedRam / server.maxRam) * 100).toFixed(0)}%`
                                    : "0%";
                            return (
                                <div
                                    key={server.name}
                                    style={styles.infraServerRow}
                                >
                                    <span style={styles.mono}>
                                        {server.name}
                                    </span>
                                    <span style={styles.mono}>
                                        {formatNumberShort(server.maxRam)}GB
                                    </span>
                                    <span style={styles.mono}>{pct}</span>
                                </div>
                            );
                        })}
                    </div>
                </section>
            )}
            {!status && infraData?.targets?.length > 0 && (
                <section style={styles.section}>
                    <div style={styles.sectionTitle}>Top Hacking Targets</div>
                    <div style={styles.table}>
                        <div style={styles.tableHeader}>
                            <span>Server</span>
                            <span>Money</span>
                            <span>Security</span>
                            <span>TTW</span>
                            <span>Hack</span>
                        </div>
                        {infraData.targets.map((target) => (
                            <HackingRow key={target.server} target={target} />
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}

function StatusPill({ label, active }) {
    return (
        <div style={styles.statusPill}>
            <span
                style={{
                    ...styles.statusDot,
                    backgroundColor: active ? THEME.green : THEME.red,
                }}
            />
            <span style={styles.mono}>{label}</span>
        </div>
    );
}

function InfoCard({ label, value }) {
    return (
        <div style={styles.infoCard}>
            <div style={styles.infoLabel}>{label}</div>
            <div style={styles.infoValue}>{value}</div>
        </div>
    );
}

function normalizeProcesses(processes) {
    return processes
        .map((process) => ({
            filename: process.filename,
            pid: process.pid,
            threads: process.threads,
            args: process.args,
        }))
        .sort((a, b) => {
            if (a.filename !== b.filename)
                return a.filename.localeCompare(b.filename);
            return a.pid - b.pid;
        });
}

function areProcessListsEqual(a, b) {
    if (a === b) return true;
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
        if (
            a[i].filename !== b[i].filename ||
            a[i].pid !== b[i].pid ||
            a[i].threads !== b[i].threads ||
            a[i].args?.length !== b[i].args?.length
        ) {
            return false;
        }
    }
    return true;
}

function isScriptRunning(scriptName, processes) {
    const filename = getFilePath(scriptName);
    return processes.some((process) => process.filename === filename);
}

function parseTargets(text) {
    if (!text || !text.trim()) return [];
    return text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            const server = line.split(" - ").pop()?.trim() || "?";
            const moneyMatch = line.match(/Money:\s*([^\s]+)\s+of\s+([^\s]+)/i);
            const secMatch = line.match(/Sec:\s*([0-9.]+)\s+of\s+([0-9.]+)/i);
            const ttwMatch = line.match(/TTW:\s*([^,]+)/i);
            const hackMatch = line.match(/Hack:\s*([0-9]+)/i);
            const moneyNowRaw = moneyMatch ? moneyMatch[1] : "-";
            const moneyMaxRaw = moneyMatch ? moneyMatch[2] : "-";
            const moneyNowValue = parseShortNumber(moneyNowRaw);
            const moneyMaxValue = parseShortNumber(moneyMaxRaw);
            return {
                server,
                moneyNow: Number.isFinite(moneyNowValue)
                    ? formatMoney(moneyNowValue)
                    : moneyNowRaw,
                moneyMax: Number.isFinite(moneyMaxValue)
                    ? formatMoney(moneyMaxValue)
                    : moneyMaxRaw,
                secNow: secMatch ? secMatch[1] : "-",
                secMin: secMatch ? secMatch[2] : "-",
                ttw: ttwMatch ? ttwMatch[1].trim() : "-",
                hack: hackMatch ? hackMatch[1] : "-",
            };
        });
}

function parseShortNumber(text) {
    if (!text || typeof text !== "string") return Number.NaN;
    const cleaned = text.replace(/[$,]/g, "").trim();
    const match = cleaned.match(/^(-?\d+(?:\.\d+)?)([kmbtq])?$/i);
    if (!match) return Number.NaN;
    const value = Number.parseFloat(match[1]);
    const suffix = match[2]?.toLowerCase();
    const multipliers = {
        k: 1e3,
        m: 1e6,
        b: 1e9,
        t: 1e12,
        q: 1e15,
    };
    return suffix ? value * multipliers[suffix] : value;
}

function areTargetsEqual(a, b) {
    if (a === b) return true;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
        if (
            a[i].server !== b[i].server ||
            a[i].moneyNow !== b[i].moneyNow ||
            a[i].moneyMax !== b[i].moneyMax ||
            a[i].secNow !== b[i].secNow ||
            a[i].secMin !== b[i].secMin ||
            a[i].ttw !== b[i].ttw ||
            a[i].hack !== b[i].hack
        ) {
            return false;
        }
    }
    return true;
}

function areGangDataEqual(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    return (
        a.faction === b.faction &&
        a.respect === b.respect &&
        a.territory === b.territory &&
        (a.wantedLevel || a.wanted) === (b.wantedLevel || b.wanted) &&
        ((Array.isArray(a.members) ? a.members.length : a.memberCount) || 0) ===
            ((Array.isArray(b.members) ? b.members.length : b.memberCount) || 0)
    );
}

function areStockDataEqual(a, b) {
    if (a === b) return true;
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
        if (
            a[i].symbol !== b[i].symbol ||
            a[i].prob !== b[i].prob ||
            a[i].sharesLong !== b[i].sharesLong ||
            a[i].sharesShort !== b[i].sharesShort
        ) {
            return false;
        }
    }
    return true;
}

function areSleeveDataEqual(a, b) {
    if (a === b) return true;
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
        if (
            a[i].index !== b[i].index ||
            a[i].city !== b[i].city ||
            a[i].sync !== b[i].sync ||
            a[i].shock !== b[i].shock ||
            a[i].taskLabel !== b[i].taskLabel ||
            a[i].topStatName !== b[i].topStatName ||
            a[i].topStatValue !== b[i].topStatValue
        ) {
            return false;
        }
    }
    return true;
}

function areBladeburnerDataEqual(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    if (
        a.action?.type !== b.action?.type ||
        a.action?.name !== b.action?.name ||
        a.rank !== b.rank ||
        a.skillPoints !== b.skillPoints
    ) {
        return false;
    }

    const aStamina = Array.isArray(a.stamina) ? a.stamina : [];
    const bStamina = Array.isArray(b.stamina) ? b.stamina : [];
    if (aStamina.length !== bStamina.length) return false;
    for (let i = 0; i < aStamina.length; i += 1) {
        if (aStamina[i] !== bStamina[i]) return false;
    }

    const aActions = Array.isArray(a.actions) ? a.actions : [];
    const bActions = Array.isArray(b.actions) ? b.actions : [];
    if (aActions.length !== bActions.length) return false;
    for (let i = 0; i < aActions.length; i += 1) {
        const aAction = aActions[i];
        const bAction = bActions[i];
        if (
            aAction.name !== bAction.name ||
            aAction.remaining !== bAction.remaining ||
            aAction.chance?.[0] !== bAction.chance?.[0] ||
            aAction.chance?.[1] !== bAction.chance?.[1]
        ) {
            return false;
        }
    }
    return true;
}

function areCorpDataEqual(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    if (
        a.funds !== b.funds ||
        a.revenue !== b.revenue ||
        a.expenses !== b.expenses ||
        a.numShares !== b.numShares
    ) {
        return false;
    }

    const aDivisions = Array.isArray(a.divisions)
        ? a.divisions
              .map((division) => division?.name || division)
              .filter(Boolean)
        : [];
    const bDivisions = Array.isArray(b.divisions)
        ? b.divisions
              .map((division) => division?.name || division)
              .filter(Boolean)
        : [];
    if (aDivisions.length !== bDivisions.length) return false;
    for (let i = 0; i < aDivisions.length; i += 1) {
        if (aDivisions[i] !== bDivisions[i]) return false;
    }
    return true;
}

function areFactionDataEqual(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    // Compare current work
    const aWork = a.currentWork;
    const bWork = b.currentWork;
    if (!aWork !== !bWork) return false;
    if (aWork && bWork) {
        if (
            aWork.type !== bWork.type ||
            aWork.factionName !== bWork.factionName ||
            aWork.companyName !== bWork.companyName ||
            aWork.crimeType !== bWork.crimeType ||
            aWork.classType !== bWork.classType
        ) {
            return false;
        }
    }
    // Compare aug summary
    const aAug = a.augSummary;
    const bAug = b.augSummary;
    if (!aAug !== !bAug) return false;
    if (aAug && bAug) {
        if (
            aAug.installed_count !== bAug.installed_count ||
            aAug.purchased_count !== bAug.purchased_count ||
            aAug.affordable_count !== bAug.affordable_count ||
            aAug.unpurchased_count !== bAug.unpurchased_count ||
            aAug.total_rep_cost !== bAug.total_rep_cost ||
            aAug.total_aug_cost !== bAug.total_aug_cost
        ) {
            return false;
        }
    }
    // Compare factions
    const aFactions = a.factions || [];
    const bFactions = b.factions || [];
    if (aFactions.length !== bFactions.length) return false;
    for (let i = 0; i < aFactions.length; i += 1) {
        if (
            aFactions[i].name !== bFactions[i].name ||
            aFactions[i].rep !== bFactions[i].rep ||
            aFactions[i].favor !== bFactions[i].favor
        ) {
            return false;
        }
    }
    return true;
}

function areInfraDataEqual(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    if (
        a.homeMaxRam !== b.homeMaxRam ||
        a.homeUsedRam !== b.homeUsedRam ||
        a.totalServers !== b.totalServers ||
        a.totalMaxRam !== b.totalMaxRam ||
        a.totalUsedRam !== b.totalUsedRam ||
        a.rootedCount !== b.rootedCount
    ) {
        return false;
    }
    const aPserv = a.purchasedServers || [];
    const bPserv = b.purchasedServers || [];
    if (aPserv.length !== bPserv.length) return false;
    for (let i = 0; i < aPserv.length; i += 1) {
        if (
            aPserv[i].name !== bPserv[i].name ||
            aPserv[i].maxRam !== bPserv[i].maxRam ||
            aPserv[i].usedRam !== bPserv[i].usedRam
        ) {
            return false;
        }
    }
    const aTargets = a.targets || [];
    const bTargets = b.targets || [];
    if (aTargets.length !== bTargets.length) return false;
    for (let i = 0; i < aTargets.length; i += 1) {
        if (
            aTargets[i].server !== bTargets[i].server ||
            aTargets[i].moneyNow !== bTargets[i].moneyNow ||
            aTargets[i].secNow !== bTargets[i].secNow
        ) {
            return false;
        }
    }
    return true;
}

function formatSleeveTask(task) {
    if (!task || !task.type) return "Idle";
    const detail = task.factionName || task.companyName;
    return detail ? `${task.type} (${detail})` : task.type;
}

function getTopSleeveStat(skills) {
    if (!skills || typeof skills !== "object") {
        return { name: "", value: 0 };
    }
    let topName = "";
    let topValue = -Infinity;
    for (const [name, value] of Object.entries(skills)) {
        if (Number.isFinite(value) && value > topValue) {
            topValue = value;
            topName = name;
        }
    }
    const label = topName
        ? `${topName.charAt(0).toUpperCase()}${topName.slice(1)}`
        : "";
    return { name: label, value: Number.isFinite(topValue) ? topValue : 0 };
}

/**
 * Reads and parses a JSON file, unwrapping the getNsDataThroughFile wrapper format.
 * Files written by getNsDataThroughFile contain: {"$type":"result","$value":<data>}
 * with special handling for undefined, null, Infinity, NaN, BigInt, Map, and Set.
 */
function readJsonFile(ns, filePath) {
    let text = "";
    try {
        text = ns.read(filePath) || "";
    } catch (error) {
        text = "";
    }
    if (!text.trim()) return null;
    try {
        const parsed = JSON.parse(text);
        return unwrapNsData(parsed);
    } catch (error) {
        return null;
    }
}

/** Recursively unwraps the getNsDataThroughFile serialization format. */
function unwrapNsData(value) {
    if (value === null || value === undefined) return value;
    if (typeof value !== "object") return value;
    // Handle the $type wrapper objects from helpers.js jsonReplacer/jsonReviver
    if (value.$type !== undefined) {
        switch (value.$type) {
            case "result":
                return unwrapNsData(value.$value);
            case "undefined":
                return undefined;
            case "null":
                return null;
            case "number":
                if (value.$value === "Infinity") return Infinity;
                if (value.$value === "-Infinity") return -Infinity;
                if (value.$value === "NaN") return NaN;
                return Number(value.$value);
            case "bigint":
                return value.$value; // Keep as string — dashboard doesn't need BigInt
            case "Map":
                return new Map(
                    Array.isArray(value.$value)
                        ? value.$value.map(([k, v]) => [
                              unwrapNsData(k),
                              unwrapNsData(v),
                          ])
                        : [],
                );
            case "Set":
                return new Set(
                    Array.isArray(value.$value)
                        ? value.$value.map((v) => unwrapNsData(v))
                        : [],
                );
            default:
                // Unknown $type — return the $value if present, otherwise the whole object
                return value.$value !== undefined
                    ? unwrapNsData(value.$value)
                    : value;
        }
    }
    // Recursively unwrap arrays
    if (Array.isArray(value)) {
        return value.map((v) => unwrapNsData(v));
    }
    // Recursively unwrap plain objects
    const result = {};
    for (const key of Object.keys(value)) {
        result[key] = unwrapNsData(value[key]);
    }
    return result;
}

function formatStamina(stamina) {
    if (!Array.isArray(stamina) || stamina.length !== 2) return "-";
    const [current, max] = stamina;
    if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0)
        return "-";
    const percent = Math.min(100, (current / max) * 100);
    return `${formatNumberShort(current)} / ${formatNumberShort(max)} (${percent.toFixed(1)}%)`;
}

const styles = {
    container: {
        backgroundColor: THEME.background,
        color: THEME.text,
        padding: "12px",
        fontFamily: '"DM Mono", "Fira Code", "Source Code Pro", monospace',
        border: `1px solid ${THEME.border}`,
        borderRadius: "8px",
    },
    header: {
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        marginBottom: "10px",
    },
    title: {
        fontSize: "16px",
        fontWeight: 700,
        letterSpacing: "0.5px",
    },
    subtitle: {
        fontSize: "11px",
        color: "#9aa4bf",
    },
    tabBar: {
        display: "flex",
        flexWrap: "wrap",
        gap: "6px",
        marginBottom: "10px",
    },
    tabButton: {
        backgroundColor: THEME.surface,
        color: THEME.text,
        border: `1px solid ${THEME.border}`,
        borderRadius: "6px",
        padding: "6px 10px",
        fontSize: "12px",
        cursor: "pointer",
        transition: "all 120ms ease",
    },
    tabButtonActive: {
        backgroundColor: THEME.accent,
        borderColor: "#3a4b72",
        boxShadow: `0 0 8px ${THEME.accent}`,
    },
    body: {
        display: "flex",
        flexDirection: "column",
        gap: "10px",
    },
    sectionStack: {
        display: "flex",
        flexDirection: "column",
        gap: "10px",
    },
    section: {
        backgroundColor: THEME.surface,
        border: `1px solid ${THEME.border}`,
        borderRadius: "8px",
        padding: "10px",
    },
    sectionTitle: {
        fontSize: "13px",
        fontWeight: 600,
        marginBottom: "8px",
        letterSpacing: "0.4px",
    },
    sectionHint: {
        fontSize: "10px",
        color: "#9aa4bf",
        marginBottom: "8px",
        textTransform: "uppercase",
        letterSpacing: "0.6px",
    },
    rowBetween: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: "6px",
        gap: "8px",
    },
    label: {
        fontSize: "12px",
        color: "#b5bcd6",
    },
    mono: {
        fontFamily: '"DM Mono", "Fira Code", "Source Code Pro", monospace',
        fontSize: "12px",
    },
    ramBarTrack: {
        height: "8px",
        borderRadius: "999px",
        backgroundColor: "#0d132a",
        overflow: "hidden",
        marginBottom: "8px",
    },
    ramBarFill: {
        height: "100%",
        backgroundColor: THEME.accent,
        transition: "width 220ms ease",
    },
    statusPill: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        backgroundColor: "#11182f",
        borderRadius: "999px",
        padding: "4px 10px",
        border: `1px solid ${THEME.border}`,
        fontSize: "12px",
    },
    statusDot: {
        width: "8px",
        height: "8px",
        borderRadius: "50%",
    },
    groupBlock: {
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        marginBottom: "8px",
    },
    groupTitle: {
        fontSize: "11px",
        textTransform: "uppercase",
        letterSpacing: "1px",
        color: "#9aa4bf",
    },
    groupList: {
        display: "flex",
        flexDirection: "column",
        gap: "6px",
    },
    scriptRow: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        backgroundColor: "#11182f",
        border: `1px solid ${THEME.border}`,
        borderRadius: "6px",
        padding: "6px 8px",
        gap: "10px",
    },
    scriptInfo: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        flexWrap: "wrap",
        fontSize: "12px",
    },
    scriptName: {
        fontWeight: 600,
    },
    managedBadge: {
        backgroundColor: "rgba(255,165,0,0.15)",
        color: THEME.orange,
        border: `1px solid rgba(255,165,0,0.4)`,
        borderRadius: "999px",
        padding: "2px 6px",
        fontSize: "10px",
    },
    errorBadge: {
        backgroundColor: "rgba(255,68,68,0.15)",
        color: THEME.red,
        border: `1px solid rgba(255,68,68,0.35)`,
        borderRadius: "999px",
        padding: "2px 6px",
        fontSize: "10px",
    },
    scriptActions: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
    },
    actionButton: {
        backgroundColor: THEME.accent,
        color: THEME.text,
        border: `1px solid ${THEME.border}`,
        borderRadius: "4px",
        padding: "4px 8px",
        fontSize: "11px",
        cursor: "pointer",
    },
    actionButtonWarn: {
        backgroundColor: "rgba(255,165,0,0.25)",
        borderColor: THEME.orange,
        color: THEME.orange,
    },
    actionButtonDisabled: {
        opacity: 0.5,
        cursor: "not-allowed",
    },
    placeholder: {
        fontSize: "12px",
        color: "#9aa4bf",
        padding: "6px 0",
    },
    table: {
        display: "flex",
        flexDirection: "column",
        gap: "6px",
    },
    tableHeader: {
        display: "grid",
        gridTemplateColumns: "1.2fr 1.4fr 1fr 0.8fr 0.6fr",
        gap: "6px",
        fontSize: "11px",
        textTransform: "uppercase",
        color: "#9aa4bf",
        letterSpacing: "0.8px",
    },
    stockTableHeader: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr 0.8fr 0.9fr 0.9fr",
        gap: "6px",
        fontSize: "11px",
        textTransform: "uppercase",
        color: "#9aa4bf",
        letterSpacing: "0.8px",
    },
    tableRow: {
        display: "grid",
        gridTemplateColumns: "1.2fr 1.4fr 1fr 0.8fr 0.6fr",
        gap: "6px",
        backgroundColor: "#11182f",
        border: `1px solid ${THEME.border}`,
        borderRadius: "6px",
        padding: "6px",
        fontSize: "12px",
    },
    stockTableRow: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr 0.8fr 0.9fr 0.9fr",
        gap: "6px",
        backgroundColor: "#11182f",
        border: `1px solid ${THEME.border}`,
        borderRadius: "6px",
        padding: "6px",
        fontSize: "12px",
    },
    sleeveHeader: {
        display: "grid",
        gridTemplateColumns: "0.4fr 1fr 0.8fr 0.8fr 1.8fr 1fr",
        gap: "6px",
        fontSize: "11px",
        textTransform: "uppercase",
        color: "#9aa4bf",
        letterSpacing: "0.8px",
    },
    sleeveRow: {
        display: "grid",
        gridTemplateColumns: "0.4fr 1fr 0.8fr 0.8fr 1.8fr 1fr",
        gap: "6px",
        backgroundColor: "#11182f",
        border: `1px solid ${THEME.border}`,
        borderRadius: "6px",
        padding: "6px",
        fontSize: "12px",
    },
    sleeveMetricGood: {
        color: THEME.green,
    },
    sleeveMetricWarn: {
        color: THEME.orange,
    },
    sleeveMetricNeutral: {
        color: THEME.text,
    },
    bladeTableHeader: {
        display: "grid",
        gridTemplateColumns: "1.6fr 0.6fr 1fr",
        gap: "6px",
        fontSize: "11px",
        textTransform: "uppercase",
        color: "#9aa4bf",
        letterSpacing: "0.8px",
    },
    bladeTableRow: {
        display: "grid",
        gridTemplateColumns: "1.6fr 0.6fr 1fr",
        gap: "6px",
        backgroundColor: "#11182f",
        border: `1px solid ${THEME.border}`,
        borderRadius: "6px",
        padding: "6px",
        fontSize: "12px",
    },
    badgeRow: {
        display: "flex",
        flexWrap: "wrap",
        gap: "6px",
    },
    divisionBadge: {
        backgroundColor: "#11182f",
        border: `1px solid ${THEME.border}`,
        borderRadius: "999px",
        padding: "4px 10px",
        fontSize: "11px",
        color: THEME.text,
    },
    directionUp: {
        color: THEME.green,
    },
    directionDown: {
        color: THEME.red,
    },
    grid: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        gap: "8px",
    },
    infoCard: {
        backgroundColor: "#11182f",
        border: `1px solid ${THEME.border}`,
        borderRadius: "6px",
        padding: "8px",
    },
    infoLabel: {
        fontSize: "10px",
        textTransform: "uppercase",
        letterSpacing: "0.8px",
        color: "#9aa4bf",
        marginBottom: "4px",
    },
    infoValue: {
        fontSize: "13px",
        fontWeight: 600,
    },
    rawBlock: {
        backgroundColor: "#0d132a",
        border: `1px solid ${THEME.border}`,
        borderRadius: "6px",
        padding: "8px",
        fontSize: "11px",
        whiteSpace: "pre-wrap",
        color: "#c3cadf",
    },
    dangerSection: {
        backgroundColor: "rgba(255,68,68,0.05)",
        border: "1px solid rgba(255,68,68,0.3)",
        borderRadius: "8px",
        padding: "10px",
    },
    dangerButton: {
        backgroundColor: "rgba(255,68,68,0.2)",
        color: "#ff4444",
        border: "1px solid rgba(255,68,68,0.5)",
        borderRadius: "4px",
        padding: "6px 12px",
        fontSize: "12px",
        cursor: "pointer",
        fontWeight: 600,
    },
    cancelButton: {
        backgroundColor: THEME.surface,
        color: THEME.text,
        border: `1px solid ${THEME.border}`,
        borderRadius: "4px",
        padding: "6px 12px",
        fontSize: "12px",
        cursor: "pointer",
    },
    dangerConfirmText: {
        fontSize: "12px",
        color: "#ff4444",
        marginBottom: "8px",
    },
    factionTableHeader: {
        display: "grid",
        gridTemplateColumns: "1.6fr 0.8fr 0.6fr",
        gap: "6px",
        fontSize: "11px",
        textTransform: "uppercase",
        color: "#9aa4bf",
        letterSpacing: "0.8px",
    },
    factionTableRow: {
        display: "grid",
        gridTemplateColumns: "1.6fr 0.8fr 0.6fr",
        gap: "6px",
        backgroundColor: "#11182f",
        border: `1px solid ${THEME.border}`,
        borderRadius: "6px",
        padding: "6px",
        fontSize: "12px",
    },
    infraServerHeader: {
        display: "grid",
        gridTemplateColumns: "1.4fr 0.8fr 0.6fr",
        gap: "6px",
        fontSize: "11px",
        textTransform: "uppercase",
        color: "#9aa4bf",
        letterSpacing: "0.8px",
    },
    infraServerRow: {
        display: "grid",
        gridTemplateColumns: "1.4fr 0.8fr 0.6fr",
        gap: "6px",
        backgroundColor: "#11182f",
        border: `1px solid ${THEME.border}`,
        borderRadius: "6px",
        padding: "6px",
        fontSize: "12px",
    },
};
