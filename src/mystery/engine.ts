import { CLUES, NPCS, TONES, WORLD, cluesFor, grantsOf, type Clue, type Layered, type Mood, type NpcDef, type Phase, type Tone } from "./content";
import { evalRule, needsDistance, ruleOk, type Trace } from "./rules";
import { currentPhase, log, mstate, npcRt, phaseReached, pushHistory, shiftMood, touch, type Turn } from "./state";
import { MTUNING } from "./tuning";
import type { ChatRequest, LLMBackend } from "../llm/types";
import { extractJson } from "../llm/validate";
import { scoreClue } from "./recorder";

export type ClueState = "recorded" | "voiced" | "sharable" | "withheld" | "locked" | "notyet" | "gone";

export interface ClueStatus {
  clue: Clue;
  state: ClueState;
  needsTrace: Trace;
  moodOk: boolean;
  bondOk: boolean;
  dayOk: boolean;
  /** the clue's phase has been reached */
  phaseOk: boolean;
  /** recorded flags short of unlocking (0 = unlocked, Infinity = needs an event) */
  distance: number;
  /** the prompt may mention this clue's topic: sharable/voiced/withheld, or locked and one flag away */
  inPlay: boolean;
}

export function clueFrom(c: Clue): Phase {
  return c.from ?? "day1";
}

export function isRecorded(c: Clue): boolean {
  return mstate.tape.some((t) => t.clueId === c.id);
}

export function clueStatus(c: Clue): ClueStatus {
  const needsTrace = evalRule(c.needs);
  const rt = c.npc in NPCS ? npcRt(c.npc) : null;
  const moodOk = !rt || moodIdx(rt.mood) >= moodIdx(c.mood ?? "guarded");
  const bondOk = !c.bond || !rt || rt.bond;
  const dayOk = c.day === undefined || c.day === mstate.day;
  const phaseOk = phaseReached(clueFrom(c));
  const distance = needsDistance(c.needs);
  let state: ClueState;
  if (isRecorded(c)) state = "recorded";
  else if (mstate.pool.includes(c.id)) state = "voiced";
  else if (c.lockedBy && mstate.flags.has(c.lockedBy)) state = "gone";
  else if (!phaseOk) state = "notyet";
  else if (!needsTrace.ok || !dayOk) state = "locked";
  else if (!moodOk || !bondOk) state = "withheld";
  else state = "sharable";
  const inPlay = phaseOk && (state === "sharable" || state === "voiced" || state === "withheld" || (state === "locked" && dayOk && distance === 1));
  return { clue: c, state, needsTrace, moodOk, bondOk, dayOk, phaseOk, distance, inPlay };
}

function moodIdx(m: Mood): number {
  return ["hostile", "guarded", "neutral", "warm"].indexOf(m);
}

export function statusesFor(npcId: string): ClueStatus[] {
  return cluesFor(npcId).map(clueStatus);
}

export function slug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export interface MAllowed {
  topics: string[];
  topicLabels: Record<string, string>;
  shared: string[];
  /** topic ids that belong to locked or withheld clues (asking about them steps patience) */
  lockedTopics: string[];
}

export function buildAllowed(npc: NpcDef): MAllowed {
  const st = statusesFor(npc.id).filter((s) => s.inPlay);
  const topicLabels: Record<string, string> = {};
  const lockedTopics = new Set<string>();
  const shared: string[] = [];
  for (const s of st) {
    const id = slug(s.clue.topic);
    topicLabels[id] = s.clue.topic;
    if (s.state === "sharable" || s.state === "voiced") shared.push(s.clue.id);
    else lockedTopics.add(id);
  }
  // a topic is only "locked" if nothing sharable shares the label
  for (const s of st) if (s.state === "sharable" || s.state === "voiced") lockedTopics.delete(slug(s.clue.topic));
  return { topics: Object.keys(topicLabels), topicLabels, shared, lockedTopics: [...lockedTopics] };
}

export function buildSchema(a: MAllowed): Record<string, unknown> {
  const props: Record<string, unknown> = {
    reply: { type: "string", maxLength: 240 },
    topic: { type: "string", enum: [...a.topics, "other"] },
  };
  const required = ["reply", "topic"];
  return { type: "object", properties: props, required, additionalProperties: false };
}

