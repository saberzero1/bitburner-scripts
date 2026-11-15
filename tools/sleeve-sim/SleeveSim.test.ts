/**
 * Sleeve karma simulation (copied into bitburner-src/test/jest by tools/sleeve-sim/run.sh).
 * Real Sleeve objects from a BitNode start (shock 100, no exp, intelligence SIM_INT) under a task policy that mirrors
 * sleeve.js's gang-karma phase, until karma reaches -54000. The player adds SIM_PLAYER_KARMA karma/s (homicide).
 * Env: SIM_POLICY (JSON, see `policy` below), SIM_SLEEVES (8), SIM_INT (900), SIM_EXP_MULT (BN12: 0.231 for
 * ClassGymExpGain and CrimeExpGain), SIM_PLAYER_KARMA (1), SIM_HOURS (cap, 30), SIM_OUT.
 */
import fs from "fs";
import { Player } from "@player";
import { currentNodeMults } from "../../src/BitNode/BitNodeMultipliers";
import { Sleeve } from "../../src/PersonObjects/Sleeve/Sleeve";
import { Crimes } from "../../src/Crime/Crimes";
import { getNS, initGameEnvironment, setupBasicTestingEnvironment } from "./Utilities";

initGameEnvironment();
const env = process.env;

type Policy = {
  recoverAbove: number; // recover while shock is above this (sleeve.js --min-shock-recovery, 90)
  randomRecovery: number; // chance per minute of a recovery minute while shock > 0 (sleeve.js --shock-recovery, 0.05)
  train: Record<string, number>; // gym targets, e.g. {str:105,def:105,dex:70,agi:70}
  trainUntilH: number; // stop training this long into the BitNode (sleeve.js --training-cap-seconds, 2h)
  crime: string; // "Homicide", "Mug", or "best" (whichever gives more karma/s at the current chance)
  recoverySleeves: number; // this many sleeves do shock recovery until shock 0 (their exp share still flows in)
};
const policy: Policy = {
  recoverAbove: 90, randomRecovery: 0.05, train: { str: 105, def: 105, dex: 70, agi: 70 }, trainUntilH: 2,
  crime: "Homicide", recoverySleeves: 0, ...JSON.parse(env.SIM_POLICY ?? "{}"),
};

test(
  "sleeve karma simulation",
  async () => {
    setupBasicTestingEnvironment();
    Player.sourceFiles.set(5, 3);
    Player.sourceFiles.set(10, 3);
    const int = Number(env.SIM_INT ?? 900);
    Player.skills.intelligence = int;
    currentNodeMults.ClassGymExpGain = Number(env.SIM_EXP_MULT ?? 0.231);
    currentNodeMults.CrimeExpGain = Number(env.SIM_EXP_MULT ?? 0.231);
    Player.money = 1e15; // gym fees aren't the constraint here
    Player.karma = 0;
    const n = Number(env.SIM_SLEEVES ?? 8);
    Player.sleeves = Array.from({ length: n }, () => {
      const sl = new Sleeve();
      sl.shock = 100;
      sl.sync = 100;
      sl.memory = 100;
      sl.skills.intelligence = int;
      return sl;
    });
    const api = (getNS() as unknown as { sleeve: Record<string, (...a: unknown[]) => unknown> }).sleeve;
    const STAT = { str: "strength", def: "defense", dex: "dexterity", agi: "agility" } as Record<string, string>;
    const chance = (sl: Sleeve, crime: string) => Math.min(1, Crimes[crime as keyof typeof Crimes].successRate(sl));
    const karmaRate = (sl: Sleeve, crime: string) => {
      const c = Crimes[crime as keyof typeof Crimes];
      return (c.karma * chance(sl, crime)) / (c.time / 1000);
    };
    const current: string[] = [];
    const recoveryRoll: boolean[] = [];
    const assign = (i: number, key: string, fn: () => void) => {
      if (current[i] !== key) {
        fn();
        current[i] = key;
      }
    };
    const playerKarma = Number(env.SIM_PLAYER_KARMA ?? 1);
    const maxS = Number(env.SIM_HOURS ?? 30) * 3600;
    const samples: Record<string, unknown>[] = [];
    let t = 0;
    for (; t < maxS && Player.karma > -54000; t++) {
      if (t % 60 === 0) for (let i = 0; i < n; i++) recoveryRoll[i] = Math.random() < policy.randomRecovery;
      if (t % 5 === 0)
        Player.sleeves.forEach((sl, i) => {
          if (sl.shock > 0 && (i < policy.recoverySleeves || sl.shock > policy.recoverAbove || recoveryRoll[i]))
            return assign(i, "recover", () => api.setToShockRecovery(i));
          const untrained = Object.keys(policy.train).filter((s) => sl.skills[STAT[s] as "strength"] < policy.train[s]);
          if (untrained.length > 0 && t < policy.trainUntilH * 3600) {
            const s = untrained.reduce((a, b) => (sl.skills[STAT[a] as "strength"] <= sl.skills[STAT[b] as "strength"] ? a : b));
            return assign(i, "gym " + s, () => api.setToGymWorkout(i, "Powerhouse Gym", s));
          }
          const crime = policy.crime === "best" ? (karmaRate(sl, "Homicide") >= karmaRate(sl, "Mug") ? "Homicide" : "Mug") : policy.crime;
          assign(i, crime, () => api.setToCommitCrime(i, crime));
        });
      for (const sl of Player.sleeves) sl.process(5);
      Player.karma -= playerKarma;
      if (t % 1800 === 0) {
        const s0 = Player.sleeves[n - 1];
        samples.push({ h: +(t / 3600).toFixed(2), karma: Math.round(Player.karma), shock: +s0.shock.toFixed(1), str: s0.skills.strength,
          homicide: +chance(s0, "Homicide").toFixed(3), task: current[n - 1] });
      }
    }
    fs.writeFileSync(env.SIM_OUT ?? "/tmp/sleevesim.json", JSON.stringify({ policy, hours: t / 3600, done: Player.karma <= -54000, samples }));
  },
  6 * 3600 * 1000,
);
