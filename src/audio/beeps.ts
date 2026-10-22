import type { BeepVoice } from "../game/npcs";

/** Animal-Crossing-style blips, one per typed character. No audio files; pure oscillators. */
export class Beeper {
  private ctx: AudioContext | null = null;

  /** Must be called from a user gesture (keypress) so autoplay policy allows audio. */
  unlock(): void {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  blip(voice: BeepVoice, char: string): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = voice.wave;

    // Vowels slightly higher, punctuation lower, plus jitter so it doesn't sound like a dial tone.
    const vowel = /[aeiou]/i.test(char);
    const punct = /[.,!?]/.test(char);
    const mult = (vowel ? 1.18 : punct ? 0.8 : 1) * (0.94 + Math.random() * 0.12);
    osc.frequency.setValueAtTime(voice.baseHz * mult, t);

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.12, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);

    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.05);
  }

  /** Low "hmm" while the NPC is thinking. */
  think(voice: BeepVoice): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = voice.wave;
    osc.frequency.setValueAtTime(voice.baseHz * 0.5, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.05, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.13);
  }
}

export const beeper = new Beeper();
