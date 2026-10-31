import { NPCS, clueById } from "./content";
import type { MAllowed } from "./engine";
import { scoreClue } from "./recorder";
import { npcRt } from "./state";
import type { ChatRequest, LLMBackend } from "../llm/types";

const RUDE = /\b(idiot|stupid|useless|shut up|liar|old fool|pathetic|hurry up|whatever)\b/;
const ACCUSE = /\b(you did it|you killed|you murdered|murderer|it was you|you poisoned|you're the killer|you are the killer)\b/;
const KIND = /\b(please|thank|sorry|lovely|how are you|are you all right|i'm sorry|kind of you|appreciate)\b/;

const DEFLECT = ["I'd rather not go into that.", "Let's talk about something else.", "I don't know about that, dear.", "Not something I'll discuss.", "Hm. Ask me something else."];
const SMALL = ["Mm. Go on.", "Is that so.", "What is it you want to know?", "You've a lot of questions for a boy on holiday."];

/** Keyword stand-in for the model, data-driven from the same allowed lists. */
export class MysteryMock implements LLMBackend {
  readonly name = "mock";
  async init(onProgress: (pct: number, text: string) => void): Promise<void> { onProgress(1, "mock ready"); }
  async chat(req: ChatRequest, meta: { npcId: string }): Promise<string> {
    await new Promise((r) => setTimeout(r, 120 + Math.random() * 200));
    const line = req.history[req.history.length - 1]?.content ?? "";
    const a = (req as ChatRequest & { mallowed: MAllowed }).mallowed;
    return JSON.stringify(mockReply(meta.npcId, line, a));
  }
}

export function mockReply(npcId: string, line: string, a: MAllowed): { reply: string; tone: string; topic: string; shared: string[] } {
  const lower = line.toLowerCase();
  const tone = ACCUSE.test(lower) ? "accusing" : RUDE.test(lower) ? "rude" : KIND.test(lower) ? "kind" : "plain";
  const rt = npcRt(npcId);
  // best sharable clue by keyword score
  let best: string | null = null, bestS = 0;
  for (const id of a.shared) {
    const c = clueById(id);
    if (!c) continue;
    const s = scoreClue(line, c);
    if (s > bestS) { best = id; bestS = s; }
  }
  // best topic by label words (for locked topics)
  let topic = "other", topicS = 0;
  for (const [id, label] of Object.entries(a.topicLabels)) {
    const s = scoreClue(line, { id, npc: npcId, text: label, topic: label, keywords: label.split(/\s+/).filter((w) => w.length > 3) });
    if (s > topicS) { topic = id; topicS = s; }
  }
  // no keyword hit: if the question is clearly about a topic a sharable clue carries, share that clue
  if ((!best || bestS < 2) && topic !== "other" && topicS >= 2) {
    const byTopic = a.shared.find((id) => slugOf(clueById(id)?.topic ?? "") === topic);
    if (byTopic) { best = byTopic; bestS = 2; }
  }
  if (best && bestS >= 2 && rt.mood !== "hostile") {
    const c = clueById(best)!;
    return { reply: c.text, tone, topic: a.topics.includes(slugOf(c.topic)) ? slugOf(c.topic) : topic, shared: [best] };
  }
  if (tone === "accusing") return { reply: NPCS[npcId]?.fallback.hostile[0] ?? "How dare you.", tone, topic, shared: [] };
  if (rt.mood === "hostile") return { reply: NPCS[npcId]?.fallback.hostile[0] ?? "No.", tone, topic, shared: [] };
  if (topic !== "other" && topicS >= 2) return { reply: pick(DEFLECT), tone, topic, shared: [] };
  return { reply: pick(SMALL), tone, topic: "other", shared: [] };
}

function slugOf(label: string): string { return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""); }
function pick<T>(xs: readonly T[]): T { return xs[Math.floor(Math.random() * xs.length)]; }
