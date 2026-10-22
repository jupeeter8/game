import type { SttBackend, SttState, VoiceHandlers } from "./types";

/** Swap to "onnx-community/whisper-tiny.en" for a smaller/faster (less accurate) model. */
export const WHISPER_MODEL_ID = "onnx-community/whisper-base.en";
const TARGET_RATE = 16000;
const MIN_SECONDS = 0.4;
const MIN_RMS = 0.004;

const log = (...a: unknown[]) => console.log("[whisper]", ...a);

type WorkerMsg =
  | { type: "progress"; info: { status: string; file?: string; progress?: number; loaded?: number; total?: number } }
  | { type: "ready" }
  | { type: "result"; id: number; text: string; ms: number }
  | { type: "error"; id?: number; message: string };

/**
 * Local speech-to-text: mic -> AudioWorklet (16 kHz Float32) -> Whisper (transformers.js) in a Web Worker.
 * Works in any browser with getUserMedia; uses WebGPU when present, WASM otherwise.
 */
export class WhisperStt implements SttBackend {
  readonly name = "whisper";
  private worker: Worker | null = null;
  private ready = false;
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private chunks: Float32Array[] = [];
  private handlers: VoiceHandlers | null = null;
  private st: SttState = "idle";
  private nextId = 1;
  private pending = new Map<number, VoiceHandlers>();

  available(): boolean {
    return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof AudioWorkletNode !== "undefined";
  }

  state(): SttState {
    return this.st;
  }

  isListening(): boolean {
    return this.st === "listening";
  }

  async init(onProgress: (pct: number, text: string) => void): Promise<void> {
    if (this.ready) return;
    const device = await pickDevice();
    try {
      await this.loadOn(device, onProgress);
    } catch (err) {
      if (device === "webgpu") {
        log("webgpu load failed, retrying on wasm:", (err as Error).message);
        await this.loadOn("wasm", onProgress);
      } else {
        throw err;
      }
    }
  }

  private async loadOn(device: "webgpu" | "wasm", onProgress: (pct: number, text: string) => void): Promise<void> {
    // Per the transformers.js Whisper WebGPU example: fp32 encoder + q4 decoder on GPU; q8 on WASM.
    const dtype = device === "webgpu" ? { encoder_model: "fp32", decoder_model_merged: "q4" } : "q8";
    log("loading", WHISPER_MODEL_ID, "on", device);
    this.worker?.terminate();
    this.worker = new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module" });
    await new Promise<void>((resolve, reject) => {
      this.worker!.onmessage = (e: MessageEvent<WorkerMsg>) => {
        const m = e.data;
        if (m.type === "progress") {
          const i = m.info;
          if (i.status === "progress_total" && typeof i.progress === "number") onProgress(i.progress / 100, `speech model (${device}) ${Math.round(i.progress)}%`);
          else if (i.status === "progress" && typeof i.progress === "number") onProgress(i.progress / 100, `speech model (${device}): ${i.file ?? ""} ${Math.round(i.progress)}%`);
          else if (i.status === "initiate" || i.status === "download") onProgress(0, `speech model (${device}): ${i.file ?? i.status}`);
        } else if (m.type === "ready") {
          this.ready = true;
          this.worker!.onmessage = (ev) => this.onWorkerMessage(ev.data as WorkerMsg);
          onProgress(1, `speech model ready (${device})`);
          resolve();
        } else if (m.type === "error") {
          reject(new Error(m.message));
        }
      };
      this.worker!.onerror = (ev) => reject(new Error(ev.message));
      this.worker!.postMessage({ type: "init", model: WHISPER_MODEL_ID, device, dtype });
    });
  }

