import { CLUES, DERIVED, MINIGAMES, NPCS, RESIDENT_IDS, SCENES, clueById, grantsOf, type Outcome } from "./content";
import { matchNote, matchQuote, type MatchResult } from "./recorder";
import { ruleOk } from "./rules";
import { convLimitMinutes, log, minutesLeft, mstate, npcRt, phaseReached, shiftMood, touch } from "./state";
import { MTUNING } from "./tuning";

/** Everything that changes state outside a model reply goes through here. */

export interface SceneEvent { kind: "scene"; id: string; lines: readonly string[] }
const sceneQueue: SceneEvent[] = [];
export function pendingScenes(): SceneEvent[] { return sceneQueue.splice(0); }
function queue(id: string, lines: readonly string[]): void { sceneQueue.push({ kind: "scene", id, lines }); }

export function startGame(): void {
  mstate.phase = "prologue";
  mstate.day = 0;
  // the party line is voiced in the prologue; it can be recorded any time after
  if (!mstate.pool.includes("scene_teetotal")) mstate.pool.push("scene_teetotal");
  // Rose's wish is said unprompted on arrival
  queue("prologue", SCENES.prologue);
  touch();
}

export function beginDay(day: number): void {
  mstate.day = day;
  mstate.elapsed = 0;
  mstate.phase = "day";
  for (const id of Object.keys(mstate.npcs)) {
    const rt = npcRt(id);
    rt.awayUntil = 0;
    rt.patience = "fresh";
    rt.pushes = 0;
    // a night's sleep takes the edge off hostility; goodwill earned stays earned
    if (day > 1 && (rt.mood === "hostile" || rt.mood === "guarded")) shiftMood(id, 1);
  }
  if (day === 1) queue("discovery", SCENES.discovery);
  if (day === 2) {
    queue("morning2", SCENES.morning2);
    if (mstate.flags.has("wheelchair_requested") && !mstate.flags.has("wheelchair_built")) {
      mstate.flags.add("wheelchair_built");
      npcRt("rose").bond = true;
      queue("wheelchair", SCENES.wheelchair);
      log("the wheelchair arrived");
    }
  }
  log(`day ${day} begins`);
  touch();
  if (day === 2) checkChandelier();
}

/** Spend activity minutes; ends the day when the budget is gone. */
export function spendMinutes(m: number): void {
  if (mstate.phase !== "day") return;
  mstate.elapsed = Math.min(MTUNING.dayMinutes, mstate.elapsed + Math.max(0, m));
  if (minutesLeft() <= 0) endDay();
  touch();
}

export function endDay(): void {
  if (mstate.phase !== "day") return;
  if (mstate.day === 1) {
    mstate.phase = "evening1";
    queue("evening1", SCENES.evening1);
    log("day 1 ends; the engineer is in the hall");
  } else {
    mstate.phase = "gathering";
    queue("gathering", SCENES.gathering);
    log("day 2 ends; the gathering");
  }
  touch();
}

export function afterEvening(): void {
  if (mstate.phase !== "evening1") return;
  beginDay(2);
}

export function npcAvailable(id: string): { ok: boolean; why: string } {
  const def = NPCS[id];
  if (!def) return { ok: false, why: "unknown" };
  if (mstate.phase === "prologue") { const here = ["edith", "pugh", "rose", "marguerite", "tomasz", "pearl"].includes(id); return { ok: here, why: here ? "at the party" : "not here" }; }
  if (mstate.phase === "evening1") return { ok: id === "bodkin", why: id === "bodkin" ? "in the hall" : "at supper" };
  if (mstate.phase !== "day") return { ok: false, why: "" };
  if (def.evening) return { ok: false, why: "comes this evening" };
  if (def.window) {
    if (def.window.day !== mstate.day) return { ok: false, why: def.window.day > mstate.day ? `visits day ${def.window.day}` : "gone" };
    if (mstate.elapsed >= def.window.untilMinute) return { ok: false, why: "left" };
    return { ok: true, why: `leaves in ${Math.ceil(def.window.untilMinute - mstate.elapsed)} min` };
  }
  const rt = npcRt(id);
  if (rt.awayDay === mstate.day && rt.awayUntil > mstate.elapsed) return { ok: false, why: `away ${Math.ceil(rt.awayUntil - mstate.elapsed)} min` };
  return { ok: true, why: "" };
}

