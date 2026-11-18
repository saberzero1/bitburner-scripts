import { log, getConfiguration, getNsDataThroughFile } from "./helpers.js";

const argsSchema = [
    ["clear", false], // If set to true, will clear whatever layout is already there and create a new one
    ["force-width", null], // Force the layout less than or equal to the specified width
    ["force-height", null], // Force the layout less than or equal to the specified height
    ["hacking", false], // Place a hacking-only layout (the two hacking fragments ringed by boosters), for after The Red Pill
    ["charisma", false], // Before The Red Pill: the charisma fragment (id 18, power 3) alone, ringed by boosters (charismaLayouts)
];

// After The Red Pill only hacking level matters. Both hacking fragments (the only ones that raise hacking skill) with as
// many adjacent boosters as fit (boosters have no placement limit; each adjacent one multiplies a fragment's bonus by
// 1.1). In BN12 Stanek's power multiplier is 1.02^level (~4.6 at BN12.77), so on 9x8 the pair goes from hacking x4.0
// to x7.6. Placement search per grid size (2026-11-16): a fragment's 10 neighbour cells fit at most 8 distinct boosters,
// so 12x12 (8+8) is the ceiling; larger grids use it as is. Chosen by most boosters touching, not least unused space.
// Charisma alone ringed by boosters (tools/stanek-hacking-layouts.py fragdefs.json out.json 18, 2026-11-18): before The Red
// Pill only charisma limits anything (labyrinths, migration charging, RAM freeing, labyrinth moves). 8 distinct boosters
// (the most a 4-cell fragment can touch) from 8x7 up; the hacking layouts gave it fewer (hacking fragment 1 shared them).
const charismaLayouts = [
    // 5x5: 3 boosters touching charisma:  .HHaa / HHz.a / .bz.a / .bzza / bbbz.
    { height: 5, width: 5, boosters: 3, fragments: [{"id": 18, "x": 0, "y": 0, "rotation": 0}, {"id": 102, "x": 2, "y": 1, "rotation": 3}, {"id": 101, "x": 3, "y": 0, "rotation": 1}, {"id": 106, "x": 0, "y": 2, "rotation": 3}] },
    // 6x5: 5 boosters touching charisma:  cccaaa / bcaazz / bcHHz. / bHHzzd / bbdddd
    { height: 5, width: 6, boosters: 5, fragments: [{"id": 18, "x": 1, "y": 2, "rotation": 0}, {"id": 104, "x": 3, "y": 1, "rotation": 0}, {"id": 102, "x": 2, "y": 0, "rotation": 0}, {"id": 101, "x": 0, "y": 1, "rotation": 3}, {"id": 106, "x": 0, "y": 0, "rotation": 1}, {"id": 101, "x": 2, "y": 3, "rotation": 2}] },
    // 6x6: 6 boosters touching charisma:  zzzzaa / ze.HHa / eeHHda / eccbda / ec.bdd / ccbbbd
    { height: 6, width: 6, boosters: 6, fragments: [{"id": 18, "x": 2, "y": 1, "rotation": 0}, {"id": 101, "x": 0, "y": 0, "rotation": 0}, {"id": 101, "x": 4, "y": 0, "rotation": 1}, {"id": 106, "x": 2, "y": 3, "rotation": 3}, {"id": 104, "x": 0, "y": 3, "rotation": 0}, {"id": 102, "x": 4, "y": 2, "rotation": 3}, {"id": 103, "x": 0, "y": 1, "rotation": 3}] },
    // 7x6: 6 boosters touching charisma:  .eeea.. / eeHHaaa / bHHccca / bdzz.cc / bddzzz. / bbdd...
    { height: 6, width: 7, boosters: 6, fragments: [{"id": 18, "x": 1, "y": 1, "rotation": 0}, {"id": 103, "x": 2, "y": 3, "rotation": 2}, {"id": 104, "x": 4, "y": 0, "rotation": 1}, {"id": 101, "x": 0, "y": 2, "rotation": 3}, {"id": 103, "x": 3, "y": 2, "rotation": 0}, {"id": 105, "x": 1, "y": 3, "rotation": 1}, {"id": 102, "x": 0, "y": 0, "rotation": 0}] },
    // 7x7: 7 boosters touching charisma:  c.z.... / c.zzzff / c.zfffa / ccHHaaa / eHHbbba / eedddbb / .ee.dd.
    { height: 7, width: 7, boosters: 7, fragments: [{"id": 18, "x": 1, "y": 3, "rotation": 0}, {"id": 106, "x": 2, "y": 0, "rotation": 0}, {"id": 106, "x": 4, "y": 2, "rotation": 2}, {"id": 103, "x": 3, "y": 4, "rotation": 0}, {"id": 101, "x": 0, "y": 0, "rotation": 3}, {"id": 103, "x": 2, "y": 5, "rotation": 0}, {"id": 105, "x": 0, "y": 4, "rotation": 1}, {"id": 102, "x": 3, "y": 1, "rotation": 2}] },
    // 8x7: 8 boosters touching charisma:  .fzzz.c. / ef.z.cc. / effzccb. / e.fHHbbb / eeHHgggb / dddaaagg / ..dd.aa.
    { height: 7, width: 8, boosters: 8, fragments: [{"id": 18, "x": 2, "y": 3, "rotation": 0}, {"id": 106, "x": 2, "y": 0, "rotation": 1}, {"id": 103, "x": 3, "y": 5, "rotation": 0}, {"id": 100, "x": 5, "y": 2, "rotation": 1}, {"id": 105, "x": 4, "y": 0, "rotation": 0}, {"id": 103, "x": 0, "y": 5, "rotation": 0}, {"id": 101, "x": 0, "y": 1, "rotation": 3}, {"id": 102, "x": 1, "y": 0, "rotation": 3}, {"id": 103, "x": 4, "y": 4, "rotation": 0}] },
    // 8x8: 8 boosters touching charisma:  ...g.z.. / .bgggzz. / bbbgzze. / ..bHHeee / .dHHcce. / ddfa.ccc / d.faaa.. / dfffa...
    { height: 8, width: 8, boosters: 8, fragments: [{"id": 18, "x": 2, "y": 3, "rotation": 0}, {"id": 100, "x": 4, "y": 0, "rotation": 2}, {"id": 100, "x": 3, "y": 5, "rotation": 3}, {"id": 100, "x": 0, "y": 1, "rotation": 1}, {"id": 103, "x": 4, "y": 4, "rotation": 2}, {"id": 103, "x": 0, "y": 4, "rotation": 3}, {"id": 107, "x": 5, "y": 2, "rotation": 0}, {"id": 106, "x": 1, "y": 5, "rotation": 3}, {"id": 107, "x": 2, "y": 0, "rotation": 0}] },
    // 9x8: 8 boosters touching charisma:  .b.dddda. / bbbdaaaag / ..bHHgggg / .fHHcc... / .fze.ccc. / ffzeee... / fzz..e... / .z.......
    { height: 8, width: 9, boosters: 8, fragments: [{"id": 18, "x": 2, "y": 2, "rotation": 0}, {"id": 103, "x": 1, "y": 4, "rotation": 1}, {"id": 101, "x": 4, "y": 0, "rotation": 2}, {"id": 100, "x": 0, "y": 0, "rotation": 1}, {"id": 103, "x": 4, "y": 3, "rotation": 2}, {"id": 101, "x": 3, "y": 0, "rotation": 0}, {"id": 104, "x": 3, "y": 4, "rotation": 1}, {"id": 103, "x": 0, "y": 3, "rotation": 1}, {"id": 101, "x": 5, "y": 1, "rotation": 2}] },
    // 9x9: 8 boosters touching charisma:  .zd...... / fzdd..... / fzzd.a... / f.zd.a... / ffHHaaa.. / cHHee.... / cgbbeee.. / cggbbb... / ccgg.....
    { height: 9, width: 9, boosters: 8, fragments: [{"id": 18, "x": 1, "y": 4, "rotation": 0}, {"id": 102, "x": 1, "y": 0, "rotation": 3}, {"id": 106, "x": 4, "y": 2, "rotation": 3}, {"id": 103, "x": 2, "y": 6, "rotation": 2}, {"id": 101, "x": 0, "y": 5, "rotation": 3}, {"id": 102, "x": 2, "y": 0, "rotation": 1}, {"id": 103, "x": 3, "y": 5, "rotation": 2}, {"id": 101, "x": 0, "y": 1, "rotation": 3}, {"id": 105, "x": 1, "y": 6, "rotation": 1}] },
    // 10x9: 8 boosters touching charisma:  .a..c..... / ea.cc..... / ea.c...... / eaac..dd.. / eeHHddd... / gHHbb..... / gzffbb.... / gzzffb.... / ggzzf.....
    { height: 9, width: 10, boosters: 8, fragments: [{"id": 18, "x": 1, "y": 4, "rotation": 0}, {"id": 105, "x": 1, "y": 6, "rotation": 1}, {"id": 101, "x": 1, "y": 0, "rotation": 3}, {"id": 105, "x": 3, "y": 5, "rotation": 3}, {"id": 103, "x": 3, "y": 0, "rotation": 3}, {"id": 102, "x": 4, "y": 3, "rotation": 2}, {"id": 101, "x": 0, "y": 1, "rotation": 3}, {"id": 105, "x": 2, "y": 6, "rotation": 3}, {"id": 101, "x": 0, "y": 5, "rotation": 3}] },
    // 10x10: 8 boosters touching charisma:  .e..ddg... / .eeddggc.. / ..edggcc.. / ..eHHcc... / .aHHff.... / aazbbfff.. / a.z.bb.... / a.z..b.... / ..zz...... / ..........
    { height: 10, width: 10, boosters: 8, fragments: [{"id": 18, "x": 2, "y": 3, "rotation": 0}, {"id": 101, "x": 2, "y": 5, "rotation": 3}, {"id": 103, "x": 0, "y": 4, "rotation": 3}, {"id": 105, "x": 3, "y": 5, "rotation": 3}, {"id": 105, "x": 5, "y": 1, "rotation": 0}, {"id": 105, "x": 3, "y": 0, "rotation": 2}, {"id": 102, "x": 1, "y": 0, "rotation": 1}, {"id": 103, "x": 4, "y": 4, "rotation": 2}, {"id": 105, "x": 4, "y": 0, "rotation": 0}] },
    // 11x10: 8 boosters touching charisma:  cc.aa...... / .caa.ee.... / .caeeedd... / .cHHddd.... / gHHfff..... / gbzz.ff.... / gbbzz...... / ggb.z...... / ..b........ / ...........
    { height: 10, width: 11, boosters: 8, fragments: [{"id": 18, "x": 1, "y": 3, "rotation": 0}, {"id": 105, "x": 2, "y": 5, "rotation": 3}, {"id": 105, "x": 2, "y": 0, "rotation": 2}, {"id": 102, "x": 1, "y": 5, "rotation": 1}, {"id": 101, "x": 0, "y": 0, "rotation": 1}, {"id": 102, "x": 4, "y": 2, "rotation": 2}, {"id": 102, "x": 3, "y": 1, "rotation": 2}, {"id": 103, "x": 3, "y": 4, "rotation": 0}, {"id": 101, "x": 0, "y": 4, "rotation": 3}] },
    // 11x11: 8 boosters touching charisma:  cc.aa...... / .caa.ee.... / .caeeedd... / .cHHddd.... / gHHfff..... / gbzz.ff.... / gbbzz...... / ggb.z...... / ..b........ / ........... / ...........
    { height: 11, width: 11, boosters: 8, fragments: [{"id": 18, "x": 1, "y": 3, "rotation": 0}, {"id": 105, "x": 2, "y": 5, "rotation": 3}, {"id": 105, "x": 2, "y": 0, "rotation": 2}, {"id": 102, "x": 1, "y": 5, "rotation": 1}, {"id": 101, "x": 0, "y": 0, "rotation": 1}, {"id": 102, "x": 4, "y": 2, "rotation": 2}, {"id": 102, "x": 3, "y": 1, "rotation": 2}, {"id": 103, "x": 3, "y": 4, "rotation": 0}, {"id": 101, "x": 0, "y": 4, "rotation": 3}] },
    // 12x11: 8 boosters touching charisma:  eb.......... / ebbb.aa..... / eebaaa...... / .eHHddd..... / gHHff.dd.... / gczzfff..... / gcczzz...... / ggc......... / ..c......... / ............ / ............
    { height: 11, width: 12, boosters: 8, fragments: [{"id": 18, "x": 1, "y": 3, "rotation": 0}, {"id": 103, "x": 2, "y": 5, "rotation": 2}, {"id": 102, "x": 3, "y": 1, "rotation": 2}, {"id": 100, "x": 1, "y": 0, "rotation": 3}, {"id": 102, "x": 1, "y": 5, "rotation": 1}, {"id": 103, "x": 4, "y": 3, "rotation": 0}, {"id": 102, "x": 0, "y": 0, "rotation": 3}, {"id": 103, "x": 3, "y": 4, "rotation": 2}, {"id": 101, "x": 0, "y": 4, "rotation": 3}] },
    // 12x12: 8 boosters touching charisma:  e..aa....... / eeaa.cc..... / .eaccc.d.... / .eHHdddd.... / zHHbbb...... / zfgg.bb..... / zffggg...... / zzff........ / ............ / ............ / ............ / ............
    { height: 12, width: 12, boosters: 8, fragments: [{"id": 18, "x": 1, "y": 3, "rotation": 0}, {"id": 101, "x": 0, "y": 4, "rotation": 3}, {"id": 105, "x": 2, "y": 0, "rotation": 2}, {"id": 103, "x": 3, "y": 4, "rotation": 0}, {"id": 102, "x": 3, "y": 1, "rotation": 2}, {"id": 101, "x": 4, "y": 2, "rotation": 2}, {"id": 102, "x": 0, "y": 0, "rotation": 1}, {"id": 105, "x": 1, "y": 5, "rotation": 1}, {"id": 103, "x": 2, "y": 5, "rotation": 2}] },
    // 13x12: 8 boosters touching charisma:  .d........... / gdda......... / g.daaa....... / ggda..cc..... / .gHHccc...... / zHHfff....... / zbeeeff...... / zbbbee....... / zzb.......... / ............. / ............. / .............
    { height: 12, width: 13, boosters: 8, fragments: [{"id": 18, "x": 1, "y": 4, "rotation": 0}, {"id": 101, "x": 0, "y": 5, "rotation": 3}, {"id": 106, "x": 3, "y": 1, "rotation": 0}, {"id": 100, "x": 1, "y": 6, "rotation": 3}, {"id": 102, "x": 4, "y": 3, "rotation": 2}, {"id": 102, "x": 1, "y": 0, "rotation": 1}, {"id": 103, "x": 2, "y": 6, "rotation": 0}, {"id": 103, "x": 3, "y": 5, "rotation": 0}, {"id": 102, "x": 0, "y": 1, "rotation": 3}] },
    // 13x13: 8 boosters touching charisma:  .d........... / gdda......... / g.daaa....... / ggda..cc..... / .gHHccc...... / zHHfff....... / zbeeeff...... / zbbbee....... / zzb.......... / ............. / ............. / ............. / .............
    { height: 13, width: 13, boosters: 8, fragments: [{"id": 18, "x": 1, "y": 4, "rotation": 0}, {"id": 101, "x": 0, "y": 5, "rotation": 3}, {"id": 106, "x": 3, "y": 1, "rotation": 0}, {"id": 100, "x": 1, "y": 6, "rotation": 3}, {"id": 102, "x": 4, "y": 3, "rotation": 2}, {"id": 102, "x": 1, "y": 0, "rotation": 1}, {"id": 103, "x": 2, "y": 6, "rotation": 0}, {"id": 103, "x": 3, "y": 5, "rotation": 0}, {"id": 102, "x": 0, "y": 1, "rotation": 3}] },
];
const hackingLayouts = [
    // 5x5: boosters touching the hacking fragments 3+2
    //   bHH.a / bHHHa / bHHaa / bbHac / .cccc
    { height: 5, width: 5, boosters: 5, fragments: [{"id": 0, "x": 1, "y": 1, "rotation": 1}, {"id": 1, "x": 1, "y": 0, "rotation": 0}, {"id": 103, "x": 3, "y": 0, "rotation": 1}, {"id": 101, "x": 0, "y": 0, "rotation": 3}, {"id": 101, "x": 1, "y": 3, "rotation": 2}] },
    // 6x5: boosters touching the hacking fragments 3+3
    //   dddHH. / bdHHcc / bdaa.c / bHHaac / bbHHac
    { height: 5, width: 6, boosters: 6, fragments: [{"id": 0, "x": 2, "y": 0, "rotation": 0}, {"id": 1, "x": 1, "y": 3, "rotation": 0}, {"id": 105, "x": 2, "y": 2, "rotation": 3}, {"id": 101, "x": 0, "y": 1, "rotation": 3}, {"id": 101, "x": 4, "y": 1, "rotation": 1}, {"id": 106, "x": 0, "y": 0, "rotation": 1}] },
    // 6x6: boosters touching the hacking fragments 3+5
    //   .cccH. / ccaaHH / eHHaaH / e.HHab / eddbbb / eedddb
    { height: 6, width: 6, boosters: 8, fragments: [{"id": 0, "x": 4, "y": 0, "rotation": 1}, {"id": 1, "x": 1, "y": 2, "rotation": 0}, {"id": 105, "x": 2, "y": 1, "rotation": 3}, {"id": 106, "x": 3, "y": 3, "rotation": 2}, {"id": 102, "x": 0, "y": 0, "rotation": 0}, {"id": 103, "x": 1, "y": 4, "rotation": 2}, {"id": 101, "x": 0, "y": 2, "rotation": 3}] },
    // 7x6: boosters touching the hacking fragments 5+4
    //   ..ccHH. / .ccaaHH / fcaabbe / fHabbee / fHHbeed / ffHdddd
    { height: 6, width: 7, boosters: 9, fragments: [{"id": 0, "x": 1, "y": 3, "rotation": 1}, {"id": 1, "x": 4, "y": 0, "rotation": 0}, {"id": 105, "x": 2, "y": 1, "rotation": 2}, {"id": 105, "x": 3, "y": 2, "rotation": 2}, {"id": 105, "x": 1, "y": 0, "rotation": 2}, {"id": 101, "x": 3, "y": 4, "rotation": 2}, {"id": 105, "x": 4, "y": 2, "rotation": 0}, {"id": 101, "x": 0, "y": 2, "rotation": 3}] },
    // 7x7: boosters touching the hacking fragments 5+5
    //   gggg.d. / gHeeedd / HHcceed / Haacccd / bbaaaHH / .bbbHHf / ...ffff
    { height: 7, width: 7, boosters: 10, fragments: [{"id": 0, "x": 4, "y": 4, "rotation": 0}, {"id": 1, "x": 0, "y": 1, "rotation": 1}, {"id": 103, "x": 1, "y": 3, "rotation": 2}, {"id": 103, "x": 0, "y": 4, "rotation": 2}, {"id": 103, "x": 2, "y": 2, "rotation": 2}, {"id": 102, "x": 5, "y": 0, "rotation": 1}, {"id": 103, "x": 2, "y": 1, "rotation": 0}, {"id": 101, "x": 3, "y": 5, "rotation": 2}, {"id": 101, "x": 0, "y": 0, "rotation": 0}] },
    // 8x7: boosters touching the hacking fragments 5+6
    //   .hhhh.e. / .h.cHHee / ..ccaHHe / dccaabfe / dHaabbff / dHHbbggf / ddHggg.f
    { height: 7, width: 8, boosters: 11, fragments: [{"id": 0, "x": 1, "y": 4, "rotation": 1}, {"id": 1, "x": 4, "y": 1, "rotation": 0}, {"id": 105, "x": 2, "y": 2, "rotation": 0}, {"id": 105, "x": 3, "y": 3, "rotation": 0}, {"id": 105, "x": 1, "y": 1, "rotation": 0}, {"id": 101, "x": 0, "y": 3, "rotation": 3}, {"id": 102, "x": 6, "y": 0, "rotation": 1}, {"id": 102, "x": 6, "y": 3, "rotation": 1}, {"id": 102, "x": 3, "y": 5, "rotation": 2}, {"id": 101, "x": 1, "y": 0, "rotation": 0}] },
    // 8x8: boosters touching the hacking fragments 6+6
    //   .hhHbb.. / hhHHfbbb / hgHafff. / ggeaaaf. / g.ea.HHc / geeeHH.c / .ddddicc / .diiiic.
    { height: 8, width: 8, boosters: 12, fragments: [{"id": 0, "x": 4, "y": 4, "rotation": 0}, {"id": 1, "x": 2, "y": 0, "rotation": 1}, {"id": 106, "x": 3, "y": 2, "rotation": 0}, {"id": 103, "x": 4, "y": 0, "rotation": 2}, {"id": 103, "x": 6, "y": 4, "rotation": 1}, {"id": 101, "x": 1, "y": 6, "rotation": 0}, {"id": 106, "x": 1, "y": 3, "rotation": 3}, {"id": 104, "x": 4, "y": 1, "rotation": 1}, {"id": 103, "x": 0, "y": 2, "rotation": 3}, {"id": 105, "x": 0, "y": 0, "rotation": 2}, {"id": 101, "x": 2, "y": 6, "rotation": 2}] },
    // 9x8: boosters touching the hacking fragments 6+6
    //   .g.fffjj. / ggffdddjj / g.Hbb.ddj / gHHabbbHH / eHiaaaHH. / eeiiahhc. / .eeihhccc / ...ih..c.
    { height: 8, width: 9, boosters: 12, fragments: [{"id": 0, "x": 6, "y": 3, "rotation": 0}, {"id": 1, "x": 1, "y": 2, "rotation": 1}, {"id": 100, "x": 3, "y": 3, "rotation": 3}, {"id": 103, "x": 3, "y": 2, "rotation": 2}, {"id": 107, "x": 6, "y": 5, "rotation": 0}, {"id": 103, "x": 4, "y": 1, "rotation": 0}, {"id": 105, "x": 0, "y": 4, "rotation": 1}, {"id": 102, "x": 2, "y": 0, "rotation": 0}, {"id": 103, "x": 0, "y": 0, "rotation": 3}, {"id": 105, "x": 4, "y": 5, "rotation": 2}, {"id": 102, "x": 2, "y": 4, "rotation": 1}, {"id": 105, "x": 6, "y": 0, "rotation": 3}] },
    // 9x9: boosters touching the hacking fragments 6+7
    //   ..ffggg.. / fffHHagg. / ..HHba..j / .ddcbaa.j / dd.cbbajj / d..ccbHje / ....cHHee / ..hhhHeei / .hh..iiii
    { height: 9, width: 9, boosters: 13, fragments: [{"id": 0, "x": 2, "y": 1, "rotation": 0}, {"id": 1, "x": 5, "y": 5, "rotation": 1}, {"id": 102, "x": 5, "y": 1, "rotation": 3}, {"id": 102, "x": 4, "y": 2, "rotation": 3}, {"id": 102, "x": 3, "y": 3, "rotation": 3}, {"id": 105, "x": 0, "y": 3, "rotation": 2}, {"id": 105, "x": 6, "y": 5, "rotation": 0}, {"id": 102, "x": 0, "y": 0, "rotation": 2}, {"id": 103, "x": 4, "y": 0, "rotation": 0}, {"id": 102, "x": 1, "y": 7, "rotation": 0}, {"id": 101, "x": 5, "y": 7, "rotation": 2}, {"id": 103, "x": 7, "y": 2, "rotation": 1}] },
    // 10x9: boosters touching the hacking fragments 6+8
    //   ..ggkkk... / .ggHHckk.i / .gHHacccii / ..hbaa.cif / hhhbbaaHif / ..h.bbHHff / ..jjjjHdf. / ..jeeeeddd / ...e.....d
    { height: 9, width: 10, boosters: 14, fragments: [{"id": 0, "x": 2, "y": 1, "rotation": 0}, {"id": 1, "x": 6, "y": 4, "rotation": 1}, {"id": 105, "x": 4, "y": 2, "rotation": 1}, {"id": 105, "x": 3, "y": 3, "rotation": 1}, {"id": 104, "x": 5, "y": 1, "rotation": 1}, {"id": 104, "x": 7, "y": 6, "rotation": 1}, {"id": 101, "x": 3, "y": 7, "rotation": 0}, {"id": 103, "x": 8, "y": 3, "rotation": 1}, {"id": 105, "x": 1, "y": 0, "rotation": 2}, {"id": 106, "x": 0, "y": 3, "rotation": 2}, {"id": 103, "x": 8, "y": 1, "rotation": 3}, {"id": 101, "x": 2, "y": 6, "rotation": 0}, {"id": 103, "x": 4, "y": 0, "rotation": 0}] },
    // 10x10: boosters touching the hacking fragments 8+7
    //   .jjj.h.... / ff.jjhhh.. / .fffHHbh.. / .ddHHabk.. / dd.icabkk. / .diicabbke / ..i.caaHke / ..igccHHee / ...gggH.el / .....gllll
    { height: 10, width: 10, boosters: 15, fragments: [{"id": 0, "x": 3, "y": 2, "rotation": 0}, {"id": 1, "x": 6, "y": 6, "rotation": 1}, {"id": 101, "x": 5, "y": 3, "rotation": 3}, {"id": 101, "x": 6, "y": 2, "rotation": 3}, {"id": 101, "x": 4, "y": 4, "rotation": 3}, {"id": 100, "x": 0, "y": 3, "rotation": 0}, {"id": 103, "x": 8, "y": 5, "rotation": 1}, {"id": 103, "x": 0, "y": 1, "rotation": 2}, {"id": 104, "x": 3, "y": 7, "rotation": 1}, {"id": 104, "x": 5, "y": 0, "rotation": 1}, {"id": 103, "x": 2, "y": 4, "rotation": 3}, {"id": 103, "x": 1, "y": 0, "rotation": 0}, {"id": 102, "x": 7, "y": 3, "rotation": 1}, {"id": 101, "x": 6, "y": 8, "rotation": 2}] },
    // 11x10: boosters touching the hacking fragments 7+8
    //   ....fff.... / ..iiiiffh.. / j.i.aHHhhh. / j..aabHHdh. / jjaabbcgddd / .jHbbccgd.. / .lHHccgg... / lleHk.g.... / leeek...... / l.ekkk.....
    { height: 10, width: 11, boosters: 15, fragments: [{"id": 0, "x": 2, "y": 5, "rotation": 1}, {"id": 1, "x": 5, "y": 2, "rotation": 0}, {"id": 105, "x": 2, "y": 2, "rotation": 0}, {"id": 105, "x": 3, "y": 3, "rotation": 0}, {"id": 105, "x": 4, "y": 4, "rotation": 0}, {"id": 106, "x": 8, "y": 3, "rotation": 0}, {"id": 107, "x": 1, "y": 7, "rotation": 0}, {"id": 103, "x": 4, "y": 0, "rotation": 0}, {"id": 103, "x": 6, "y": 4, "rotation": 1}, {"id": 100, "x": 7, "y": 1, "rotation": 1}, {"id": 101, "x": 2, "y": 1, "rotation": 0}, {"id": 102, "x": 0, "y": 2, "rotation": 3}, {"id": 106, "x": 3, "y": 7, "rotation": 3}, {"id": 103, "x": 0, "y": 6, "rotation": 3}] },
    // 11x11: boosters touching the hacking fragments 8+7
    //   ...kkk.iiif / .....kk.i.f / .....bHHiff / ....bbcHHf. / ....bccajjj / ddd.bc.a.j. / ggddHcaa.j. / .gggHHa.... / ...hhHe.... / ..hhlleee.. / ..h..llle..
    { height: 11, width: 11, boosters: 15, fragments: [{"id": 0, "x": 4, "y": 6, "rotation": 1}, {"id": 1, "x": 6, "y": 2, "rotation": 0}, {"id": 103, "x": 6, "y": 4, "rotation": 1}, {"id": 103, "x": 4, "y": 2, "rotation": 3}, {"id": 103, "x": 5, "y": 3, "rotation": 3}, {"id": 103, "x": 0, "y": 5, "rotation": 0}, {"id": 104, "x": 6, "y": 8, "rotation": 1}, {"id": 103, "x": 9, "y": 0, "rotation": 1}, {"id": 103, "x": 0, "y": 6, "rotation": 2}, {"id": 105, "x": 2, "y": 8, "rotation": 2}, {"id": 106, "x": 7, "y": 0, "rotation": 1}, {"id": 106, "x": 8, "y": 4, "rotation": 1}, {"id": 103, "x": 3, "y": 0, "rotation": 0}, {"id": 103, "x": 4, "y": 9, "rotation": 2}] },
    // 12x11: boosters touching the hacking fragments 7+8
    //   fff.ee...... / .f..e....... / .fHeelll.... / iiHHllg..... / .imHaagg.j.. / .imb.aagjjd. / .imbbbagj.d. / ..mm.bHHjdd. / ...hhhhHHd.. / ...hkkkkccc. / ....k..cc...
    { height: 11, width: 12, boosters: 15, fragments: [{"id": 0, "x": 2, "y": 2, "rotation": 1}, {"id": 1, "x": 6, "y": 7, "rotation": 0}, {"id": 105, "x": 4, "y": 4, "rotation": 3}, {"id": 104, "x": 3, "y": 5, "rotation": 1}, {"id": 102, "x": 7, "y": 9, "rotation": 0}, {"id": 103, "x": 9, "y": 5, "rotation": 1}, {"id": 104, "x": 3, "y": 0, "rotation": 0}, {"id": 106, "x": 0, "y": 0, "rotation": 1}, {"id": 102, "x": 6, "y": 3, "rotation": 1}, {"id": 101, "x": 3, "y": 8, "rotation": 0}, {"id": 101, "x": 0, "y": 3, "rotation": 1}, {"id": 103, "x": 8, "y": 4, "rotation": 3}, {"id": 101, "x": 4, "y": 9, "rotation": 0}, {"id": 102, "x": 4, "y": 2, "rotation": 0}, {"id": 101, "x": 2, "y": 4, "rotation": 3}] },
    // 12x12: boosters touching the hacking fragments 8+8
    //   .....i..d... / .....iiidd.. / ......idd..k / .....bHHkkkk / ....bbcHHj.. / ..f.b.cahjjj / ..f.bccahh.j / .fffHcaamh.. / ...gHHammh.. / ..gglHmme... / .gglleeee... / ..ll........
    { height: 12, width: 12, boosters: 16, fragments: [{"id": 0, "x": 4, "y": 7, "rotation": 1}, {"id": 1, "x": 6, "y": 3, "rotation": 0}, {"id": 103, "x": 6, "y": 5, "rotation": 1}, {"id": 103, "x": 4, "y": 3, "rotation": 3}, {"id": 103, "x": 5, "y": 4, "rotation": 1}, {"id": 100, "x": 7, "y": 0, "rotation": 2}, {"id": 101, "x": 5, "y": 9, "rotation": 2}, {"id": 106, "x": 1, "y": 5, "rotation": 3}, {"id": 105, "x": 1, "y": 8, "rotation": 0}, {"id": 102, "x": 8, "y": 5, "rotation": 1}, {"id": 100, "x": 5, "y": 0, "rotation": 3}, {"id": 104, "x": 9, "y": 4, "rotation": 1}, {"id": 101, "x": 8, "y": 2, "rotation": 2}, {"id": 105, "x": 2, "y": 9, "rotation": 0}, {"id": 105, "x": 6, "y": 7, "rotation": 0}] },
    // 13x12: boosters touching the hacking fragments 8+8
    //   ........jllll / .....jjjjl.h. / ...gg.ddHHhhh / ....gddaaHHmh / ....gdaaffcmm / ...bgHaff.ccm / ..bbbHHf...cm / ...bkkHe...c. / ...kkiie..... / ...k.iee..... / ....iie...... / .............
    { height: 12, width: 13, boosters: 16, fragments: [{"id": 0, "x": 5, "y": 5, "rotation": 1}, {"id": 1, "x": 8, "y": 2, "rotation": 0}, {"id": 105, "x": 6, "y": 3, "rotation": 2}, {"id": 107, "x": 2, "y": 5, "rotation": 0}, {"id": 102, "x": 10, "y": 4, "rotation": 1}, {"id": 105, "x": 5, "y": 2, "rotation": 2}, {"id": 103, "x": 6, "y": 7, "rotation": 1}, {"id": 105, "x": 7, "y": 4, "rotation": 2}, {"id": 101, "x": 3, "y": 2, "rotation": 1}, {"id": 100, "x": 10, "y": 1, "rotation": 1}, {"id": 104, "x": 4, "y": 8, "rotation": 0}, {"id": 101, "x": 5, "y": 0, "rotation": 2}, {"id": 105, "x": 3, "y": 7, "rotation": 2}, {"id": 101, "x": 9, "y": 0, "rotation": 0}, {"id": 102, "x": 11, "y": 3, "rotation": 1}] },
    // 13x13: boosters touching the hacking fragments 8+8
    //   ............. / ....cc...j... / ..hh.cccjje.. / ...hhhHjjee.. / .....gHHee... / .....gbHll... / ....ggbaalll. / ....gbbbaaakk / ......iHHkkk. / ...iiiinHHf.. / ......nndmfff / .....nnddmmmf / ......dd.m...
    { height: 13, width: 13, boosters: 16, fragments: [{"id": 0, "x": 6, "y": 3, "rotation": 1}, {"id": 1, "x": 7, "y": 8, "rotation": 0}, {"id": 103, "x": 7, "y": 6, "rotation": 2}, {"id": 106, "x": 5, "y": 5, "rotation": 3}, {"id": 103, "x": 4, "y": 1, "rotation": 2}, {"id": 105, "x": 6, "y": 10, "rotation": 0}, {"id": 105, "x": 8, "y": 2, "rotation": 0}, {"id": 104, "x": 10, "y": 9, "rotation": 1}, {"id": 103, "x": 4, "y": 4, "rotation": 1}, {"id": 103, "x": 2, "y": 2, "rotation": 2}, {"id": 101, "x": 3, "y": 8, "rotation": 2}, {"id": 105, "x": 7, "y": 1, "rotation": 0}, {"id": 102, "x": 9, "y": 7, "rotation": 2}, {"id": 103, "x": 8, "y": 5, "rotation": 2}, {"id": 106, "x": 9, "y": 10, "rotation": 0}, {"id": 105, "x": 5, "y": 9, "rotation": 0}] },
];
export function autocomplete(data, args) {
    data.flags(argsSchema);
    return [];
}

