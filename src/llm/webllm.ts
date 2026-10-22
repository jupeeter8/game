import { CreateWebWorkerMLCEngine, type WebWorkerMLCEngine, type ChatCompletionMessageParam } from "@mlc-ai/web-llm";
import type { LLMBackend, ChatRequest } from "./types";

/** Swap this to try other models. See prebuiltAppConfig.model_list in @mlc-ai/web-llm. */
export const MODEL_ID = "Qwen2.5-3B-Instruct-q4f16_1-MLC";

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
      temperature: 0.7,
      response_format: { type: "json_object", schema: JSON.stringify(grammarSchema(req.schema)) },
    });
    return res.choices[0]?.message?.content ?? "";
  }
}