/** Called when a conversation closes. `reason`: left (patience done), tired (clock), player. */
export function endConversation(id: string, activeMinutes: number, reason: "left" | "tired" | "player"): void {
  const rt = npcRt(id);
  // lines were charged as they were spoken; on close, charge whatever active time exceeded that
  activeMinutes = Math.max(0, activeMinutes - (rt.minutesCharged ?? 0));
  rt.turnsThisConv = 0;
  rt.minutesCharged = 0;
  rt.patience = "fresh";
  rt.pushes = 0;
  if (reason !== "player") {
    rt.awayUntil = mstate.elapsed + activeMinutes + MTUNING.awayMinutes;
    rt.awayDay = mstate.day;
    log(`${NPCS[id].name} ${reason === "left" ? "walked off" : "tired out"}`);
  }
  if (mstate.phase === "day") spendMinutes(activeMinutes);
  touch();
}

export function convLimitMs(): number { return convLimitMinutes() * 60000; }

/** Record a spoken note. Returns the match; applies flags and derived flags on success. */
export interface RecordResult extends MatchResult { recorded: boolean; newFlags: string[]; derived: string[]; chandelier: boolean }
export function record(note: string): RecordResult {
  const m = matchNote(note, mstate.pool);
  const res: RecordResult = { ...m, recorded: false, newFlags: [], derived: [], chandelier: false };
  const text = note.trim();
  if (!text) return res;
  if (!m.clue) {
    const q = matchQuote(text);
    if (q) {
      mstate.tape.push({ clueId: "quote", page: q.speaker, note: text, heard: q.line, speaker: q.speaker, day: mstate.day, minute: Math.round(mstate.elapsed) });
      res.recorded = true;
      res.page = q.speaker;
      log(`taped a quote from ${q.speaker}`);
    } else mstate.looseNotes.push(text);
    touch();
    return res;
  }
  mstate.pool = mstate.pool.filter((id) => id !== m.clue!.id);
  mstate.tape.push({ clueId: m.clue.id, page: m.page, note: text, heard: mstate.heard[m.clue.id], day: mstate.day, minute: Math.round(mstate.elapsed) });
  for (const f of grantsOf(m.clue)) if (!mstate.flags.has(f)) { mstate.flags.add(f); res.newFlags.push(f); }
  res.recorded = true;
  res.derived = finalizeFlags();
  log(`taped ${m.clue.id} under ${m.page}`);
  res.chandelier = checkChandelier();
  touch();
  return res;
}

/** Evaluate derived flags. Returns newly set ones. */
export function finalizeFlags(): string[] {
  const out: string[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const d of DERIVED) {
      if (mstate.flags.has(d.flag)) continue;
      if (ruleOk(d.when)) { mstate.flags.add(d.flag); out.push(d.flag); changed = true; }
    }
  }
  return out;
}

export function closeness(): number {
  return CLUES.filter((c) => c.critical && mstate.tape.some((t) => t.clueId === c.id)).length;
}

export function checkChandelier(): boolean {
  if (mstate.day !== 2 || mstate.phase !== "day" || mstate.fired.includes("chandelier")) return false;
  if (closeness() < MTUNING.chandelierCloseness) return false;
  mstate.fired.push("chandelier");
  mstate.flags.add("chandelier_fell");
  const saved = mstate.flags.has("wheelchair_built");
  queue("chandelier", saved ? SCENES.chandelierSaved : SCENES.chandelier);
  npcRt("marguerite").mood = "guarded";
  mstate.flags.add("marguerite_tidying");
  log(saved ? "the chandelier fell; Rose got there first" : "the chandelier fell");
  if (!saved) spendMinutes(MTUNING.chandelierMinutes);
  // Edith's chain clue becomes askable; voice it at once so it's on the pool the next time Sam listens
  touch();
  return true;
}

