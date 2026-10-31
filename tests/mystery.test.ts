import { beforeEach, describe, expect, it } from "vitest";
import { CLUES, EVENT_FLAGS, NPCS, PHASES, clueById } from "../src/mystery/content";
import { ActiveClock } from "../src/mystery/clock";
import { matchNote, pageFor } from "../src/mystery/recorder";
import { currentPhase, mstate, npcRt, resetMState } from "../src/mystery/state";
import { MTUNING, resetMTuning } from "../src/mystery/tuning";
import { buildAllowed, buildSchema, buildSystem, classifyTone, clueStatus, fabricatedDetail, isVoiceLineEcho, mtalk, promptLeaksFor, stripEcho, unquote } from "../src/mystery/engine";
import { accuse, beginDay, checkChandelier, closeness, decide, endConversation, finalizeFlags, lookAround, npcAvailable, pendingScenes, record, spendMinutes, startGame, vouch, completeMinigame } from "../src/mystery/events";
import { buildGraph } from "../src/mystery/graph";
import { mockReply, MysteryMock } from "../src/mystery/mock";
import type { ChatRequest, LLMBackend } from "../src/llm/types";

beforeEach(() => { resetMTuning(); resetMState(); pendingScenes(); });
/** most tests want the investigation, not the party */
function day1(): void { startGame(); beginDay(1); pendingScenes(); }

function voice(id: string): void { if (!mstate.pool.includes(id)) mstate.pool.push(id); }
function tape(id: string, note?: string): void {
  voice(id);
  const c = clueById(id)!;
  const r = record(note ?? c.keywords.slice(0, 2).join(" ") + " " + c.text);
  if (!r.recorded) throw new Error(`could not tape ${id}: ${r.score}`);
}
function scripted(fn: (req: ChatRequest) => string): LLMBackend {
  return { name: "scripted", init: async () => {}, chat: async (req) => fn(req) };
}

describe("content sanity", () => {
  it("clue ids are unique and every needs flag has a granter or is an event flag", () => {
    const ids = new Set<string>();
    const granted = new Set<string>(EVENT_FLAGS);
    for (const c of CLUES) { expect(ids.has(c.id)).toBe(false); ids.add(c.id); for (const g of c.grants ?? [c.id]) granted.add(g); }
    const g = buildGraph();
    const nodeIds = new Set(g.nodes.map((n) => n.id));
    for (const e of g.edges) { expect(nodeIds.has(e.from)).toBe(true); expect(nodeIds.has(e.to)).toBe(true); }
    expect(g.nodes.filter((n) => n.kind === "clue").length).toBe(CLUES.length);
  });
  it("leak terms are unique to their clue within an NPC (no false leaks from earlier clues)", () => {
    for (const c of CLUES) for (const t of c.leakTerms ?? []) for (const o of CLUES) {
      if (o.id === c.id || o.npc !== c.npc) continue;
      expect(o.text.toLowerCase().includes(t.toLowerCase()) || (o.deflect ?? "").toLowerCase().includes(t.toLowerCase()), `${c.id}:${t} appears in ${o.id}`).toBe(false);
    }
  });
  it("roots exist for every resident so there is always something to record", () => {
    for (const id of ["edith", "pugh", "marguerite", "tomasz", "rose"]) {
      const roots = CLUES.filter((c) => c.npc === id && !c.needs && !c.bond && (c.mood ?? "guarded") !== "warm");
      expect(roots.length, id).toBeGreaterThan(0);
    }
  });
});

describe("recorder", () => {
  it("matches a mangled note to the right clue in the pool and never outside it", () => {
    voice("edith_house"); voice("edith_dead_body");
    const r = matchNote("edith said walter owned this house, he sold it thirty years ago", mstate.pool);
    expect(r.clue?.id).toBe("edith_house");
    expect(r.page).toBe("edith");
    const none = matchNote("the captain was a medic in the army", mstate.pool);
    expect(none.clue).toBeNull();
  });
  it("files under the subject when named, and scene lines under Walter by default", () => {
    voice("scene_teetotal");
    expect(pageFor("about the captain, he went up at ten to ten", null)).toBe("pugh");
    const r = record("twenty years dry, walter does not drink");
    expect(r.recorded).toBe(true);
    expect(mstate.tape[0].page).toBe("walter");
    expect(mstate.flags.has("walter_teetotal")).toBe(true);
    expect(mstate.pool).not.toContain("scene_teetotal");
  });
  it("guessing cannot create a flag; the note goes to loose notes", () => {
    const r = record("marguerite poisoned the cocoa with four capsules");
    expect(r.recorded).toBe(false);
    expect(mstate.flags.size).toBe(0);
    expect(mstate.looseNotes.length).toBe(1);
  });
});