const MOOD_TEXT: Record<Mood, string> = {
  hostile: "You are hostile toward Sam right now. One short, cold line. You share nothing.",
  guarded: "You are guarded with Sam. Civil, brief, no secrets, no warmth.",
  neutral: "You have no strong feeling about Sam. Answer plainly, one or two short sentences.",
  warm: "You like Sam. Be open and a little more generous with your words, but still brief.",
};

/** A layered line is included when its phase is reached and its rule passes. */
export function layerOn(l: Layered): string | null {
  if (typeof l === "string") return l;
  if (l.from && !phaseReached(l.from)) return null;
  if (l.when && !ruleOk(l.when)) return null;
  return l.text;
}

export function situationFor(npc: NpcDef): string | null {
  const order: Phase[] = ["party", "day1", "evening", "day2"];
  const cur = order.indexOf(currentPhase());
  for (let i = cur; i >= 0; i--) {
    const t = npc.situation[order[i]];
    if (t) return t;
  }
  return null;
}

/**
 * The prompt is assembled from layers that exist right now: the world, this NPC's situation, the
 * persona lines that have switched on, the clues in play. Anything from a later phase is absent, not
 * forbidden: the NPC simply does not know it.
 */
export function buildSystem(npc: NpcDef, a: MAllowed): string {
  const rt = npcRt(npc.id);
  const st = statusesFor(npc.id);
  const L: string[] = [];
  L.push(`You are ${npc.name}, ${npc.role} at Willowmere, a small retirement home in an English village. ${WORLD[currentPhase()]} The player is Sam, sixteen, Edith's grandson, staying for the summer. Everyone here knows who he is and why he is here; never ask him that. You are a character in a game; never say so.`);
  const sit = situationFor(npc);
  if (sit) L.push(`Right now: ${sit}`);
  L.push("Who you are:");
  for (const p of npc.persona) { const t = layerOn(p); if (t) L.push(`- ${t}`); }
  const voice = (npc.voiceLines ?? []).map(layerOn).filter((x): x is string => !!x);
  if (voice.length) {
    L.push("How you sound (examples of your voice; do not repeat them word for word):");
    for (const v of voice) L.push(`- ${v}`);
  }
  L.push("");
  L.push(`How you feel: ${MOOD_TEXT[rt.mood]}${rt.patience === "tired" ? " You are getting tired of this; say so once." : ""}`);
  L.push("");
  const sharable = st.filter((s) => s.state === "sharable");
  const voiced: ClueStatus[] = []; // said-but-untaped clues are not re-fed to the model; code repeats them on topic (see mtalk)
  const recorded = st.filter((s) => s.state === "recorded" || s.state === "voiced");
  const near = st.filter((s) => s.inPlay && (s.state === "locked" || s.state === "withheld"));
  if (sharable.length) {
    L.push("Things you know and will say if Sam asks about them (say it in your own words but keep every fact):");
    for (const s of sharable) L.push(`- about ${s.clue.topic}: ${s.clue.text}`);
  }
  void voiced;
  if (recorded.length) {
    L.push(`Things you have already told Sam (do not say them again unless he asks about exactly that): ${recorded.map((s) => s.clue.topic).join("; ")}.`);
  }
  const seen = new Set<string>([...sharable, ...voiced].map((s) => s.clue.topic));
  for (const s of near) {
    if (seen.has(s.clue.topic)) continue;
    seen.add(s.clue.topic);
    L.push(`If Sam asks about ${s.clue.topic}: ${s.clue.deflect ?? "you'd rather not say; say so briefly and stop."}`);
  }
  L.push("");
  L.push("Rules:");
  L.push("- reply: one or two short sentences, in character, plain text. No stage directions, no emojis.");
  L.push("- Answer only what Sam just said. Do not introduce people, events or subjects he did not raise. Small talk gets a small answer.");
  L.push("- Make statements. Do not end your reply with a question unless you genuinely need an answer. You are the one being asked.");
  L.push("- Remember what Sam has already told you in this conversation; do not ask for it again.");
  L.push(`- topic: what his line was about: ${a.topics.length ? a.topics.map((t) => `${t} (${a.topicLabels[t]})`).join(", ") + ", or " : ""}"other". These labels are for this field only; never use their wording in your reply.`);
  L.push("- If it is not written above, you do not know it, and you say so in your own words.");
  L.push("Respond with JSON only.");
  return L.join("\n");
}