/** @param {NS} ns */
export async function main(ns) {
    const options = getConfiguration(ns, argsSchema);
    if (!options) return;

    // Check if stanek was previously placed
    if (!options["clear"]) {
        const fragments = await getNsDataThroughFile(
            ns,
            "ns.stanek.activeFragments()",
        );
        if (fragments.length > 0)
            return log(
                ns,
                `WARNING: Nothing to do, you've already populated Stanek's Gift. Exiting...`,
                true,
            );
    }

    // Find the saved layout that best matches
    const height =
        options["force-height"] ||
        (await getNsDataThroughFile(ns, "ns.stanek.giftHeight()"));
    const width =
        options["force-width"] ||
        (await getNsDataThroughFile(ns, "ns.stanek.giftWidth()"));
    const ringed = options["hacking"] || options["charisma"];
    const usableLayouts = (options["hacking"] ? hackingLayouts : options["charisma"] ? charismaLayouts : layouts).filter(
        (l) => l.height <= height && l.width <= width,
    );
    if (ringed) usableLayouts.sort((a, b) => b.boosters - a.boosters || b.height * b.width - a.height * a.width);
    let bestLayout = ringed ? usableLayouts[0] : usableLayouts.sort(
        (
            l1,
            l2, // Use the layout with the least amount of unused rows/columns
        ) =>
            height -
            l1.height +
            width -
            l1.width -
            (height - l2.height + width - l2.width),
    )[0];
    if (!bestLayout)
        return log(ns, `WARNING: No ${options["hacking"] ? "hacking " : ""}layout fits a ${width}x${height} Stanek grid.`, true, "warning");
    log(
        ns,
        `Best layout found for current Stanek grid dimentions (height: ${height} width: ${width}) ` +
            `has height: ${bestLayout.height} width: ${bestLayout.width} fragments: ${bestLayout.fragments.length}`,
    );

    // Clear any prior layout if enabled
    if (options["clear"]) {
        await getNsDataThroughFile(
            ns,
            "ns.stanek.clearGift() || true",
            "/Temp/stanek-clearGift.txt",
        );
        log(ns, "Cleared any existing stanek layout.");
    }

    // If we're in a bladeburner BN, and there's no bladeburner piece in our selected layout (id=30),
    // replace the identically shaped hacking multi piece  with this one.
    const has0butNot30 =
        bestLayout.fragments.some((p) => p.id == 0) &&
        !bestLayout.fragments.some((p) => p.id == 30);
    if (has0butNot30) {
        const bitnodeN = (await getNsDataThroughFile(ns, "ns.getResetInfo()"))
            .currentNode;
        if (bitnodeN == 6 || bitnodeN == 7) {
            log(
                ns,
                `We're in a bladeburner node, replacing a hack piece with the bladeburner piece.`,
            );
            bestLayout.fragments.find((p) => p.id == 0).id = 30;
        }
    }

    // Place the layout
    log(
        ns,
        `Placing ${bestLayout.fragments.length} fragments:\n` +
            JSON.stringify(bestLayout.fragments),
    );
    const result = await getNsDataThroughFile(
        ns,
        "JSON.parse(ns.args[0]).reduce((t, f) => ns.stanek.placeFragment(f.x, f.y, f.rotation, f.id) && t, true)",
        "/Temp/stanek-placeFragments.txt",
        [JSON.stringify(bestLayout.fragments)],
    );
    if (result)
        log(
            ns,
            `SUCCESS: Placed ${bestLayout.fragments.length} Stanek fragments.`,
            true,
            "success",
        );
    else
        log(
            ns,
            `ERROR: Failed to place one or more fragments. The layout may be invalid.`,
            true,
            "error",
        );
}