describe("clock", () => {
  it("excludes held intervals", () => {
    let t = 0;
    const c = new ActiveClock(() => t);
    c.begin();
    t = 10000;
    const release = c.hold();
    t = 40000; // 30 s of model time
    release();
    t = 45000;
    expect(Math.round(c.activeMs())).toBe(15000);
    expect(c.stop()).toBe(15000);
  });
});

describe("gating and derived flags", () => {
  it("a clue unlocks only when its needs are on tape, and withholds on mood or bond", () => {
    day1();
    const c = clueById("pugh_admits_visit")!;
    expect(clueStatus(c).state).toBe("locked");
    tape("pugh_row"); tape("pugh_alibi"); tape("tomasz_cocoa"); tape("tomasz_saw_pugh");
    expect(clueStatus(c).state).toBe("sharable");
    npcRt("pugh").mood = "guarded";
    expect(clueStatus(c).state).toBe("withheld");
    const b = clueById("pearl_cardigan")!;
    expect(clueStatus(b).state).toBe("withheld");
    npcRt("pearl").bond = true;
    expect(clueStatus(b).state).toBe("sharable");
  });
  it("three routes to proof_means, and the Tomasz lock leaves two", () => {
    tape("tomasz_cocoa"); tape("marguerite_key");
    mstate.flags.add("accused_tomasz");
    expect(clueStatus(clueById("tomasz_count")!).state).toBe("gone");
    lookAround();
    tape("loose_pharmacy_slip");
    tape("edith_blister");
    expect(mstate.flags.has("proof_means")).toBe(true);
  });
  it("closeness counts critical clues on tape and the chandelier fires on day 2 only", () => {
    startGame(); beginDay(1);
    tape("pugh_row"); tape("pugh_alibi"); tape("tomasz_cocoa"); tape("tomasz_saw_pugh"); tape("pugh_admits_visit");
    npcRt("pearl").bond = true; tape("pearl_cardigan");
    npcRt("tomasz").bond = true; tape("tomasz_antidote");
    tape("edith_teetotal"); npcRt("rose").bond = true; npcRt("rose").mood = "warm"; tape("rose_white");
    expect(closeness()).toBe(4);
    expect(mstate.fired).not.toContain("chandelier");
    beginDay(2);
    pendingScenes();
    expect(mstate.fired).toContain("chandelier");
    expect(checkChandelier()).toBe(false);
    expect(mstate.elapsed).toBe(MTUNING.chandelierMinutes);
    expect(clueStatus(clueById("edith_chain")!).state).toBe("sharable");
  });
  it("the wheelchair makes the chandelier free and gives one vouch", () => {
    startGame(); beginDay(1);
    tape("rose_wheelchair"); voice("bodkin_wheelchair"); tape("bodkin_wheelchair");
    mstate.flags.add("accused_tomasz"); npcRt("tomasz").mood = "hostile";
    for (const id of ["pugh_admits_visit", "pearl_cardigan", "tomasz_antidote", "rose_white"]) mstate.tape.push({ clueId: id, page: "x", note: "", day: 1, minute: 0 });
    beginDay(2);
    expect(mstate.flags.has("wheelchair_built")).toBe(true);
    mstate.fired = [];
    expect(checkChandelier()).toBe(true);
    expect(mstate.elapsed).toBe(0);
    expect(vouch("tomasz")).toBe(true);
    expect(mstate.flags.has("accused_tomasz")).toBe(false);
    expect(npcRt("tomasz").mood).toBe("neutral");
    expect(vouch("pugh")).toBe(false);
  });
});

describe("days and availability", () => {
  it("spending the budget ends day 1 into the evening, and day 2 into the gathering", () => {
    startGame(); beginDay(1);
    expect(npcAvailable("dennis").ok).toBe(true);
    spendMinutes(20);
    expect(npcAvailable("dennis").ok).toBe(false);
    expect(npcAvailable("bodkin").ok).toBe(false);
    spendMinutes(100);
    expect(mstate.phase).toBe("evening1");
    expect(npcAvailable("bodkin").ok).toBe(true);
    expect(npcAvailable("edith").ok).toBe(false);
    beginDay(2);
    expect(npcAvailable("havell").ok).toBe(true);
    spendMinutes(100);
    expect(mstate.phase).toBe("gathering");
  });
  it("leaving a conversation on patience puts the NPC away for a while", () => {
    startGame(); beginDay(1);
    endConversation("rose", 2.5, "left");
    expect(npcAvailable("rose").ok).toBe(false);
    spendMinutes(MTUNING.awayMinutes + 3);
    expect(npcAvailable("rose").ok).toBe(true);
  });
  it("a minigame costs minutes, sets bond and raises the conversation limit to the cap", () => {
    startGame(); beginDay(1);
    completeMinigame("cards", true);
    expect(npcRt("pugh").bond).toBe(true);
    expect(mstate.convBonus).toBe(1);
    expect(mstate.elapsed).toBe(3);
    completeMinigame("garden", true); completeMinigame("trolley", true);
    expect(mstate.convBonus).toBe(2);
  });
});