/** Looking around the hall: voices the loose clues. Costs a minute. */
export function lookAround(): string[] {
  const found: string[] = [];
  for (const c of CLUES) {
    if (c.npc !== "loose" || !phaseReached(c.from ?? "day1") || mstate.pool.includes(c.id) || mstate.tape.some((t) => t.clueId === c.id)) continue;
    mstate.pool.push(c.id);
    found.push(c.id);
  }
  spendMinutes(1);
  log(found.length ? `looked around: ${found.join(", ")}` : "looked around: nothing new");
  touch();
  return found;
}

export function completeMinigame(id: string, won: boolean): void {
  const g = MINIGAMES[id];
  if (!g) return;
  spendMinutes(g.minutes);
  if (won) {
    npcRt(g.npc).bond = true;
    if (!mstate.minigamesDone.includes(id)) {
      mstate.minigamesDone.push(id);
      mstate.convBonus = Math.min(MTUNING.convMinutesMax - MTUNING.convMinutes, mstate.convBonus + MTUNING.minigameBonusMinutes);
    }
    if (g.npc === "pearl") {
      // finding the brooch also surfaces the box, if Pearl has mentioned the papers
      log("found the brooch");
    }
  }
  log(`${g.title}: ${won ? "done" : "gave up"}`);
  touch();
}

/** The evening sit-down with Edith: her bond event. */
export function sitWithEdith(): void {
  npcRt("edith").bond = true;
  spendMinutes(1);
  log("sat with Edith");
  touch();
}

export function reassure(id: "tomasz" | "rose"): void {
  npcRt(id).bond = true;
  log(`reassured ${id}`);
  touch();
}

export function canVouch(): boolean {
  return mstate.flags.has("wheelchair_built") && !mstate.flags.has("rose_vouch_used");
}

/** Rose, mobile at last, smooths things over with one NPC. Once. */
export function vouch(id: string): boolean {
  if (!canVouch() || !NPCS[id] || id === "rose") return false;
  const rt = npcRt(id);
  rt.mood = "neutral";
  rt.patience = "fresh";
  rt.pushes = 0;
  rt.awayUntil = 0;
  mstate.flags.delete(`accused_${id}`);
  mstate.flags.add("rose_vouch_used");
  log(`Rose vouched for Sam with ${NPCS[id].name}`);
  touch();
  return true;
}

export function proofs(): string[] {
  return ["proof_means", "proof_motive", "proof_opportunity"].filter((f) => mstate.flags.has(f));
}

export function decide(accused: string | null): { outcome: Outcome; hint: readonly string[] } {
  if (accused === "pugh") return { outcome: "O1", hint: [] };
  if (accused === "marguerite" && mstate.flags.has("pugh_knew") && proofs().length >= 2) return { outcome: "O2", hint: [] };
  if (!accused) return { outcome: "O3", hint: SCENES.O3_hint_nobody };
  if (accused === "marguerite") return { outcome: "O3", hint: mstate.flags.has("pugh_knew") ? SCENES.O3_hint_proof : SCENES.O3_hint_pugh };
  return { outcome: "O3", hint: SCENES.O3_hint_pugh };
}

export function accuse(accused: string | null): Outcome {
  const d = decide(accused);
  mstate.outcome = d.outcome;
  mstate.accused = accused;
  mstate.phase = "ended";
  queue(d.outcome, [...SCENES[d.outcome], ...d.hint]);
  log(`accused ${accused ?? "nobody"}: ${d.outcome}`);
  touch();
  return d.outcome;
}

export function residentsPresent(): string[] {
  return RESIDENT_IDS;
}

export { clueById };
