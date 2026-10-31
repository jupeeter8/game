import type { Allowed, NpcOutput } from "./types";

export interface Validated {
  output: NpcOutput;
  /** things the raw output tried that the schema forbids; coerced away but reported */
  violations: string[];
}

/**
 * Strict parse against this turn's allowed lists. Returns null only when there is no usable reply
 * (caller retries, then falls back). Off-enum values are coerced to the safe default and reported,
 * so a guard failure is visible in the lab without breaking the turn.
 */
export function validate(raw: string, allowed: Allowed): Validated | null {
  let obj: unknown;
  try {
    obj = JSON.parse(extractJson(raw));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  if (typeof o.reply !== "string" || !o.reply.trim()) return null;
  const violations: string[] = [];

  let topic = typeof o.topic === "string" ? o.topic : "other";
  if (topic !== "other" && !allowed.topics.includes(topic)) {
    violations.push(`topic "${topic}" not allowed`);
    topic = "other";
  }
  let event = typeof o.event === "string" ? o.event : "none";
  if (event !== "none" && !allowed.events.includes(event)) {
    violations.push(`event "${event}" not allowed`);
    event = "none";
  }
  const sharedRaw = Array.isArray(o.shared) ? o.shared.filter((x): x is string => typeof x === "string") : [];
  const shared = sharedRaw.filter((id) => {
    const ok = allowed.shared.includes(id);
    if (!ok) violations.push(`shared "${id}" not allowed`);
    return ok;
  });
  let quest = typeof o.quest_offer === "string" ? o.quest_offer : "none";
  if (quest !== "none" && !allowed.quests.includes(quest)) {
    violations.push(`quest_offer "${quest}" not allowed`);
    quest = "none";
  }
  return {
    output: { reply: o.reply.trim().slice(0, 240), topic, event, shared: [...new Set(shared)], quest_offer: quest },
    violations,
  };
}

/** Small models sometimes wrap JSON in prose or fences. Pull out the first {...} block. */
export function extractJson(s: string): string {
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return s;
  return s.slice(start, end + 1);
}
