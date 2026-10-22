import { pipeline, env, type AutomaticSpeechRecognitionPipeline, type ProgressInfo } from "@huggingface/transformers";

env.allowLocalModels = false;

type InMsg =
  | { type: "init"; model: string; device: "webgpu" | "wasm"; dtype: unknown }
  | { type: "transcribe"; id: number; audio: Float32Array };

let asr: AutomaticSpeechRecognitionPipeline | null = null;

self.onmessage = async (e: MessageEvent<InMsg>) => {
  const m = e.data;
  try {
    if (m.type === "init") {
      asr = (await pipeline("automatic-speech-recognition", m.model, {
        device: m.device,
        dtype: m.dtype as never,
        progress_callback: (info: ProgressInfo) => self.postMessage({ type: "progress", info }),
      })) as AutomaticSpeechRecognitionPipeline;
      self.postMessage({ type: "ready" });
    } else if (m.type === "transcribe") {
      if (!asr) throw new Error("model not loaded");
      const t0 = performance.now();
      const out = (await asr(m.audio)) as { text: string } | { text: string }[];
      const text = Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text;
      self.postMessage({ type: "result", id: m.id, text, ms: Math.round(performance.now() - t0) });
    }
  } catch (err) {
    self.postMessage({ type: "error", id: (m as { id?: number }).id, message: (err as Error).message ?? String(err) });
  }
};
