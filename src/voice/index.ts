import type { SttBackend } from "./types";

/** Default: Whisper in-browser (works in Brave/Firefox/Safari/Chrome). `?stt=web` uses the browser's Web Speech API (Chrome/Edge only). */
export async function pickStt(): Promise<SttBackend> {
  const want = new URLSearchParams(location.search).get("stt");
  if (want === "web") {
    const { WebSpeechStt } = await import("./stt");
    return new WebSpeechStt();
  }
  const { WhisperStt } = await import("./whisper");
  return new WhisperStt();
}
