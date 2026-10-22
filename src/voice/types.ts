export type SttState = "idle" | "listening" | "transcribing";

export interface VoiceHandlers {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (msg: string) => void;
  onState?: (state: SttState) => void;
}

export interface SttBackend {
  readonly name: string;
  /** Can this backend work in this browser at all? */
  available(): boolean;
  /** Download/load models. No-op for backends without models. */
  init(onProgress: (pct: number, text: string) => void): Promise<void>;
  /** Ask for mic permission and warm up capture. Call from a user gesture (e.g. opening a dialogue). */
  prepare(): Promise<void>;
  state(): SttState;
  isListening(): boolean;
  start(h: VoiceHandlers): void;
  /** Stop capturing; onFinal (or onError) fires when the transcript is ready. */
  stop(): void;
  cancel(): void;
}