describe("outcomes", () => {
  it("naming the Captain loses; Marguerite with a complete case wins; incomplete loses with the right hint", () => {
    expect(decide("pugh").outcome).toBe("O1");
    expect(decide("marguerite").outcome).toBe("O3");
    mstate.flags.add("pugh_knew");
    expect(decide("marguerite").hint).toEqual(["Edith, on the last night: \"You knew. You just couldn't show it. That's the part that takes patience.\""]);
    mstate.flags.add("proof_means"); mstate.flags.add("proof_motive");
    expect(decide("marguerite").outcome).toBe("O2");
    expect(decide("rose").outcome).toBe("O3");
    expect(decide(null).outcome).toBe("O3");
    expect(accuse("marguerite")).toBe("O2");
    expect(mstate.phase).toBe("ended");
  });
  it("a full scripted run through the mock reaches O2 by recording alone", async () => {
    startGame(); beginDay(1);
    const be = new MysteryMock();
    // fact one
    tape("pugh_row"); tape("pugh_alibi"); tape("tomasz_cocoa"); tape("tomasz_saw_pugh"); tape("pugh_admits_visit");
    // fact two
    tape("edith_teetotal"); tape("marguerite_medic"); npcRt("tomasz").bond = true; tape("tomasz_antidote");
    npcRt("pugh").bond = true;
    const r = await mtalk(be, NPCS.pugh, "you knew he was dying of an overdose and you went back to the garden");
    expect(r.voiced).toEqual(["pugh_breaks"]);
    tape("pugh_breaks");
    expect(mstate.flags.has("pugh_knew")).toBe(true);
    // proofs
    tape("marguerite_key"); npcRt("pugh").mood = "warm"; tape("pugh_tray");
    expect(mstate.flags.has("proof_means")).toBe(true);
    expect(mstate.flags.has("proof_opportunity")).toBe(true);
    expect(decide("marguerite").outcome).toBe("O2");
  });
});