// DISCLAIMER: These layouts are mostly hack focused, but bring in additional important stats as there is room
const layouts = [
    // NOTE: Width appears to be always the same as, or one more than height.
    {
        height: 2,
        width: 3,
        fragments: [
            // BN 13.1 is this small
            { id: 0, x: 0, y: 0, rotation: 0 }, // Hacking Mult
        ],
    },
    {
        height: 3,
        width: 3,
        fragments: [
            { id: 1, x: 0, y: 0, rotation: 3 }, // Hacking Mult
            { id: 25, x: 1, y: 0, rotation: 3 }, // Reputation
        ],
    },
    {
        height: 3,
        width: 4,
        fragments: [
            // Note: Possible to fit 3 fragments, see "alternative layouts" below
            { id: 0, x: 0, y: 0, rotation: 1 }, // Hacking Mult
            { id: 1, x: 2, y: 0, rotation: 1 }, // Hacking Mult
        ],
    },
    {
        height: 4,
        width: 4,
        fragments: [
            // Note: Possible to fit 4 fragments, but have to sacrifice a hacking mult piece
            { id: 0, x: 0, y: 0, rotation: 0 }, // Hacking Mult
            { id: 1, x: 0, y: 2, rotation: 0 }, // Hacking Mult
            { id: 25, x: 2, y: 0, rotation: 3 }, // Reputation
        ],
    },
    {
        height: 4,
        width: 5,
        fragments: [
            { id: 0, x: 0, y: 0, rotation: 0 }, // Hacking Mult
            { id: 1, x: 0, y: 2, rotation: 0 }, // Hacking Mult
            { id: 25, x: 3, y: 1, rotation: 3 }, // Reputation
            { id: 104, x: 2, y: 0, rotation: 0 }, // Booster *new*
        ],
    },
    {
        height: 5,
        width: 5,
        fragments: [
            { id: 0, x: 0, y: 0, rotation: 0 }, // Hacking Mult
            { id: 1, x: 1, y: 2, rotation: 0 }, // Hacking Mult
            { id: 25, x: 3, y: 2, rotation: 3 }, // Reputation
            { id: 105, x: 0, y: 2, rotation: 1 }, // Booster
            { id: 100, x: 2, y: 0, rotation: 0 }, // Booster *new*
        ],
    },
    {
        // NOTE: Things get pretty subjective after this. Should we prioritize boosting hacking multi or adding more stats?
        //       I've decided to start by adding in Hacking Speed, Hacknet Production + Cost as 3 stats more important than just more boost
        height: 5,
        width: 6,
        fragments: [
            { id: 0, x: 3, y: 0, rotation: 0 }, // Hacking Mult
            { id: 1, x: 3, y: 3, rotation: 0 }, // Hacking Mult
            { id: 5, x: 4, y: 1, rotation: 1 }, // Hacking Speed *new*
            { id: 20, x: 0, y: 4, rotation: 0 }, // Hacknet Production *new*
            { id: 21, x: 0, y: 1, rotation: 0 }, // Hacknet Cost Reduction *new*
            { id: 25, x: 0, y: 0, rotation: 2 }, // Reputation
            { id: 102, x: 0, y: 2, rotation: 2 }, // Booster
        ],
    },
    {
        height: 6,
        width: 6,
        fragments: [
            { id: 0, x: 0, y: 2, rotation: 0 }, // Hacking Mult
            { id: 1, x: 2, y: 2, rotation: 1 }, // Hacking Mult
            { id: 5, x: 3, y: 3, rotation: 1 }, // Hacking Speed
            { id: 20, x: 5, y: 2, rotation: 1 }, // Hacknet Production
            { id: 21, x: 0, y: 0, rotation: 0 }, // Hacknet Cost Reduction
            { id: 25, x: 3, y: 0, rotation: 2 }, // Reputation
            { id: 103, x: 0, y: 4, rotation: 2 }, // Booster
            { id: 104, x: 2, y: 0, rotation: 1 }, // Booster *new*
        ],
    },
    {
        // Special thanks to @Ansopedi (a.k.a. Zoëkeeper) for solving for this layout
        height: 6,
        width: 7,
        fragments: [
            { id: 0, x: 3, y: 2, rotation: 1 }, // Hacking Mult
            { id: 1, x: 1, y: 3, rotation: 0 }, // Hacking Mult
            { id: 5, x: 4, y: 1, rotation: 1 }, // Hacking Speed
            { id: 6, x: 0, y: 0, rotation: 0 }, // Hack power *new*
            { id: 7, x: 4, y: 0, rotation: 2 }, // Grow power *new*
            { id: 20, x: 6, y: 2, rotation: 1 }, // Hacknet Production
            { id: 21, x: 0, y: 4, rotation: 0 }, // Hacknet Cost Reduction
            { id: 25, x: 0, y: 1, rotation: 1 }, // Reputation
            { id: 101, x: 2, y: 4, rotation: 2 }, // Booster
            { id: 102, x: 1, y: 1, rotation: 0 }, // Booster
        ],
    },
    {
        // Note: Late BN12, as Stanek gets bigger, Bladeburner also becomes a faster win condition, so we start adding those stats
        height: 7,
        width: 7,
        fragments: [
            { id: 0, x: 1, y: 5, rotation: 2 }, // Hacking Mult
            { id: 1, x: 3, y: 3, rotation: 0 }, // Hacking Mult
            { id: 5, x: 0, y: 4, rotation: 3 }, // Hacking Speed
            { id: 6, x: 0, y: 0, rotation: 1 }, // Hack power
            { id: 7, x: 1, y: 1, rotation: 1 }, // Grow power
            { id: 20, x: 1, y: 0, rotation: 2 }, // Hacknet Production
            { id: 21, x: 3, y: 1, rotation: 0 }, // Hacknet Cost Reduction
            { id: 25, x: 5, y: 4, rotation: 3 }, // Reputation
            { id: 30, x: 3, y: 5, rotation: 2 }, // Bladeburner Stats *new*
            { id: 101, x: 5, y: 0, rotation: 3 }, // Booster
            { id: 106, x: 1, y: 2, rotation: 3 }, // Booster
        ],
    },
    {
        height: 7,
        width: 8,
        fragments: [
            { id: 0, x: 4, y: 1, rotation: 0 }, // Hacking Mult
            { id: 1, x: 4, y: 4, rotation: 3 }, // Hacking Mult
            { id: 5, x: 0, y: 2, rotation: 0 }, // Hacking Speed
            { id: 6, x: 3, y: 0, rotation: 2 }, // Hack power
            { id: 7, x: 2, y: 0, rotation: 0 }, // Grow power
            { id: 14, x: 0, y: 3, rotation: 1 }, // Dexterity *new*
            { id: 16, x: 5, y: 5, rotation: 2 }, // Agility *new*
            { id: 20, x: 0, y: 6, rotation: 0 }, // Hacknet Production
            { id: 21, x: 0, y: 0, rotation: 0 }, // Hacknet Cost Reduction
            { id: 25, x: 6, y: 0, rotation: 3 }, // Reputation
            { id: 30, x: 2, y: 4, rotation: 0 }, // Bladeburner Stats
            { id: 103, x: 4, y: 3, rotation: 0 }, // Booster
            { id: 105, x: 1, y: 2, rotation: 0 }, // Booster
        ],
    },
    {
        // Adds Charisma, which even a small boost makes a huge difference (hours) in grinding company rep
        height: 8,
        width: 8,
        fragments: [
            // ~BN 12.50
            { id: 0, x: 3, y: 0, rotation: 0 }, // Hacking Mult
            { id: 1, x: 2, y: 2, rotation: 1 }, // Hacking Mult
            { id: 5, x: 0, y: 0, rotation: 3 }, // Hacking Speed
            { id: 6, x: 7, y: 2, rotation: 1 }, // Hack power
            { id: 7, x: 4, y: 5, rotation: 3 }, // Grow power
            { id: 14, x: 3, y: 4, rotation: 3 }, // Dexterity
            { id: 16, x: 5, y: 1, rotation: 1 }, // Agility
            { id: 18, x: 6, y: 5, rotation: 1 }, // Charisma *new*
            { id: 20, x: 0, y: 3, rotation: 3 }, // Hacknet Production
            { id: 21, x: 6, y: 0, rotation: 0 }, // Hacknet Cost Reduction
            { id: 25, x: 2, y: 5, rotation: 3 }, // Reputation
            { id: 30, x: 0, y: 6, rotation: 0 }, // Bladeburner Stats
            { id: 101, x: 1, y: 2, rotation: 3 }, // Booster
            { id: 105, x: 4, y: 2, rotation: 1 }, // Booster
            { id: 106, x: 1, y: 0, rotation: 1 }, // Booster *new* (Thanks @aeroleo)
        ],
    },
    {
        // Took a minute and found a way to cram Defense and Strength in
        height: 8,
        width: 9,
        fragments: [
            { id: 0, x: 4, y: 1, rotation: 0 }, // Hacking Mult
            { id: 1, x: 4, y: 4, rotation: 0 }, // Hacking Mult
            { id: 5, x: 0, y: 2, rotation: 0 }, // Hacking Speed
            { id: 6, x: 3, y: 0, rotation: 2 }, // Hack power
            { id: 7, x: 2, y: 0, rotation: 0 }, // Grow power
            { id: 10, x: 4, y: 6, rotation: 2 }, // Strength *new*
            { id: 12, x: 6, y: 5, rotation: 0 }, // Defense *new*
            { id: 14, x: 1, y: 5, rotation: 1 }, // Dexterity
            { id: 16, x: 7, y: 0, rotation: 3 }, // Agility
            { id: 18, x: 3, y: 4, rotation: 1 }, // Charisma
            { id: 20, x: 0, y: 3, rotation: 3 }, // Hacknet Production
            { id: 21, x: 0, y: 0, rotation: 0 }, // Hacknet Cost Reduction
            { id: 25, x: 4, y: 3, rotation: 2 }, // Reputation
            { id: 30, x: 2, y: 5, rotation: 1 }, // Bladeburner Stats
            { id: 101, x: 6, y: 2, rotation: 1 }, // Booster
            { id: 105, x: 1, y: 2, rotation: 0 }, // Booster
        ],
    },
    {
        // Ample Space ~ BN 12.85 to get more boosts on all stats
        height: 9,
        width: 9,
        fragments: [
            { id: 0, x: 4, y: 1, rotation: 0 }, // Hacking Mult
            { id: 1, x: 4, y: 4, rotation: 0 }, // Hacking Mult
            { id: 5, x: 0, y: 2, rotation: 0 }, // Hacking Speed
            { id: 6, x: 4, y: 0, rotation: 0 }, // Hack power
            { id: 7, x: 2, y: 0, rotation: 0 }, // Grow power
            { id: 10, x: 7, y: 2, rotation: 1 }, // Strength
            { id: 12, x: 5, y: 7, rotation: 0 }, // Defense
            { id: 14, x: 1, y: 5, rotation: 1 }, // Dexterity
            { id: 16, x: 5, y: 6, rotation: 0 }, // Agility
            { id: 18, x: 3, y: 4, rotation: 1 }, // Charisma
            { id: 20, x: 0, y: 3, rotation: 3 }, // Hacknet Production
            { id: 21, x: 0, y: 0, rotation: 0 }, // Hacknet Cost Reduction
            { id: 25, x: 4, y: 3, rotation: 2 }, // Reputation
            { id: 30, x: 2, y: 5, rotation: 1 }, // Bladeburner Stats
            { id: 101, x: 1, y: 7, rotation: 2 }, // Booster *new*
            { id: 101, x: 7, y: 5, rotation: 1 }, // Booster
            { id: 105, x: 1, y: 2, rotation: 0 }, // Booster
            { id: 105, x: 6, y: 0, rotation: 0 }, // Booster *new*
        ],
    },
];

