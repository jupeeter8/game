import type { NpcDef } from "../game/npcs";
import type { NpcOutput, Mood } from "./types";

const MOODS: Mood[] = ["warm", "neutral", "cold"];

/** Strict parse. Returns null on any violation so the caller can retry or fall back. */
export function validate(raw: string, npc: NpcDef): NpcOutput | null {
  let obj: unknown;
  try {
    obj = JSON.parse(extractJson(raw));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;

  if (typeof o.reply !== "string" || !o.reply.trim()) return null;
  if (!MOODS.includes(o.mood as Mood)) return null;

  const allowedFlags = new Set(npc.knows.map((k) => k.flag));
  const flags = Array.isArray(o.flags_set) ? o.flags_set.filter((f): f is string => typeof f === "string" && allowedFlags.has(f)) : [];

  const allowedQuests = new Set(["none", ...npc.quests.map((q) => q.id)]);
  const quest = typeof o.quest_offer === "string" && allowedQuests.has(o.quest_offer) ? o.quest_offer : "none";

  return { reply: o.reply.trim().slice(0, 240), mood: o.mood as Mood, flags_set: flags, quest_offer: quest };
}

/** Small models sometimes wrap JSON in prose or fences. Pull out the first {...} block. */
function extractJson(s: string): string {
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return s;
  return s.slice(start, end + 1);
}
