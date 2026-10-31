import { CLUES, EVENT_FLAGS, type Mood, type Rule } from "./content";
import { moodIndex, mstate, npcRt, phaseReached } from "./state";

export interface Trace {
  ok: boolean;
  label: string;
  actual?: string;
  children?: Trace[];
}

export function evalRule(rule: Rule | undefined): Trace {
  if (!rule) return { ok: true, label: "always" };
  if ("all" in rule) {
    const children = rule.all.map(evalRule);
    return { ok: children.every((c) => c.ok), label: "all of", children };
  }
  if ("any" in rule) {
    const children = rule.any.map(evalRule);
    return { ok: children.some((c) => c.ok), label: "any of", children };
  }
  if ("not" in rule) {
    const c = evalRule(rule.not);
    return { ok: !c.ok, label: "not", children: [c] };
  }
  if ("flag" in rule) {
    const has = mstate.flags.has(rule.flag);
    return { ok: has, label: `on tape: ${rule.flag}`, actual: has ? "yes" : "no" };
  }
  if ("bond" in rule) {
    const has = npcRt(rule.bond).bond;
    return { ok: has, label: `bond with ${rule.bond}`, actual: has ? "yes" : "no" };
  }
  const m = npcRt(rule.mood).mood;
  const ok = moodIndex(m) >= moodIndex(rule.gte as Mood);
  return { ok, label: `${rule.mood} mood >= ${rule.gte}`, actual: m };
}

/**
 * How many recordings a rule is short of passing, counting the recordings its missing flags themselves
 * need (transitive). 0 = passes. Infinity = unreachable by recording alone (an event flag, or a clue
 * that is not in this phase or is gone). Bond and mood are withheld dimensions, not distance.
 */
export function needsDistance(rule: Rule | undefined, seen: Set<string> = new Set()): number {
  if (!rule) return 0;
  if ("all" in rule) return rule.all.reduce((acc, r) => acc + needsDistance(r, seen), 0);
  if ("any" in rule) return Math.min(...rule.any.map((r) => needsDistance(r, seen)));
  if ("not" in rule) return evalRule(rule).ok ? 0 : Infinity;
  if ("flag" in rule) return flagDistance(rule.flag, seen);
  return 0;
}

export function flagDistance(flag: string, seen: Set<string> = new Set()): number {
  if (mstate.flags.has(flag)) return 0;
  if ((EVENT_FLAGS as readonly string[]).includes(flag)) return Infinity;
  if (seen.has(flag)) return Infinity;
  const next = new Set(seen); next.add(flag);
  let best = Infinity;
  for (const c of CLUES) {
    if (!(c.grants ?? [c.id]).includes(flag)) continue;
    if (!phaseReached(c.from ?? "day1")) continue;
    if (c.lockedBy && mstate.flags.has(c.lockedBy)) continue;
    if (c.day !== undefined && c.day !== mstate.day) continue;
    const d = 1 + needsDistance(c.needs, next);
    if (d < best) best = d;
  }
  return best;
}

export function ruleOk(rule: Rule | undefined): boolean {
  return evalRule(rule).ok;
}

/** Every flag a rule mentions (graph edges). */
export function flagsIn(rule: Rule | undefined, out = new Set<string>()): Set<string> {
  if (!rule) return out;
  if ("all" in rule) rule.all.forEach((r) => flagsIn(r, out));
  else if ("any" in rule) rule.any.forEach((r) => flagsIn(r, out));
  else if ("not" in rule) flagsIn(rule.not, out);
  else if ("flag" in rule) out.add(rule.flag);
  return out;
}

export function describeRule(rule: Rule | undefined): string {
  if (!rule) return "nothing";
  if ("all" in rule) return "(" + rule.all.map(describeRule).join(" and ") + ")";
  if ("any" in rule) return "(" + rule.any.map(describeRule).join(" or ") + ")";
  if ("not" in rule) return "not " + describeRule(rule.not);
  if ("flag" in rule) return rule.flag;
  if ("bond" in rule) return `bond:${rule.bond}`;
  return `${rule.mood}>=${rule.gte}`;
}