// Not used for anything, but captures our rough priorities when designing the above layouts
const priorities = [
    { id: 25, weight: 13.0 } /* Faction Rep */,
    { id: 0, weight: 12.0 } /* Hack Mult */,
    { id: 1, weight: 11.0 } /* Hack Mult */,
    // Generally prefer adding one of these stats over triple-boosting the above
    { id: 5, weight: 1.15 } /* Hack Speed */,
    { id: 20, weight: 1.14 } /* Hacknet Prod */,
    { id: 21, weight: 1.13 } /* Hacknet Cost */,
    { id: 6, weight: 1.12 } /* Hack Power */,
    { id: 7, weight: 1.11 } /* Grow Power */,
    { id: 30, weight: 1.1 } /* Bladeburner */,
    { id: 16, weight: 1.09 } /* Agi */,
    { id: 14, weight: 1.08 } /* Dex */,
    // Generally prefer additional boost over the below
    { id: 28, weight: 0.99 } /* Crime Money */,
    { id: 18, weight: 0.98 } /* Cha */,
    { id: 10, weight: 0.97 } /* Str */,
    { id: 12, weight: 0.96 } /* Def */,
    { id: 28, weight: 0.95 } /* Work Money */,
];

// Not used, but these alternative layouts favour fitting more stat pieces vs. boosting most important stats, use if you please
const alternativeLayouts = [
    {
        height: 3,
        width: 4,
        fragments: [
            { id: 0, x: 1, y: 0, rotation: 0 }, // Hacking Chance
            { id: 25, x: 0, y: 0, rotation: 1 }, // Reputation
            { id: 28, x: 1, y: 1, rotation: 0 }, // Crime Money
        ],
    },
    {
        height: 4,
        width: 4,
        fragments: [
            { id: 0, x: 0, y: 2, rotation: 2 }, // Hacking Chance
            { id: 7, x: 2, y: 1, rotation: 3 }, // Grow power
            { id: 25, x: 0, y: 0, rotation: 1 }, // Reputation
            { id: 30, x: 1, y: 0, rotation: 0 }, // Bladeburner
        ],
    },
    {
        height: 6,
        width: 6,
        fragments: [
            { id: 0, x: 0, y: 2, rotation: 0 }, // Hacking Chance
            { id: 1, x: 0, y: 4, rotation: 0 }, // Hacking Chance
            { id: 5, x: 2, y: 1, rotation: 0 }, // Hacking Speed
            { id: 6, x: 2, y: 0, rotation: 0 }, // Hack power
            { id: 7, x: 2, y: 3, rotation: 2 }, // Grow power
            { id: 20, x: 5, y: 1, rotation: 1 }, // Hacknet Production
            { id: 21, x: 0, y: 0, rotation: 0 }, // Hacknet Cost Reduction
            { id: 25, x: 3, y: 4, rotation: 0 }, // Reputation
        ],
    },
];
