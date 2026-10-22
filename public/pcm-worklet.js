// Captures mono Float32 PCM from the mic and posts it to the main thread in ~128-sample frames.
// Plain JS in public/ so Vite serves it as-is for audioWorklet.addModule().
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);