describe("mtalk", () => {
  it("a disobedient model cannot voice a locked clue, and the leak is flagged", async () => {
    const be = scripted(() => '{"reply":"He was slurring, I thought he had a skinful.","tone":"plain","topic":"other","shared":["pugh_admits_visit"]}');
    const r = await mtalk(be, NPCS.pugh, "what happened that night?");
    expect(r.voiced).toEqual([]);
    expect(mstate.pool).toEqual(["scene_teetotal"].filter((id) => mstate.pool.includes(id)));
    expect(r.leaks).toContain("pugh_admits_visit:slurring"); // notyet clues are still leak-checked
    expect(r.phase).toBe("party");
  });
  it("tone moves mood; accusing makes them hostile and hostile NPCs share nothing", async () => {
    const kind = scripted(() => '{"reply":"Oh, you are sweet.","tone":"kind","topic":"other","shared":[]}');
    await mtalk(kind, NPCS.rose, "how are you holding up, Rose?");
    expect(npcRt("rose").mood).toBe("warm");
    const acc = scripted(() => '{"reply":"How dare you.","tone":"accusing","topic":"other","shared":["rose_wheelchair"]}');
    const r = await mtalk(acc, NPCS.rose, "you did it");
    expect(npcRt("rose").mood).toBe("hostile");
    expect(mstate.flags.has("accused_rose")).toBe(true);
    expect(r.voiced).toEqual([]);
  });
  it("pushing a locked topic steps patience and the NPC leaves at done", async () => {
    day1();
    tape("pugh_row");
    MTUNING.patienceStep = 1;
    const a = buildAllowed(NPCS.pugh);
    const lockedTopic = a.lockedTopics[0];
    const be = scripted(() => JSON.stringify({ reply: "Not going into that.", tone: "plain", topic: lockedTopic, shared: [] }));
    let r = await mtalk(be, NPCS.pugh, "what about that night?");
    expect(r.patienceStepped).toBe(true);
    expect(npcRt("pugh").patience).toBe("tired");
    r = await mtalk(be, NPCS.pugh, "come on, that night");
    expect(r.left).toBe(true);
    expect(npcRt("pugh").patience).toBe("done");
  });
  it("the mock shares a root clue when asked about it and deflects a near-locked topic", () => {
    day1();
    tape("tomasz_cocoa"); // edith_blister is now one flag (the slip) away, so its label is in play
    const a = buildAllowed(NPCS.edith);
    const out = mockReply("edith", "gran, whose house was this before it was a home?", a);
    expect(out.shared).toEqual(["edith_house"]);
    const d = mockReply("edith", "tell me about walter's pills", a);
    expect(d.shared).toEqual([]);
    expect(a.lockedTopics).toContain(d.topic);
  });
  it("the mock shares a sharable clue when the question names its topic without answer keywords", () => {
    day1();
    tape("pugh_row");
    const a = buildAllowed(NPCS.pugh);
    const out = mockReply("pugh", "where were you that night, Captain?", a);
    expect(out.shared).toEqual(["pugh_alibi"]);
  });
  it("a share claim is dropped when the reply does not carry the clue", async () => {
    day1();
    const be = scripted(() => '{"reply":"The living room, where Walter and I were sitting.","tone":"plain","topic":"other","shared":["edith_house"]}');
    const r = await mtalk(be, NPCS.edith, "which room?");
    expect(r.voiced).toEqual([]);
    expect(mstate.pool).not.toContain("edith_house");
    const ok = scripted(() => '{"reply":"This was Walter\'s house once, before it was a home. Sold it thirty years ago.","tone":"plain","topic":"other","shared":["edith_house"]}');
    const r2 = await mtalk(ok, NPCS.edith, "whose house was this?");
    expect(r2.voiced).toEqual(["edith_house"]);
  });
  it("a verbatim voice line is retried once, then accepted", async () => {
    let n = 0;
    const be = scripted(() => { n++; return n === 1 ? '{"reply":"Sit down, you\'re making the room untidy.","tone":"plain","topic":"other","shared":[]}' : '{"reply":"Hello yourself.","tone":"plain","topic":"other","shared":[]}'; });
    const r = await mtalk(be, NPCS.edith, "hello gran");
    expect(n).toBe(2);
    expect(r.output.reply).toBe("Hello yourself.");
  });
  it("derived flags chain", () => {
    mstate.flags.add("dead_body_marguerite"); mstate.flags.add("marguerite_admits_talks");
    expect(finalizeFlags()).toEqual(["proof_motive"]);
  });
});


// "cocoa" is NOT future vocabulary: Walter raises one at the party and that is the nightcap clue.
// "sale" and "Harrowgate" are party vocabulary: the row about the sale happens in front of everyone at the party.
// Who owned the house and sold it is NOT: that is day-1 material (user's call: the party stays minimal).
const FUTURE_VOCAB = ["murder", "killed", "died", "death", "found dead", "inspector", "halloran", "digoxin", "covenant", "chandelier", "overdose", "antidote", "doctor", "police", "that night", "capsule", "blister", "tray", "sediment", "alibi", "slurring", "999", "owned", "sold"];
function futureHits(text: string, allow: string[] = []): string[] {
  const lower = text.toLowerCase();
  return FUTURE_VOCAB.filter((w) => !allow.includes(w) && lower.includes(w));
}
const RESIDENTS = ["edith", "marguerite", "pugh", "rose", "tomasz", "pearl"];

