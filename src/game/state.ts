export type Role = "user" | "assistant";
export interface Turn { role: Role; content: string }

export type QuestStatus = "offered" | "accepted" | "done";

/** All game state lives here. The LLM only ever proposes deltas; code applies them. */
export interface GameState {
  flags: Set<string>;
  relationship: Record<string, number>;
  quests: Record<string, QuestStatus>;
  history: Record<string, Turn[]>;
}

export const state: GameState = {
  flags: new Set(),
  relationship: {},
  quests: {},
  history: {},
};

export function rel(npcId: string): number {
  return state.relationship[npcId] ?? 0;
}

export function bumpRel(npcId: string, delta: number): void {
  state.relationship[npcId] = Math.max(-3, Math.min(3, rel(npcId) + delta));
}

export function pushHistory(npcId: string, turn: Turn, keep = 6): void {
  const h = (state.history[npcId] ??= []);
  h.push(turn);
  if (h.length > keep) h.splice(0, h.length - keep);
}

export function describeState(): string {
  const lines: string[] = [];
  lines.push("REL  " + Object.entries(state.relationship).map(([k, v]) => `${k}:${v}`).join("  ") || "REL  -");
  lines.push("FLAGS " + ([...state.flags].join(", ") || "-"));
  lines.push("QUESTS " + (Object.entries(state.quests).map(([k, v]) => `${k}(${v})`).join(", ") || "-"));
  return lines.join("\n");
}