  async prepare(): Promise<void> {
    if (this.stream && this.ctx) {
      if (this.ctx.state === "suspended") await this.ctx.resume();
      return;
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    try {
      this.ctx = new AudioContext({ sampleRate: TARGET_RATE });
    } catch {
      this.ctx = new AudioContext(); // some browsers refuse a custom rate; we resample on stop()
    }
    await this.ctx.audioWorklet.addModule("/pcm-worklet.js");
    this.source = this.ctx.createMediaStreamSource(this.stream);
    log("mic ready, context rate", this.ctx.sampleRate);
  }

  start(h: VoiceHandlers): void {
    if (this.st !== "idle") return;
    if (!this.ctx || !this.source) {
      h.onError("microphone not prepared");
      return;
    }
    // Space keydown is a user gesture; resume in case the context was created outside an activation window (Safari).
    if (this.ctx.state === "suspended") void this.ctx.resume();
    this.handlers = h;
    this.chunks = [];
    this.node = new AudioWorkletNode(this.ctx, "pcm-capture", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => this.chunks.push(e.data);
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    this.source.connect(this.node).connect(mute).connect(this.ctx.destination);
    this.setState("listening");
    log("listening");
  }

  stop(): void {
    if (this.st !== "listening") return;
    const h = this.handlers;
    this.teardownCapture();
    this.handlers = null;
    if (!h) return;

    let audio = concat(this.chunks);
    this.chunks = [];
    if (this.ctx && this.ctx.sampleRate !== TARGET_RATE) audio = resample(audio, this.ctx.sampleRate, TARGET_RATE);

    const seconds = audio.length / TARGET_RATE;
    const rms = Math.sqrt(audio.reduce((s, v) => s + v * v, 0) / Math.max(1, audio.length));
    log(`captured ${seconds.toFixed(2)}s, rms ${rms.toFixed(4)}`);
    if (seconds < MIN_SECONDS || rms < MIN_RMS) {
      this.setState("idle");
      h.onFinal("");
      return;
    }

    if (!this.worker || !this.ready) {
      this.setState("idle");
      h.onError("speech model not loaded");
      return;
    }
    const id = this.nextId++;
    this.pending.set(id, h);
    this.setState("transcribing");
    this.worker.postMessage({ type: "transcribe", id, audio }, [audio.buffer]);
  }

  cancel(): void {
    this.teardownCapture();
    this.handlers = null;
    this.pending.clear();
    this.chunks = [];
    this.setState("idle");
  }

  private onWorkerMessage(m: WorkerMsg): void {
    if (m.type === "result") {
      const h = this.pending.get(m.id);
      this.pending.delete(m.id);
      this.setState("idle");
      const text = cleanTranscript(m.text);
      log(`transcribed in ${m.ms}ms:`, JSON.stringify(text));
      h?.onFinal(text);
    } else if (m.type === "error") {
      const h = m.id !== undefined ? this.pending.get(m.id) : undefined;
      if (m.id !== undefined) this.pending.delete(m.id);
      this.setState("idle");
      log("error", m.message);
      h?.onError(m.message);
    }
  }

  private teardownCapture(): void {
    if (this.node) {
      try {
        this.source?.disconnect(this.node);
        this.node.disconnect();
      } catch {
        /* already disconnected */
      }
      this.node.port.onmessage = null;
      this.node = null;
    }
  }

  private setState(s: SttState): void {
    this.st = s;
    this.handlers?.onState?.(s);
    for (const h of this.pending.values()) h.onState?.(s);
  }
}

/** navigator.gpu can exist with no usable adapter (headless, some Linux). Probe before committing to WebGPU. */
async function pickDevice(): Promise<"webgpu" | "wasm"> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown | null> } }).gpu;
  if (!gpu) return "wasm";
  try {
    return (await gpu.requestAdapter()) ? "webgpu" : "wasm";
  } catch {
    return "wasm";
  }
}

function concat(chunks: Float32Array[]): Float32Array {
  const n = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Float32Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** Linear resample; fine for speech going to a 16 kHz model. */
function resample(input: Float32Array, from: number, to: number): Float32Array {
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio;
    const i0 = Math.floor(x);
    const i1 = Math.min(i0 + 1, input.length - 1);
    out[i] = input[i0] + (input[i1] - input[i0]) * (x - i0);
  }
  return out;
}

/** Whisper emits markers on silence/noise; strip them so we don't send "[BLANK_AUDIO]" to the NPC. */
function cleanTranscript(t: string): string {
  return t.replace(/\[[^\]]*\]|\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
}
