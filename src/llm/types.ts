import type { Turn } from "../mystery/state";

/** What the model is allowed to say back. Everything else is derived in code. */
export interface NpcOutput {
  reply: string;
  /** one of the NPC's topic ids, or "other" */
  topic: string;
  /** a memory kind key, or "none" */
  event: string;
  /** reveal ids the NPC actually voiced this turn */
  shared: string[];
  /** "none" or a quest id */
  quest_offer: string;
}

/** The enums the schema was built from this turn; validate() and talk() re-check against them. */
export interface Allowed {
  topics: string[];
  events: string[];
  shared: string[];
  quests: string[];
}

export interface ChatRequest {
  system: string;
  history: Turn[];
  /** JSON schema used for grammar-constrained decoding (WebLLM) and validation. */
  schema: Record<string, unknown>;
  maxTokens: number;
  allowed: Allowed;
}

export interface LLMBackend {
  readonly name: string;
  init(onProgress: (pct: number, text: string) => void): Promise<void>;
  /** Returns the raw model text; caller parses + validates. */
  chat(req: ChatRequest, meta: { npcId: string }): Promise<string>;
}