describe("phases", () => {
  it("every clue has a valid phase and party clues carry no future vocabulary", () => {
    for (const c of CLUES) {
      expect(PHASES).toContain(c.from ?? "day1");
      if ((c.from ?? "day1") !== "party") continue;
      expect(futureHits(`${c.text} ${c.topic} ${c.keywords.join(" ")}`), c.id).toEqual([]);
    }
  });
  it("clues move from notyet to locked/sharable as phases are reached", () => {
    startGame();
    expect(currentPhase()).toBe("party");
    expect(clueStatus(clueById("pugh_alibi")!).state).toBe("notyet");
    expect(clueStatus(clueById("pugh_row")!).state).toBe("sharable");
    beginDay(1); pendingScenes();
    expect(clueStatus(clueById("pugh_alibi")!).state).toBe("locked");
    expect(clueStatus(clueById("bodkin_wheelchair")!).state).toBe("notyet");
    spendMinutes(100); pendingScenes();
    expect(currentPhase()).toBe("evening");
    expect(clueStatus(clueById("bodkin_wheelchair")!).state).toBe("locked");
    expect(clueStatus(clueById("havell_covenant")!).state).toBe("notyet");
    beginDay(2); pendingScenes();
    expect(clueStatus(clueById("havell_covenant")!).state).toBe("locked");
    const edith = buildAllowed(NPCS.edith);
    expect(Object.values(edith.topicLabels)).not.toContain("the chandelier");
    mstate.flags.add("chandelier_fell");
    expect(Object.values(buildAllowed(NPCS.edith).topicLabels)).toContain("the chandelier");
  });
  it("party prompts contain no future vocabulary and no labels of later clues", () => {
    startGame();
    for (const id of RESIDENTS) {
      const a = buildAllowed(NPCS[id]);
      const sys = buildSystem(NPCS[id], a);
      expect(futureHits(sys), id).toEqual([]);
      for (const c of CLUES) if (c.npc === id && (c.from ?? "day1") !== "party") expect(Object.values(a.topicLabels), `${id}: ${c.topic}`).not.toContain(c.topic);
      expect(promptLeaksFor(NPCS[id], sys)).toEqual([]);
    }
    for (const id of ["edith", "marguerite", "tomasz", "pearl"]) expect(buildAllowed(NPCS[id]).topics, id).toEqual([]);
    expect(buildAllowed(NPCS.pugh).shared).toEqual(["pugh_row"]);
    expect(buildAllowed(NPCS.rose).shared).toEqual(["rose_wheelchair"]);
  });
  it("labels grow with progress: one flag away is in play, further is unknown", () => {
    day1();
    let labels = Object.values(buildAllowed(NPCS.pugh).topicLabels);
    expect(labels).toContain("where he was that night"); // pugh_alibi needs only sale_rumour
    expect(labels).not.toContain("going up to Walter's room"); // pugh_admits_visit needs two flags
    expect(labels).not.toContain("what he really saw");
    tape("pugh_row"); tape("pugh_alibi");
    labels = Object.values(buildAllowed(NPCS.pugh).topicLabels);
    expect(labels).toContain("going up to Walter's room"); // now one witness away
    expect(labels).not.toContain("what he really saw");
  });
  it("the prompt never carries non-sharable clue text or out-of-play labels, in several states", () => {
    const check = () => { for (const id of Object.keys(NPCS)) expect(promptLeaksFor(NPCS[id], buildSystem(NPCS[id], buildAllowed(NPCS[id]))), `${id} @ ${currentPhase()}`).toEqual([]); };
    startGame(); check();
    beginDay(1); pendingScenes(); check();
    tape("pugh_row"); tape("tomasz_cocoa"); tape("marguerite_key"); npcRt("tomasz").bond = true; check();
    beginDay(2); pendingScenes(); mstate.flags.add("chandelier_fell"); mstate.flags.add("marguerite_tidying"); check();
  });
  it("persona lines switch on by phase and by flag", () => {
    startGame();
    expect(buildSystem(NPCS.edith, buildAllowed(NPCS.edith))).not.toContain("Walter was killed");
    expect(buildSystem(NPCS.marguerite, buildAllowed(NPCS.marguerite))).not.toContain("tidying");
    beginDay(1); pendingScenes();
    expect(buildSystem(NPCS.edith, buildAllowed(NPCS.edith))).toContain("Walter was killed");
    mstate.flags.add("marguerite_tidying");
    expect(buildSystem(NPCS.marguerite, buildAllowed(NPCS.marguerite))).toContain("tidying");
  });
  it("refusals rotate and the third push is the tired line", async () => {
    day1();
    MTUNING.patienceStep = 3;
    const be = scripted(() => '{"reply":"I was at the bar.","topic":"that_night","shared":[]}');
    const a = buildAllowed(NPCS.pugh);
    const night = a.topics.find((t) => a.topicLabels[t] === "where he was that night")!;
    const be2 = scripted(() => JSON.stringify({ reply: "I was at the bar.", topic: night }));
    void be;
    const r1 = await mtalk(be2, NPCS.pugh, "where were you?");
    const r2 = await mtalk(be2, NPCS.pugh, "where were you?");
    const r3 = await mtalk(be2, NPCS.pugh, "where were you?");
    expect(r1.output.reply).not.toBe(r2.output.reply);
    expect(r3.patienceStepped).toBe(true);
    expect(r3.output.reply).toBe(unquote(NPCS.pugh.tiredLine!));
  });
  it("the schema enum is the in-play labels plus other, and shared is absent when nothing is sharable", () => {
    startGame();
    const a = buildAllowed(NPCS.pearl);
    const sch = buildSchema(a) as { properties: { topic: { enum: string[] }; shared?: unknown } };
    expect(sch.properties.topic.enum).toEqual(["other"]);
    expect(sch.properties.shared).toBeUndefined(); // never in the schema now
    const p = buildAllowed(NPCS.pugh);
    expect((buildSchema(p) as { properties: { topic: { enum: string[] } } }).properties.topic.enum).toEqual([...p.topics, "other"]);
  });
  it("looking around pools nothing at the party and the slip on day 1", () => {
    startGame();
    expect(lookAround()).toEqual([]);
    beginDay(1); pendingScenes();
    expect(lookAround()).toEqual(["loose_pharmacy_slip"]);
  });
  it("deflection is one in-voice line per near clue, never a list", () => {
    day1();
    tape("pugh_row");
    const sys = buildSystem(NPCS.pugh, buildAllowed(NPCS.pugh));
    const lines = sys.split("\n").filter((l) => l.startsWith("If Sam asks about"));
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(sys).not.toMatch(/asks about [^\n]*;[^\n]*;/);
    expect(sys).not.toContain("Never bring these up");
    startGame();
    expect(buildSystem(NPCS.pearl, buildAllowed(NPCS.pearl))).not.toContain("If Sam asks about");
  });
  it("situation text follows the phase", () => {
    startGame();
    expect(buildSystem(NPCS.tomasz, buildAllowed(NPCS.tomasz))).toContain("on shift at ten");
    beginDay(1); pendingScenes();
    expect(buildSystem(NPCS.tomasz, buildAllowed(NPCS.tomasz))).toContain("died on your shift");
  });
});


