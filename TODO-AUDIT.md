# TODO Audit Report (Updated)

Generated: 2026-03-01
Total TODOs: 56 across 15 files

## Completed in This Pass
- BN8 stock auto-focus in daemon.js
- NeuroFlux optimization in faction-manager.js (selection, donations, faction rotation)
- Sleeve training cost fix + multi-sleeve faction work
- Looping mode cleanup (auto-kill looping scripts on restart) and re-enabled autopilot loop mode
- Batch scheduling lookahead + RAM scheduling improvements in daemon.js
- Contractor #3755 workaround removed (now returns [])

---

## Summary by File (Remaining TODOs)

| File | Count | Primary Categories |
|------|-------|-------------------|
| work-for-factions.js | 16 | Faction efficiency, rep gain optimization |
| daemon.js | 10 | Performance edge cases, timing polish |
| helpers.js | 9 | API refactoring, error handling |
| autopilot.js | 6 | Automation polish, status hints |
| ascend.js | 3 | Pre-ascension actions |
| gangs.js | 2 | Wanted level, budget logic |
| casino.js | 2 | UI automation |
| analyze-hack.js | 1 | Formula accuracy |
| bladeburner.js | 1 | Action prioritization |
| dump-ns-namespace.js | 1 | Safety denylist |
| git-pull.js | 1 | Update flow |
| scan.js | 1 | UI stats |
| spend-hacknet-hashes.js | 1 | Bulk buying |
| stanek.js | 1 | Startup/completion script defaults |
| stanek.js.create.js | 1 | Layout refinement |

---

## Remaining TODOs by File

### work-for-factions.js (16)
- 76: Unique cmp_rep aug TODO: Can it sensibly be gotten before megacorps? Requires 300 all combat stats.
- 220: Detect when the most expensive aug from two factions is the same - only need it from the first one. (Update lists and remove 'afforded' augs?)
- 231: Think this over more. need to filter e.g. chonquing if volhaven is incomplete...
- 242: If --prioritize-invites is set, we should have a preferred faction order that puts easiest-invites-to-earn at the front (e.g. all city factions)
- 267: Check if we would qualify for an invite to any factions just by travelling, and do so to start earning passive rep
- 307: Otherwise, if we get Fulcrum, we have no need for a couple other company factions
- 475: Be smarter (time-based decision), and also consider whether training physical stats via GYM might be faster
- 483: There could be more efficient ways to gain combat stats than homicide, although at least this serves future crime factions
- 537: It might be reasonable to request a temporary stock liquidation if this would get us over the edge.
- 720: Compute an ETA, and configure training threshold based on ETA
- 856: Other situations we want to prioritize bladeburner over normal work? Perhaps if we're in a Bladeburner BN? (6 or 7)
- 1023: Move this to helpers.js, measure all rep gain rates over a parameterizable number of game ticks (default 1) and return them all.
- 1131: Cache backdoor result once true
- 1156: Best career path may require combat stats, this hard-codes the optimal path for hack stats
- 1162: Derive current position and promotion index based on player.jobs[companyName]
- 1219: Re-use monitorStudies function instead of duplicating code

### daemon.js (10)
- 193: RAM-dodging latency concern
- 340: Improve timings so we don't need so much padding
- 1085: ns reference in class might cause issues
- 1227: Worst-case grow threads are overestimated
- 1689: Thread splitting check might be unnecessary
- 1794: Cache targeting order for stability
- 1957: First grow runs at increased security; time adjustment
- 1999: "in ...ms" time formatting
- 2011: Return longer delay in advance mode
- 2319: Revise server free-ram sort hack

### helpers.js (9)
- 28: Sig figs rounding issue (9.999 → 10.00)
- 154: Switch getNsDataThroughFile to args object
- 246: Add null/undefined result handling (Issue #481)
- 257: Unsure file read can fail or needs retrying
- 435: Switch to nextPortWrite for faster signaling
- 450: jsonReplacer to support ScriptDeath objects
- 548: Write terminal logs to a permanent file
- 609: Check which BNs have effective SF levels
- 842: ns.flags aggressive type conversion

### autopilot.js (6)
- 56: Sleeve memory upgrades lack API; UI automation question
- 600: --xp-only doesn't handle stock manipulation (BN8)
- 692: Monitor gang territory progress and adjust budget
- 982: Stockmaster buying threshold tuning
- 1026: Bladeburner black-op progress tracking
- 1027: Faction donation unlock proximity tracking

### ascend.js (3)
- 159: Buy back corporation shares before ascending
- 175: Accept faction invitations, claim +1 free favor
- 182: No way to close save dialog

### gangs.js (2)
- 373: Wanted level calc and strategic member selection
- 438: More cases to reduce aug budget when income nerfed

### casino.js (2)
- 45: TODO block (incomplete)
- 542: Convert characters to look-alikes in XPath logs

### single TODO files
- analyze-hack.js:83 — formulas might be off by 2x
- bladeburner.js:272 — field analysis scaling
- dump-ns-namespace.js:18 — denylist unsafe functions
- git-pull.js:10 — omit-folder may be obsolete
- scan.js:63 — showStats additions
- spend-hacknet-hashes.js:110 — bulk purchase calculation
- stanek.js:16 — default script selection
- stanek.js.create.js:166 — charisma boosts earlier

---

## Suggested Next Steps
1. Work-for-factions optimization pass (largest remaining TODO block)
2. Helpers.js refactor + safety improvements
3. Autopilot quality-of-life TODOs
4. Low-volume polish items (single TODO files)
