import type { NpcDef } from "../game/npcs";
import { state, rel } from "../game/state";
import type { ChatRequest } from "./types";

export function buildSchema(npc: NpcDef): Record<string, unknown> {
  const flagIds = npc.knows.map((k) => k.flag);
  const questIds = ["none", ...npc.quests.map((q) => q.id)];
  return {
    type: "object",
    properties: {
      reply: { type: "string", maxLength: 240 },
      mood: { type: "string", enum: ["warm", "neutral", "cold"] },
      flags_set: { type: "array", items: { type: "string", enum: flagIds.length ? flagIds : ["__none__"] }, maxItems: 2 },
      quest_offer: { type: "string", enum: questIds },
    },
    required: ["reply", "mood", "flags_set", "quest_offer"],
    additionalProperties: false,
  };
}

export function buildRequest(npc: NpcDef, playerLine: string): ChatRequest {
  const r = rel(npc.id);
  const playerFlags = npc.reactsTo.filter((x) => state.flags.has(x.flag));
  const alreadyRevealed = npc.knows.filter((k) => state.flags.has(k.flag));
  const unrevealed = npc.knows.filter((k) => !state.flags.has(k.flag));
  const questState = npc.quests.map((q) => `${q.id}: ${state.quests[q.id] ?? "not offered"}`).join(", ");

  const lines: string[] = [];
  lines.push(`You are ${npc.name}, ${npc.title} at a small software company. You are an NPC in a game.`);
  lines.push(`Personality:`);
  for (const p of npc.persona) lines.push(`- ${p}`);
  lines.push(``);
  lines.push(`Relationship with the player: ${r} (range -3 cold .. 3 close). Treat 0 as a stranger.`);
  if (unrevealed.length) {
    lines.push(`Secrets you know (reveal ONLY when the condition is met, and then add the flag to flags_set):`);
    for (const k of unrevealed) lines.push(`- flag "${k.flag}": ${k.fact} Reveal when: ${k.revealWhen}.`);
  }
  if (alreadyRevealed.length) {
    lines.push(`You already told the player: ${alreadyRevealed.map((k) => k.fact).join(" ")}`);
  }
  if (playerFlags.length) {
    lines.push(`Things the player already knows:`);
    for (const f of playerFlags) lines.push(`- ${f.effect}`);
  }
  if (npc.quests.length) {
    lines.push(`Quests you can offer (set quest_offer to the id, only once, only when the condition holds):`);
    for (const q of npc.quests) lines.push(`- ${q.id} ("${q.title}"): offer when ${q.offerWhen}.`);
    lines.push(`Quest status: ${questState}.`);
  }
  lines.push(``);
  lines.push(`Rules:`);
  lines.push(`- reply: 1-2 short sentences, in character, plain text, no emojis, no stage directions.`);
  lines.push(`- mood: how this line of the player made you feel. "warm" if they were kind, curious or helpful; "cold" if rude or pushy; else "neutral".`);
  lines.push(`- flags_set: empty unless you revealed a secret this turn.`);
  lines.push(`- quest_offer: "none" unless you offer a quest this turn.`);
  lines.push(`- Never invent new quests, flags, or facts about other coworkers.`);
  lines.push(`Respond with JSON only.`);
  lines.push(``);
  lines.push(`Example (player was rude):`);
  lines.push(`{"reply":"Right. I'll be at my desk if you figure out how to say hello.","mood":"cold","flags_set":[],"quest_offer":"none"}`);
  lines.push(`Example (player was friendly, nothing special happened):`);
  lines.push(`{"reply":"Morning. Coffee machine's broken again, so manage your expectations.","mood":"warm","flags_set":[],"quest_offer":"none"}`);

  const history = [...(state.history[npc.id] ?? []), { role: "user" as const, content: playerLine }];

  return { system: lines.join("\n"), history, schema: buildSchema(npc), maxTokens: 160 };
}
