import type { NpcDef } from "../game/npcs";
import type { LLMBackend, NpcOutput } from "./types";
import { buildRequest } from "./prompt";
import { validate } from "./validate";
import { state, bumpRel, pushHistory } from "../game/state";

const MOOD_DELTA: Record<NpcOutput["mood"], number> = { warm: 1, neutral: 0, cold: -1 };

export interface TalkResult {
  output: NpcOutput;
  applied: { relDelta: number; newFlags: string[]; questOffered: string | null };
  usedFallback: boolean;
}

/** One conversational turn: build prompt -> model -> validate (retry once) -> apply deltas in code. */
export async function talk(backend: LLMBackend, npc: NpcDef, playerLine: string): Promise<TalkResult> {
  const req = buildRequest(npc, playerLine);
  let output: NpcOutput | null = null;
  let usedFallback = false;

  for (let attempt = 0; attempt < 2 && !output; attempt++) {
    try {
      const raw = await backend.chat(req, { npcId: npc.id });
      output = validate(raw, npc);
      if (!output) console.warn(`[${npc.id}] invalid model output (attempt ${attempt + 1}):`, raw);
    } catch (e) {
      console.error(`[${npc.id}] backend error:`, e);
    }
  }
  if (!output) {
    usedFallback = true;
    output = { reply: npc.fallback, mood: "neutral", flags_set: [], quest_offer: "none" };
  }

  // Apply deltas. Code is the authority; the model only proposed.
  const relDelta = MOOD_DELTA[output.mood];
  bumpRel(npc.id, relDelta);

  const newFlags = output.flags_set.filter((f) => !state.flags.has(f));
  for (const f of newFlags) state.flags.add(f);

  let questOffered: string | null = null;
  if (output.quest_offer !== "none" && !state.quests[output.quest_offer]) {
    state.quests[output.quest_offer] = "offered";
    questOffered = output.quest_offer;
  }

  pushHistory(npc.id, { role: "user", content: playerLine });
  pushHistory(npc.id, { role: "assistant", content: output.reply });

  return { output, applied: { relDelta, newFlags, questOffered }, usedFallback };
}