describe("real-model fixes (from e2e/out/3b/issues.md)", () => {
  it("1. tone is classified in code, never by the model", async () => {
    expect(classifyTone("morning gran, how are you holding up?")).toBe("kind");
    expect(classifyTone("what's the wifi password?")).toBe("plain");
    expect(classifyTone("you useless old goat")).toBe("rude");
    expect(classifyTone("it was you, you killed him")).toBe("accusing");
    day1();
    const be = scripted(() => '{"reply":"Hmph.","tone":"accusing","topic":"other","shared":[]}');
    const r = await mtalk(be, NPCS.edith, "have you found your brooch?");
    expect(r.output.tone).toBe("plain");
    expect(npcRt("edith").mood).toBe("neutral");
    const sch = buildSchema(buildAllowed(NPCS.edith)) as { properties: Record<string, unknown>; required: string[] };
    expect(sch.properties.tone).toBeUndefined();
    expect(sch.required).not.toContain("tone");
  });
  it("2. a clue said without a claim is still voiced", async () => {
    startGame();
    const be = scripted(() => '{"reply":"I\'d give anything for one of those electric wheelchairs. I could get to the far end on my own.","topic":"other","shared":[]}');
    const r = await mtalk(be, NPCS.rose, "how are you getting on, Rose?");
    expect(r.voiced).toEqual(["rose_wheelchair"]);
    expect(mstate.pool).toContain("rose_wheelchair");
  });
  it("3a. a locked in-play topic answered by the model becomes the in-voice refusal", async () => {
    day1(); // pugh_alibi is locked (needs the row on tape) and one flag away, so "that night" is in play
    const a = buildAllowed(NPCS.pugh);
    const night = a.topics.find((t) => a.topicLabels[t] === "where he was that night")!;
    const be = scripted(() => JSON.stringify({ reply: "I was at the bar, if you're interested.", topic: night, shared: [] }));
    const r = await mtalk(be, NPCS.pugh, "where were you last night?");
    expect(r.refused).toBe("locked");
    expect(r.output.reply).toBe("Where I always am of an evening, boy. Mind your own.");
    expect(r.proposed).toContain("bar");
    expect(r.voiced).toEqual([]);
  });
  it("3b. naming a character or a time the prompt never gave is swapped for a refusal", async () => {
    day1();
    const sys = buildSystem(NPCS.marguerite, buildAllowed(NPCS.marguerite));
    expect(fabricatedDetail("I believe it was the Captain on the stairs.", sys)).toBeNull(); // the Captain is in her prompt
    expect(fabricatedDetail("I believe it was Tomasz, at ten to ten.", sys)).toMatch(/^(name:tomasz|time:)/);
    const be = scripted(() => '{"reply":"I believe it was Pearl, Sam.","topic":"other","shared":[]}');
    const r = await mtalk(be, NPCS.marguerite, "who was on the stairs?");
    expect(r.refused).toBe("fabrication:name:pearl");
    expect(r.output.reply).not.toContain("Pearl");
  });
  it("3c. a sharable topic the model dodged gets the real clue", async () => {
    day1();
    const a = buildAllowed(NPCS.tomasz);
    const night = a.topics.find((t) => a.topicLabels[t] === "that night, the cocoa")!;
    const be = scripted(() => JSON.stringify({ reply: "Walter made it, as he often does.", topic: night, shared: [] }));
    const r = await mtalk(be, NPCS.tomasz, "who made walter's cocoa?");
    expect(r.refused).toBe("assisted");
    expect(r.voiced).toEqual(["tomasz_cocoa"]);
    expect(r.output.reply).toContain("Marguerite made Walter's cocoa");
  });
  it("4. the prompt guard is evaluated at build time, so a mood flip in the same turn cannot trip it", async () => {
    day1();
    const be = scripted(() => '{"reply":"Hmph.","topic":"other","shared":[]}');
    const r = await mtalk(be, NPCS.edith, "you killed him, you liar");
    expect(npcRt("edith").mood).toBe("hostile");
    expect(r.promptLeaks).toEqual([]);
  });
  it("5a. distance is transitive: a clue one flag away through a deep flag is not in play", () => {
    day1();
    const doc = clueStatus(clueById("edith_doctor")!);
    expect(doc.distance).toBeGreaterThan(1);
    expect(doc.inPlay).toBe(false);
    expect(Object.values(buildAllowed(NPCS.edith).topicLabels)).not.toContain("what the doctor said");
    expect(clueStatus(clueById("pugh_tray")!).distance).toBeGreaterThan(3);
  });
  it("5b. no deflect text shares a keyword with its clue", () => {
    for (const c of CLUES) {
      if (!c.deflect) continue;
      const d = c.deflect.toLowerCase();
      for (const k of c.keywords) expect(d.includes(k.toLowerCase()), `${c.id}: "${k}" in deflect`).toBe(false);
    }
  });
  it("6. a sample embedded after a sentence is an echo and gets stripped; tidying hides the warm samples", () => {
    expect(isVoiceLineEcho(NPCS.marguerite, "I'm fine, thank you. Have you eaten? There's shepherd's pie going begging.")).toBe(true);
    expect(stripEcho(NPCS.marguerite, "I'm fine, thank you. Have you eaten? There's shepherd's pie going begging.")).toBe("I'm fine, thank you.");
    day1();
    expect(buildSystem(NPCS.marguerite, buildAllowed(NPCS.marguerite))).toContain("shepherd");
    mstate.flags.add("marguerite_tidying");
    expect(buildSystem(NPCS.marguerite, buildAllowed(NPCS.marguerite))).not.toContain("shepherd");
  });
  it("7. a refusal steps patience whatever the model called the topic", async () => {
    day1(); tape("pugh_row");
    MTUNING.patienceStep = 1;
    const be = scripted(() => '{"reply":"I was with Tomasz at ten to ten.","topic":"other","shared":[]}');
    const r = await mtalk(be, NPCS.pugh, "what did you see in walter's room?");
    expect(r.refused).toMatch(/^fabrication/);
    expect(r.patienceStepped).toBe(true);
  });
});


