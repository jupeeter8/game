import type { LLMBackend } from "./types";
import { MockBackend } from "./mock";

export async function pickBackend(): Promise<LLMBackend> {
  const want = new URLSearchParams(location.search).get("llm");
  const hasGpu = typeof navigator !== "undefined" && "gpu" in navigator;
  if (want === "webllm") {
    if (!hasGpu) {
      console.warn("WebGPU unavailable; falling back to mock backend.");
      return new MockBackend();
    }
    const { WebLLMBackend } = await import("./webllm");
    return new WebLLMBackend();
  }
  return new MockBackend();
}
