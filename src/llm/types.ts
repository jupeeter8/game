import type { Turn } from "../game/state";

export type Mood = "warm" | "neutral" | "cold";

/** What the model is allowed to say back. Everything else is derived in code. */
export interface NpcOutput {
  reply: string;
  mood: Mood;
  flags_set: string[];
  quest_offer: string; // "none" or a quest id from the NPC's allowed list
}

export interface ChatRequest {
  system: string;
  history: Turn[];
  /** JSON schema used for grammar-constrained decoding (WebLLM) and validation. */
  schema: Record<string, unknown>;
  maxTokens: number;
}

export interface LLMBackend {
  readonly name: string;
  init(onProgress: (pct: number, text: string) => void): Promise<void>;
  /** Returns the raw model text; caller parses + validates. */
  chat(req: ChatRequest, meta: { npcId: string }): Promise<string>;
}