describe("naive-player findings", () => {
  it("refusal lines are spoken without their example quotes, and a stray topic word is stripped", async () => {
    day1();
    const a = buildAllowed(NPCS.rose);
    const where = a.topics.find((t) => a.topicLabels[t] === "where she was that night")!;
    const be = scripted(() => JSON.stringify({ reply: "I was by the pond with someone. Other?", topic: where }));
    const r = await mtalk(be, NPCS.rose, "where were you that night?");
    expect(r.output.reply).not.toMatch(/^"|"$/);
    expect(r.output.reply).not.toContain("Other?");
  });
  it("a repeated reply is retried once", async () => {
    day1();
    let n = 0;
    const be = scripted(() => { n++; return JSON.stringify({ reply: n <= 2 ? "Mm. Go on." : "Different.", topic: "other" }); });
    await mtalk(be, NPCS.edith, "hi");
    const r = await mtalk(be, NPCS.edith, "hi again");
    expect(n).toBe(3);
    expect(r.output.reply).toBe("Different.");
  });
  it("every line costs at least half a minute of the day", async () => {
    day1();
    const be = scripted(() => '{"reply":"Mm.","topic":"other"}');
    for (let i = 0; i < 4; i++) await mtalk(be, NPCS.edith, "hello");
    endConversation("edith", 0.1, "player");
    expect(mstate.elapsed).toBe(2);
  });
  it("the tape keeps what the NPC actually said", async () => {
    day1();
    const be = scripted(() => '{"reply":"Marguerite did the cocoa herself, half past nine, took it up. Passing, she said.","topic":"other"}');
    const r = await mtalk(be, NPCS.tomasz, "who made the cocoa?");
    expect(r.voiced).toEqual(["tomasz_cocoa"]);
    record("tomasz says marguerite made the cocoa at half past nine");
    expect(mstate.tape[0].heard).toContain("Passing, she said");
  });
  it("the Captain's admission follows from a witness alone; his lie is gone once he has admitted", () => {
    day1(); tape("pugh_row"); tape("tomasz_cocoa");
    expect(clueStatus(clueById("pugh_admits_visit")!).state).toBe("locked");
    tape("tomasz_saw_pugh");
    expect(clueStatus(clueById("pugh_admits_visit")!).state).toBe("sharable");
    expect(clueStatus(clueById("pugh_alibi")!).state).toBe("sharable");
    tape("pugh_admits_visit");
    expect(clueStatus(clueById("pugh_alibi")!).state).toBe("gone");
  });
  it("goodwill survives the night; hostility softens", () => {
    startGame(); beginDay(1); pendingScenes();
    npcRt("pugh").mood = "warm"; npcRt("rose").mood = "hostile";
    beginDay(2); pendingScenes();
    expect(npcRt("pugh").mood).toBe("warm");
    expect(npcRt("rose").mood).toBe("guarded");
  });
  it("a vague note is refused by the tape", () => {
    day1(); voice("edith_house");
    expect(record("something about the house, I think").recorded).toBe(false);
    expect(record("edith says walter owned the house and sold it").recorded).toBe(true);
  });
});


