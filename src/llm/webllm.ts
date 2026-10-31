import { CreateWebWorkerMLCEngine, type WebWorkerMLCEngine, type ChatCompletionMessageParam } from "@mlc-ai/web-llm";
import type { LLMBackend, ChatRequest } from "./types";

/** Swap this to try other models. See prebuiltAppConfig.model_list in @mlc-ai/web-llm. */
export const MODELS: Record<string, string> = {
  "3b": "Qwen2.5-3B-Instruct-q4f16_1-MLC",       // ~2.5 GB, the floor
  "7b": "Qwen2.5-7B-Instruct-q4f16_1-MLC",       // ~5.1 GB
  "8b": "Llama-3.1-8B-Instruct-q4f16_1-MLC",     // ~5.0 GB, best at character voice
  "phi": "Phi-3.5-mini-instruct-q4f16_1-MLC",    // ~3.7 GB
};
/** `?model=8b` picks a prebuilt model by short name; any full prebuilt id also works. */
export const MODEL_ID = (() => {
  const want = typeof location !== "undefined" ? new URLSearchParams(location.search).get("model") : null;
  return want ? (MODELS[want] ?? want) : MODELS["3b"];
})();

/**
 * The grammar compiler may not support every JSON-schema keyword (maxLength, maxItems, ...).
 * Send only the structural subset; validate.ts enforces the rest after decoding.
 */
function grammarSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const KEEP = new Set(["type", "properties", "enum", "required", "additionalProperties", "items"]);
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (KEEP.has(k)) out[k] = strip(val);
      return out;
    }
    return v;
  };
  // "properties" values are schemas keyed by field name, so their keys must not be filtered.
  const top = strip(schema) as Record<string, unknown>;
  const props = (schema.properties ?? {}) as Record<string, unknown>;
  top.properties = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, strip(v)]));
  return top;
}

const USE_SCHEMA = typeof location !== "undefined" && new URLSearchParams(location.search).get("grammar") === "schema";
/**
 * One fixed grammar for every turn. WebLLM's grammar matcher needs a schema string, and a per-turn
 * schema (the topic enum changes every call) compiles a new grammar each time; those accumulate in
 * WASM memory until the renderer dies. Field values are validated in code against this turn's lists.
 */
const STABLE_SCHEMA = JSON.stringify({ type: "object", properties: { reply: { type: "string" }, topic: { type: "string" } }, required: ["reply", "topic"], additionalProperties: false });

export class WebLLMBackend implements LLMBackend {
  readonly name = "webllm";
  private engine: WebWorkerMLCEngine | null = null;

  async init(onProgress: (pct: number, text: string) => void): Promise<void> {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.engine = await CreateWebWorkerMLCEngine(worker, MODEL_ID, {
      initProgressCallback: (r) => onProgress(r.progress, r.text),
    });
  }

  async chat(req: ChatRequest): Promise<string> {
    if (!this.engine) throw new Error("WebLLM not initialised");
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: req.system },
      ...req.history.map((t) => ({ role: t.role, content: t.content })),
    ];
    const res = await this.engine.chat.completions.create({
      messages,
      max_tokens: req.maxTokens,
      temperature: 0.6,
      // One generic JSON grammar for every turn. A per-turn schema compiles a new grammar each call and
      // the compiled grammars accumulate in WASM memory until the renderer dies (~75-100 turns).
      // Fields are validated in code anyway. `?grammar=schema` restores the old behaviour.
      response_format: { type: "json_object", schema: USE_SCHEMA ? JSON.stringify(grammarSchema(req.schema)) : STABLE_SCHEMA },
    });
    return res.choices[0]?.message?.content ?? "";
  }
}