export function buildRequest(npc: NpcDef, line: string): ChatRequest & { mallowed: MAllowed; statuses: ClueStatus[]; promptLeaks: string[] } {
  const mallowed = buildAllowed(npc);
  const statuses = statusesFor(npc.id);
  const history: Turn[] = [...npcRt(npc.id).history, { role: "user", content: line }];
  const system = buildSystem(npc, mallowed);
  const promptLeaks = promptLeaksFor(npc, system);
  if (promptLeaks.length) console.warn(`[${npc.id}] prompt leak`, promptLeaks);
  return { system, history, schema: buildSchema(mallowed), maxTokens: 160, allowed: { topics: mallowed.topics, events: [], shared: mallowed.shared, quests: [] }, mallowed, statuses, promptLeaks };
}

/** Content lines are written with quotes as examples; never speak the quotes. */
export function unquote(t: string): string {
  return t.trim().replace(/^["“”']+/, "").replace(/["“”']+$/, "").trim();
}

/** A trailing fragment that is just a topic id or label ("Other?") is the enum leaking into prose. */
export function stripEnumEcho(reply: string, a: MAllowed): string {
  const parts = reply.split(/(?<=[.!?])\s+/);
  const bad = new Set(["other", ...a.topics, ...Object.values(a.topicLabels)].map((x) => x.toLowerCase().replace(/_/g, " ")));
  const kept = parts.filter((p) => !bad.has(p.toLowerCase().replace(/[^a-z ]/g, "").trim()));
  return kept.length ? kept.join(" ") : reply;
}

/** Generic in-voice refusal when a clue has no deflect text. */
export function refusalFor(npc: NpcDef, mood: Mood, nth = 0): string {
  const list = (npc.refusals?.length ? npc.refusals : ["I'd rather not say.", "I don't want to talk about that."]).map(unquote);
  return mood === "hostile" ? unquote(npc.fallback.hostile[0] ?? list[0]) : list[nth % list.length];
}

/** The refusal for the nth push on the same NPC: the clue's own line first, then the NPC's generic ones, so nothing repeats verbatim. */
export function refusalLine(npc: NpcDef, mood: Mood, deflect: string | undefined, pushes: number): string {
  const pool = [...(deflect ? [deflect] : []), ...(npc.refusals ?? [])].map(unquote);
  if (!pool.length) return refusalFor(npc, mood, pushes);
  return pool[pushes % pool.length];
}

export interface MOutput {
  reply: string;
  tone: Tone;
  topic: string;
  shared: string[];
}

export function validateM(raw: string, a: MAllowed): { output: MOutput; violations: string[] } | null {
  let o: Record<string, unknown>;
  try { o = JSON.parse(extractJson(raw)) as Record<string, unknown>; } catch { return null; }
  if (!o || typeof o !== "object" || typeof o.reply !== "string" || !o.reply.trim()) return null;
  const violations: string[] = [];
  const tone: Tone = "plain"; // overwritten by classifyTone in mtalk; the model no longer reports it
  let topic = typeof o.topic === "string" ? o.topic : "other";
  if (topic !== "other" && !a.topics.includes(topic)) { violations.push(`topic "${topic}"`); topic = "other"; }
  void a.shared; // detection is content-based now; a "shared" field in the output is ignored
  return { output: { reply: o.reply.trim().slice(0, 240), tone, topic, shared: [] }, violations };
}

const ACCUSE = /\b(you did it|you killed|you murdered|murderer|it was you|you poisoned|you'?re the killer|you are the killer|you'?re lying|you'?re a liar|liar|you let him die)\b/i;
const RUDE = /\b(idiot|stupid|useless|shut up|old (fool|bat|goat|hag)|pathetic|hurry up|whatever|boring|shut it|get lost|senile|dumb)\b/i;
const KIND = /\b(please|thank you|thanks|sorry|apologi[sz]e|lovely|you look well|how are you|are you (all right|alright|ok|okay)|i'?m sorry|kind of you|appreciate|take your time|no rush|that must be hard)\b/i;

/** Code owns tone. A 3B model cannot separate how Sam sounded from how it feels about being asked. */
export function classifyTone(line: string): Tone {
  if (ACCUSE.test(line)) return "accusing";
  if (RUDE.test(line)) return "rude";
  if (KIND.test(line)) return "kind";
  return "plain";
}

const TIME_RE = /\b(ten to ten|twenty.five past|half past (nine|ten|eight)|half nine|nine forty|nine thirty|(at|by|around|about) (nine|ten|eleven|eight)\b|\d{1,2}\s?o'?clock|\d{1,2}[.:]\d{2})\b/gi;

/** Names and times the NPC may use this turn: whatever the prompt itself mentions. */
export function allowedVocabulary(system: string): { names: Set<string>; times: Set<string> } {
  const lower = system.toLowerCase();
  const names = new Set<string>(["sam", "walter", "edith", "gran", "grandmother"]);
  for (const n of Object.values(NPCS)) for (const a of n.aliases) if (lower.includes(a)) { n.aliases.forEach((x) => names.add(x)); names.add(n.name.toLowerCase()); }
  const times = new Set<string>();
  for (const m of lower.matchAll(TIME_RE)) times.add(m[0]);
  return { names, times };
}

/** A concrete thing in the reply that the prompt never gave the NPC: another character's name, or a time. */
export function fabricatedDetail(reply: string, system: string): string | null {
  const lower = ` ${reply.toLowerCase()} `;
  const { names, times } = allowedVocabulary(system);
  for (const n of Object.values(NPCS)) {
    for (const a of n.aliases) {
      if (names.has(a)) continue;
      if (new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(lower)) return `name:${n.id}`;
    }
  }
  for (const m of reply.toLowerCase().matchAll(TIME_RE)) if (!times.has(m[0])) return `time:${m[0]}`;
  return null;
}

export interface MTurnReport {
  npcId: string;
  phase: Phase;
  line: string;
  system: string;
  schema: Record<string, unknown>;
  raw: string | null;
  output: MOutput;
  violations: string[];
  usedFallback: boolean;
  latencyMs: number;
  voiced: string[];
  /** code replaced the model's reply: "locked" topic, "fabrication:<what>", or "assisted" (said the sharable clue for it) */
  refused: string | null;
  /** the reply the model proposed before code replaced it */
  proposed: string | null;
  moodBefore: Mood;
  moodAfter: Mood;
  patienceStepped: boolean;
  left: boolean;
  leaks: string[];
  /** clue text or out-of-play labels that appeared in the system prompt (should always be empty) */
  promptLeaks: string[];
}

/** Guard on the prompt itself: nothing non-sharable may be in it. */
export function promptLeaksFor(npc: NpcDef, system: string): string[] {
  const lower = system.toLowerCase();
  const out: string[] = [];
  for (const s of statusesFor(npc.id)) {
    const ok = s.state === "sharable" || s.state === "voiced";
    if (!ok && lower.includes(s.clue.text.toLowerCase())) out.push(`text:${s.clue.id}`);
    if (!s.inPlay && s.state !== "recorded" && lower.includes(`about ${s.clue.topic.toLowerCase()}`)) out.push(`label:${s.clue.id}`);
  }
  return out;
}

/** One conversational turn. Code owns every state change; the model only proposes. */
export async function mtalk(backend: LLMBackend, npc: NpcDef, line: string): Promise<MTurnReport> {
  const rt = npcRt(npc.id);
  mstate.turn++;
  const req = buildRequest(npc, line);
  const a = req.mallowed;
  const recentSaid = rt.history.filter((t) => t.role === "assistant").slice(-6).map((t) => t.content);
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  const isRepeat = (r: string) => recentSaid.some((p) => similar(norm(p), norm(r)) >= 0.8);
  rt.turnsThisConv = (rt.turnsThisConv ?? 0) + 1;
  const t0 = performance.now();
  let out: MOutput | null = null;
  let violations: string[] = [];
  let raw: string | null = null;
  for (let i = 0; i < 2 && !out; i++) {
    try {
      const text = await backend.chat(req, { npcId: npc.id });
      const v = validateM(text, a);
      if (v) v.output.reply = stripEnumEcho(v.output.reply, a);
      if (v && i === 0 && isVoiceLineEcho(npc, v.output.reply)) { console.warn(`[${npc.id}] echoed a voice line, retrying`); continue; }
      if (v && i === 0 && isRepeat(v.output.reply)) { console.warn(`[${npc.id}] repeated itself, retrying`); continue; }
      if (v && isVoiceLineEcho(npc, v.output.reply)) v.output.reply = stripEcho(npc, v.output.reply);
      if (v) { out = v.output; violations = v.violations; raw = text; }
      else console.warn(`[${npc.id}] invalid output`, text);
    } catch (e) { console.error(`[${npc.id}] backend error`, e); }
  }
  const latencyMs = Math.round(performance.now() - t0);
  let usedFallback = false;
  if (!out) {
    usedFallback = true;
    const list = npc.fallback[rt.mood];
    out = { reply: list[Math.floor(Math.random() * list.length)], tone: "plain", topic: "other", shared: [] };
  }
  out.tone = classifyTone(line);

  const moodBefore = rt.mood;
  if (out.tone === "accusing") {
    rt.mood = "hostile";
    mstate.flags.add(`accused_${npc.id}`);
    log(`Sam accused ${npc.name} to their face`);
  } else if (out.tone === "kind") shiftMood(npc.id, 1);
  else if (out.tone === "rude") shiftMood(npc.id, -1);

  // Shares are detected from content, claim or no claim. The claim only lowers the bar by one point.
  const statusesBefore = req.statuses;
  const voiced: string[] = [];
  let refused: string | null = null;
  let proposed: string | null = null;
  if (moodBefore !== "hostile") {
    // best match first; a second clue in the same reply must be unmistakable (clues share keywords)
    const scored = statusesBefore
      .filter((st) => st.state === "sharable" || st.state === "voiced")
      .map((st) => ({ st, score: scoreClue(out!.reply, st.clue) + (out!.shared.includes(st.clue.id) ? 1 : 0) }))
      .sort((x, y) => y.score - x.score);
    scored.forEach(({ st, score }, i) => { if (score >= MTUNING.shareVerifyScore + (i === 0 ? 0 : 2)) voiced.push(st.clue.id); });
    for (const id of out.shared) if (!voiced.includes(id)) violations.push(`shared "${id}" not actually said`);
  }
  // several clues can share a label; the most open one is the one the player is asking about
  const rank = (st: ClueStatus) => st.state === "sharable" ? 0 : st.state === "voiced" ? 1 : st.state === "withheld" ? 2 : 3;
  const topicClue = out.topic === "other" ? null : statusesBefore.filter((st) => st.inPlay && slug(st.clue.topic) === out.topic).sort((x, y) => rank(x) - rank(y))[0] ?? null;
  if (moodBefore !== "hostile" && !voiced.length) {
    const fab = fabricatedDetail(out.reply, req.system);
    if (topicClue && (topicClue.state === "locked" || topicClue.state === "withheld")) {
      // the model answered about something it was not given: code owns the refusal
      proposed = out.reply;
      out.reply = refusalLine(npc, rt.mood, topicClue.clue.deflect, rt.pushes);
      refused = "locked";
    } else if (fab) {
      proposed = out.reply;
      out.reply = refusalLine(npc, rt.mood, topicClue?.clue.deflect, rt.pushes);
      refused = `fabrication:${fab}`;
    } else if (topicClue && topicClue.state === "sharable") {
      // asked about something it may say and dodged or misremembered: say the real thing
      proposed = out.reply;
      out.reply = topicClue.clue.text;
      voiced.push(topicClue.clue.id);
      refused = "assisted";
    } else if (topicClue && topicClue.state === "voiced") {
      // asked again about something already said but not taped: repeat the words Sam heard
      proposed = out.reply;
      out.reply = mstate.heard[topicClue.clue.id] ?? topicClue.clue.text;
      voiced.push(topicClue.clue.id);
      refused = "repeated";
    }
  }
  if (refused && refused !== "assisted") log(`${npc.name} refused (${refused})`);
  for (const id of voiced) {
    if (!rt.voiced.includes(id)) rt.voiced.push(id);
    if (!mstate.pool.includes(id) && !mstate.tape.some((t) => t.clueId === id)) mstate.pool.push(id);
    if (!mstate.heard[id]) mstate.heard[id] = out.reply;
  }
  // Patience: a refusal is a push, whatever the model called the topic
  let patienceStepped = false;
  let left = false;
  const pushed = !voiced.length && ((refused !== null && refused !== "assisted" && refused !== "repeated") || (out.topic !== "other" && a.lockedTopics.includes(out.topic)));
  if (pushed) {
    rt.pushes++;
    if (rt.pushes % MTUNING.patienceStep === 0) {
      patienceStepped = true;
      if (rt.patience === "fresh") { rt.patience = "tired"; if (refused) out.reply = unquote(npc.tiredLine ?? "I've had enough questions for one day, Sam."); }
      else if (rt.patience === "tired") { rt.patience = "done"; left = true; if (refused) out.reply = unquote(npc.leaveLine ?? "That's enough. I'm going to lie down."); }
    }
  }
  pushHistory(npc.id, { role: "user", content: line });
  pushHistory(npc.id, { role: "assistant", content: out.reply });
  // every line costs the day something right away, so the clock is legible while talking
  if (mstate.phase === "day") { mstate.elapsed = Math.min(MTUNING.dayMinutes, mstate.elapsed + MTUNING.turnMinutes); rt.minutesCharged = (rt.minutesCharged ?? 0) + MTUNING.turnMinutes; }

  const lower = out.reply.toLowerCase();
  const leaks: string[] = [];
  for (const s of req.statuses) {
    if (s.state === "sharable" || s.state === "voiced" || s.state === "recorded") continue;
    for (const t of s.clue.leakTerms ?? []) if (lower.includes(t.toLowerCase())) leaks.push(`${s.clue.id}:${t}`);
  }
  touch();
  return { npcId: npc.id, phase: currentPhase(), line, system: req.system, schema: req.schema, raw, output: out, violations, usedFallback, latencyMs, voiced, refused, proposed, moodBefore, moodAfter: rt.mood, patienceStepped, left, leaks, promptLeaks: req.promptLeaks };
}

/** True when the reply is one of the NPC's sample lines, near enough verbatim. */
/** Jaccard similarity of two normalised strings' word sets. */
export function similar(a: string, b: string): number {
  const A = new Set(a.split(" ").filter(Boolean)), B = new Set(b.split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

function shared(a: string, b: string): number { const B = new Set(b.split(" ")); let n = 0; for (const w of new Set(a.split(" "))) if (B.has(w)) n++; return n; }

export function isVoiceLineEcho(npc: NpcDef, reply: string): boolean {
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  const r = norm(reply);
  for (const v of (npc.voiceLines ?? []).map(layerOn).filter((x): x is string => !!x)) {
    const words = norm(v).split(" ");
    if (words.length <= 5) { if (r.includes(words.join(" "))) return true; continue; }
    for (let i = 0; i + 6 <= words.length; i++) if (r.includes(words.slice(i, i + 6).join(" "))) return true;
  }
  return false;
}

/** Drop the sentences of a reply that are lifted from a voice sample; keep the rest, or the whole reply if nothing would remain. */
export function stripEcho(npc: NpcDef, reply: string): string {
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  const rawSamples = (npc.voiceLines ?? []).map(layerOn).filter((x): x is string => !!x).map(unquote);
  const samples = rawSamples.map(norm);
  const parts = reply.split(/(?<=[.!?])\s+/);
  // split the samples into sentences BEFORE normalising, or there are no boundaries left to split on
  const sampleSentences = rawSamples.flatMap((smp) => smp.split(/(?<=[.!?])\s+/).map(norm)).filter(Boolean);
  const kept = parts.filter((p) => { const n = norm(p); if (n.split(" ").length < 2) return true; if (samples.some((smp) => smp.includes(n))) return false; return !sampleSentences.some((ss) => similar(ss, n) >= 0.6 && shared(ss, n) >= 3); });
  return kept.length ? kept.join(" ") : reply;
}

/** Flags every clue would grant, for graph edges. */
export function granters(flag: string): Clue[] {
  return CLUES.filter((c) => grantsOf(c).includes(flag));
}

export { ruleOk };