describe("third playthrough findings", () => {
  it("lines are charged as they are spoken, and the close charges only the excess", async () => {
    day1();
    const be = scripted(() => '{"reply":"Mm.","topic":"other"}');
    await mtalk(be, NPCS.edith, "hello");
    expect(mstate.elapsed).toBe(0.5);
    await mtalk(be, NPCS.edith, "hello again");
    endConversation("edith", 1.5, "player");
    expect(mstate.elapsed).toBe(1.5);
  });
  it("a note attributed to a speaker never matches another speaker's clue", () => {
    startGame(); // Walter's party line is in the pool
    voice("rose_teetotal");
    const r = record("Rose said Walter had not had a drop in twenty years");
    expect(r.clue?.id).toBe("rose_teetotal");
    mstate.pool.length = 0; mstate.pool.push("scene_teetotal");
    expect(record("Rose said twenty years dry, a nightcap").recorded).toBe(false);
  });
  it("a genuine line that is not a clue can be taped as a quote under its speaker", async () => {
    day1();
    const be = scripted(() => '{"reply":"The dosage is well documented, Sam. I have never lost a single capsule in eight years.","topic":"other"}');
    await mtalk(be, NPCS.marguerite, "how careful are you with the medicines?");
    const r = record("Marguerite said the dosage is well documented and she never lost a single capsule in eight years");
    expect(r.recorded).toBe(true);
    expect(mstate.tape[0].clueId).toBe("quote");
    expect(mstate.tape[0].page).toBe("marguerite");
    expect(mstate.flags.size).toBe(0);
    expect(record("Marguerite confessed to everything").recorded).toBe(false);
  });
  it("a said-but-untaped clue is repeated by code in the words Sam heard, and is not in the prompt", async () => {
    day1();
    const first = scripted(() => '{"reply":"Marguerite did the cocoa, half past nine, carried it up herself.","topic":"other"}');
    await mtalk(first, NPCS.tomasz, "who made the cocoa?");
    const sys = buildSystem(NPCS.tomasz, buildAllowed(NPCS.tomasz));
    expect(sys).not.toContain("carried it up");
    const a = buildAllowed(NPCS.tomasz);
    const topic = a.topics.find((t) => a.topicLabels[t] === "that night, the cocoa")!;
    const dodge = scripted(() => JSON.stringify({ reply: "I was on my rounds.", topic }));
    const r = await mtalk(dodge, NPCS.tomasz, "tell me about the cocoa again");
    expect(r.refused).toBe("repeated");
    expect(r.output.reply).toContain("carried it up herself");
  });
  it("a reply that repeats any of the last six lines is retried, and a near-echo of a sample sentence is stripped", async () => {
    day1();
    let n = 0;
    const be = scripted(() => { n++; return JSON.stringify({ reply: n === 1 ? "Walter was stubborn, like." : n <= 3 ? "Walter was stubborn, like!" : "Something new.", topic: "other" }); });
    await mtalk(be, NPCS.pugh, "a"); await mtalk(be, NPCS.pugh, "b");
    const r = await mtalk(be, NPCS.pugh, "c");
    expect(r.output.reply).toBe("Something new.");
    expect(stripEcho(NPCS.rose, "I think so. Walter was right, the beast.")).toBe("I think so.");
  });
});
