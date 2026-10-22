/**
 * Push-to-talk speech-to-text via the browser's Web Speech API.
 * Chrome/Edge: good. Safari: partial. Firefox: none (we fall back to typing).
 * Swap this file for an in-browser Whisper later if you want fully offline STT.
 */

// Minimal typings; lib.dom's coverage of SpeechRecognition varies by TS version.
interface SRAlternative { transcript: string }
interface SRResult { isFinal: boolean; 0: SRAlternative; length: number }
interface SREvent { resultIndex: number; results: ArrayLike<SRResult> }
interface SRErrorEvent { error: string; message?: string }
interface SR {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onaudiostart: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SRCtor = new () => SR;

function ctor(): SRCtor | null {
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

import type { SttBackend, SttState, VoiceHandlers } from "./types";

const log = (...a: unknown[]) => console.log("[voice]", ...a);

/**
 * `active` is the user's intent (mic button held / toggled on). Chrome ends recognition sessions on its
 * own (silence, ~60s cap, transient errors), so while `active` we transparently start a new session and
 * keep accumulating text. Only when the user stops do we flush the final transcript.
 */
export class WebSpeechStt implements SttBackend {
  readonly name = "webspeech";
  private rec: SR | null = null;
  private finalText = "";
  private interimText = "";
  private handlers: VoiceHandlers | null = null;
  private active = false;
  private sessionError: string | null = null;

  available(): boolean {
    return ctor() !== null;
  }

  isListening(): boolean {
    return this.active;
  }

  state(): SttState {
    return this.active ? "listening" : "idle";
  }

  async init(onProgress: (pct: number, text: string) => void): Promise<void> {
    onProgress(1, "browser speech ready");
  }

  async prepare(): Promise<void> {
    /* permission is requested by the browser on first start() */
  }

  start(h: VoiceHandlers): void {
    if (!ctor() || this.active) return;
    this.handlers = h;
    this.finalText = "";
    this.interimText = "";
    this.active = true;
    this.sessionError = null;
    h.onState?.("listening");
    log("start requested");
    this.spawnSession();
  }

  /** Release: stop capturing; onFinal fires once the recognizer flushes. */
  stop(): void {
    if (!this.active) return;
    log("stop requested");
    this.active = false;
    if (this.rec) this.rec.stop();
    else this.flush();
  }

  cancel(): void {
    log("cancel");
    this.active = false;
    this.handlers = null;
    this.rec?.abort();
    this.rec = null;
  }

  private spawnSession(): void {
    const C = ctor()!;
    const rec = new C();
    rec.lang = navigator.language || "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => log("session start");
    rec.onaudiostart = () => log("audio start");
    rec.onspeechstart = () => log("speech start");
    rec.onspeechend = () => log("speech end");
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) this.finalText += r[0].transcript + " ";
        else interim += r[0].transcript;
      }
      this.interimText = interim;
      const text = (this.finalText + interim).trim();
      log("result", JSON.stringify(text));
      this.handlers?.onInterim(text);
    };
    rec.onerror = (e) => {
      log("error", e.error, e.message ?? "");
      // Benign: no-speech (silence timeout), aborted (we called abort). Everything else ends the attempt.
      if (e.error === "no-speech" || e.error === "aborted") return;
      this.sessionError = e.error;
      this.active = false;
    };
    rec.onend = () => {
      log("session end; active =", this.active);
      this.rec = null;
      if (this.active) {
        // Chrome closed the session but the user is still holding the mic: start another.
        this.finalText = (this.finalText + this.interimText + " ").trimStart();
        this.interimText = "";
        this.spawnSession();
        return;
      }
      this.flush();
    };

    this.rec = rec;
    try {
      rec.start();
    } catch (err) {
      log("start() threw", err);
      this.sessionError = (err as Error).message;
      this.active = false;
      this.rec = null;
      this.flush();
    }
  }

  private flush(): void {
    const h = this.handlers;
    this.handlers = null;
    if (!h) return;
    if (this.sessionError) {
      h.onError(this.sessionError);
      return;
    }
    const text = (this.finalText + this.interimText).trim();
    log("final", JSON.stringify(text));
    h.onState?.("idle");
    h.onFinal(text);
  }
}

