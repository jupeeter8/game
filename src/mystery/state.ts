import { MOODS, NPCS, PHASES, type Mood, type Outcome, type Patience, type Phase } from "./content";
import { MTUNING } from "./tuning";

export type Role = "user" | "assistant";
export interface Turn { role: Role; content: string }

export interface NpcRt {
  mood: Mood;
  patience: Patience;
  /** locked-topic questions asked this conversation (steps patience) */
  pushes: number;
  /** day-minute (elapsed) until which the NPC is away; 0 = available */
  awayUntil: number;
  awayDay: number;
  /** clue ids this NPC has voiced */
  voiced: string[];
  history: Turn[];
  bond: boolean;
  /** turns in the open conversation; each costs at least MTUNING.turnMinutes of the day */
  turnsThisConv?: number;
  /** day-minutes already charged for this conversation's lines */
  minutesCharged?: number;
}

export interface TapeEntry {
  /** a clue id, or "quote" for a genuine line that is not a clue */
  clueId: string;
  page: string;
  /** what the NPC actually said, if the player heard it from them */
  heard?: string;
  /** who said it (quotes) */
  speaker?: string;
  /** what the player actually said */
  note: string;
  day: number;
  minute: number;
}

/** 0 = prologue, 1, 2 = investigation days, 3 = after the gathering */
export interface MState {
  phase: "prologue" | "day" | "evening1" | "gathering" | "ended";
  day: number;
  /** activity minutes spent today */
  elapsed: number;
  /** extra conversation minutes earned from minigames */
  convBonus: number;
  turn: number;
  flags: Set<string>;
  tape: TapeEntry[];
  looseNotes: string[];
  /** voiced but not recorded clue ids, in order */
  pool: string[];
  /** the NPC's actual words for each voiced clue (what the player heard, not the canonical text) */
  heard: Record<string, string>;
  npcs: Record<string, NpcRt>;
  minigamesDone: string[];
  /** fired one-shot events */
  fired: string[];
  outcome: Outcome | null;
  accused: string | null;
  log: string[];
}

export function freshMState(): MState {
  return {
    phase: "prologue", day: 0, elapsed: 0, convBonus: 0, turn: 0,
    flags: new Set(), tape: [], looseNotes: [], pool: [], heard: {}, npcs: {}, minigamesDone: [], fired: [],
    outcome: null, accused: null, log: [],
  };
}

export const mstate: MState = freshMState();

export function resetMState(): void {
  Object.assign(mstate, freshMState());
  touch();
}

export function npcRt(id: string): NpcRt {
  let rt = mstate.npcs[id];
  if (!rt) {
    const def = NPCS[id];
    rt = { mood: def?.startMood ?? "neutral", patience: "fresh", pushes: 0, awayUntil: 0, awayDay: 0, voiced: [], history: [], bond: false };
    mstate.npcs[id] = rt;
  }
  return rt;
}

export function moodIndex(m: Mood): number {
  return MOODS.indexOf(m);
}

export function shiftMood(id: string, steps: number): Mood {
  const rt = npcRt(id);
  const i = Math.max(0, Math.min(MOODS.length - 1, moodIndex(rt.mood) + steps));
  rt.mood = MOODS[i];
  return rt.mood;
}

export function setMood(id: string, m: Mood): void {
  npcRt(id).mood = m;
}

export function pushHistory(id: string, t: Turn): void {
  const h = npcRt(id).history;
  h.push(t);
  if (h.length > MTUNING.historyTurns) h.splice(0, h.length - MTUNING.historyTurns);
}

export function currentPhase(): Phase {
  if (mstate.phase === "prologue") return "party";
  if (mstate.phase === "evening1") return "evening";
  if (mstate.phase === "day") return mstate.day >= 2 ? "day2" : "day1";
  return "day2";
}

export function phaseReached(p: Phase): boolean {
  return PHASES.indexOf(currentPhase()) >= PHASES.indexOf(p);
}

export function minutesLeft(): number {
  return Math.max(0, MTUNING.dayMinutes - mstate.elapsed);
}

export function convLimitMinutes(): number {
  return Math.min(MTUNING.convMinutesMax, MTUNING.convMinutes + mstate.convBonus);
}

export function log(line: string): void {
  mstate.log.push(`[d${mstate.day} ${Math.round(mstate.elapsed)}m] ${line}`);
}

// --- change notification ---
const listeners = new Set<() => void>();
export function onChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function touch(): void {
  for (const fn of listeners) fn();
}

// --- serialisation ---
export interface SerializedM {
  v: 1;
  s: Omit<MState, "flags"> & { flags: string[] };
}

export function serializeM(): SerializedM {
  return JSON.parse(JSON.stringify({ v: 1, s: { ...mstate, flags: [...mstate.flags] } })) as SerializedM;
}

export function deserializeM(d: SerializedM): void {
  const s = d.s;
  Object.assign(mstate, freshMState(), { ...s, flags: new Set(s.flags ?? []) });
  touch();
}

export const MSTATE_KEY = "willowmere.state.v1";

export function saveM(): void {
  try { localStorage.setItem(MSTATE_KEY, JSON.stringify(serializeM())); } catch { /* ignore */ }
}

export function loadM(): boolean {
  try {
    const raw = localStorage.getItem(MSTATE_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw) as SerializedM;
    if (d?.v !== 1) return false;
    deserializeM(d);
    return true;
  } catch { return false; }
}

export function clearM(): void {
  try { localStorage.removeItem(MSTATE_KEY); } catch { /* ignore */ }
}
