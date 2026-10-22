import Phaser from "phaser";
import { NPCS, type NpcDef } from "../game/npcs";
import { beeper } from "../audio/beeps";
import { talk } from "../llm/talk";
import type { LLMBackend } from "../llm/types";
import type { SttBackend, SttState } from "../voice/types";

interface Data {
  npcId?: string;
  desk?: boolean;
}

const W = 800;
const H = 600;
const BOX_H = 150;

export class DialogueScene extends Phaser.Scene {
  private npc: NpcDef | null = null;
  private backend!: LLMBackend;
  private voice!: SttBackend;
  private micReady = false;
  private input_ = document.getElementById("chat-input") as HTMLInputElement;
  private bodyText!: Phaser.GameObjects.Text;
  private nameText!: Phaser.GameObjects.Text;
  private portrait!: Phaser.GameObjects.Rectangle;
  private typing: Phaser.Time.TimerEvent | null = null;
  private thinkTimer: Phaser.Time.TimerEvent | null = null;
  private busy = false;
  private micText!: Phaser.GameObjects.Text;
  private micDot!: Phaser.GameObjects.Arc;
  private spaceHeld = false;
  private spaceDownAt = 0;
  private onKey = (e: KeyboardEvent) => this.handleKey(e);
  private onKeyUp = (e: KeyboardEvent) => this.handleKeyUp(e);

  constructor() {
    super("dialogue");
  }

  init(data: Data): void {
    this.npc = data.npcId ? NPCS[data.npcId] : null;
    this.backend = this.registry.get("backend") as LLMBackend;
    this.voice = this.registry.get("stt") as SttBackend;
  }

  create(): void {
    this.game.events.emit("dialogue:open");
    beeper.unlock();

    const top = H - BOX_H - 16;
    this.add.rectangle(W / 2, top + BOX_H / 2, W - 32, BOX_H, 0x11141a, 0.94).setStrokeStyle(2, 0x5b8def);
    this.portrait = this.add.rectangle(56, top + 56, 56, 56, this.npc?.color ?? 0x888888).setStrokeStyle(2, 0xffffff);
    this.nameText = this.add.text(100, top + 14, this.npc ? `${this.npc.name}  ·  ${this.npc.title}` : "Your desk", {
      fontSize: "14px", fontFamily: "monospace", color: "#ffe066",
    });
    this.bodyText = this.add.text(100, top + 40, "", {
      fontSize: "15px", fontFamily: "monospace", color: "#ffffff", wordWrap: { width: W - 160 }, lineSpacing: 4,
    });

    this.micDot = this.add.circle(W - 40, top + 16, 5, 0xff3b30).setVisible(false);
    this.micText = this.add.text(W - 52, top + 10, "", { fontSize: "11px", fontFamily: "monospace", color: "#aaa" }).setOrigin(1, 0);
    this.setMicHint();

    window.addEventListener("keydown", this.onKey, true);
    window.addEventListener("keyup", this.onKeyUp, true);

    if (!this.npc) {
      this.bodyText.setText("Desk work goes here (Papers-Please-style tasks). Not built yet.\nPress Esc to step away.");
      return;
    }

    this.showInput();
    this.typeOut(`(${this.npc.name} looks up.)`);

    // Ask for the mic now (E was a user gesture) so the first utterance isn't lost behind the permission prompt.
    if (this.voice.available()) {
      this.voice
        .prepare()
        .then(() => {
          this.micReady = true;
          this.setMicHint();
        })
        .catch((err: Error) => {
          this.micText.setText(`mic unavailable: ${err.message} · type instead`).setColor("#ff3b30");
          console.warn("mic prepare failed:", err);
        });
    }
  }

  private setMicHint(state: SttState = this.voice.state()): void {
    if (!this.voice.available()) {
      this.micText.setText("no microphone API in this browser · type instead").setColor("#777");
      this.micDot.setVisible(false);
      return;
    }
    if (state === "listening") {
      this.micText.setText(this.spaceHeld ? "listening… release SPACE to send" : "listening… SPACE or Enter to send").setColor("#ff3b30");
      this.micDot.setVisible(true).setFillStyle(0xff3b30);
    } else if (state === "transcribing") {
      this.micText.setText("transcribing…").setColor("#ffe066");
      this.micDot.setVisible(true).setFillStyle(0xffe066);
    } else if (!this.micReady) {
      this.micText.setText("waiting for microphone permission…").setColor("#aaa");
      this.micDot.setVisible(false);
    } else {
      this.micText.setText("SPACE to talk (hold or tap) · or type").setColor("#aaa");
      this.micDot.setVisible(false);
    }
  }

  private startListening(): void {
    if (!this.npc || this.busy || this.voice.state() !== "idle") return;
    if (!this.micReady) {
      this.setMicHint();
      return;
    }
    this.input_.placeholder = "listening…";
    this.voice.start({
      onState: (st) => this.setMicHint(st),
      onInterim: (t) => {
        this.input_.value = t;
      },
      onFinal: (t) => {
        this.input_.placeholder = "Say something… (Enter to send, Esc to leave)";
        this.tweens.killTweensOf(this.micDot);
        this.micDot.setAlpha(1);
        this.setMicHint();
        if (t) {
          this.input_.value = t;
          void this.send(t);
        } else {
          this.micText.setText("didn't catch that · try again").setColor("#ffe066");
        }
      },
      onError: (msg) => {
        this.input_.placeholder = "Say something… (Enter to send, Esc to leave)";
        this.tweens.killTweensOf(this.micDot);
        this.micDot.setAlpha(1);
        this.micText.setText(`mic error: ${msg} · type instead`).setColor("#ff3b30");
        this.micDot.setVisible(false);
        console.warn("speech recognition error:", msg);
      },
    });
    this.setMicHint();
    this.tweens.add({ targets: this.micDot, alpha: 0.3, duration: 400, yoyo: true, repeat: -1 });
  }

  private stopListening(): void {
    if (this.voice.isListening()) this.voice.stop();
  }

  private handleKeyUp(e: KeyboardEvent): void {
    if (e.code === "Space" && this.spaceHeld) {
      this.spaceHeld = false;
      e.preventDefault();
      const heldMs = performance.now() - this.spaceDownAt;
      // Quick tap = toggle mode: keep listening until the next Space/Enter. Long hold = release to send.
      if (heldMs >= 400) this.stopListening();
      else this.setMicHint();
    }
  }

  private handleKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      this.close();
      return;
    }
    // Push-to-talk: hold Space while the box is empty (or while already listening).
    if (e.code === "Space" && this.npc && (this.input_.value === "" || this.voice.isListening())) {
      e.preventDefault();
      if (e.repeat) return;
      if (this.voice.isListening() && !this.spaceHeld) {
        // Second tap in toggle mode: stop and send.
        this.stopListening();
        return;
      }
      this.spaceHeld = true;
      this.spaceDownAt = performance.now();
      this.startListening();
      return;
    }
    if (e.key === "Enter" && this.voice.isListening()) {
      e.preventDefault();
      this.stopListening();
      return;
    }
    if (e.key === "Enter" && document.activeElement === this.input_) {
      e.preventDefault();
      const line = this.input_.value.trim();
      if (line && !this.busy) void this.send(line);
    }
  }

  private async send(line: string): Promise<void> {
    if (!this.npc) return;
    this.busy = true;
    this.input_.value = "";
    this.input_.disabled = true;
    this.startThinking();

    const result = await talk(this.backend, this.npc, line);

    this.stopThinking();
    this.game.events.emit("state:changed");
    this.input_.disabled = false;
    this.input_.focus();
    this.busy = false;

    const extras: string[] = [];
    if (result.applied.newFlags.length) extras.push(`[learned: ${result.applied.newFlags.join(", ")}]`);
    if (result.applied.questOffered) extras.push(`[quest offered: ${result.applied.questOffered}]`);
    if (result.applied.relDelta !== 0) extras.push(`[${this.npc.name} ${result.applied.relDelta > 0 ? "+" : ""}${result.applied.relDelta}]`);
    if (result.usedFallback) extras.push("[model output invalid; used fallback]");
    this.typeOut(result.output.reply, extras.join("  "));
  }

  private startThinking(): void {
    this.bodyText.setText("…");
    this.game.events.emit("npc:talk", this.npc!.id, false);
    let dots = 1;
    this.thinkTimer = this.time.addEvent({
      delay: 450, loop: true,
      callback: () => {
        dots = (dots % 3) + 1;
        this.bodyText.setText("…".repeat(dots));
        beeper.think(this.npc!.voice);
      },
    });
  }

  private stopThinking(): void {
    this.thinkTimer?.remove();
    this.thinkTimer = null;
  }

  /** Typewriter: one char per tick, blip on every 2nd visible char, NPC bobs while typing. */
  private typeOut(text: string, footer = ""): void {
    this.typing?.remove();
    this.bodyText.setText("");
    this.tweens.killTweensOf(this.portrait);
    if (this.npc) this.game.events.emit("npc:talk", this.npc.id, true);
    this.tweens.add({ targets: this.portrait, scaleY: 1.08, duration: 100, yoyo: true, repeat: -1 });

    let i = 0;
    let visibleCount = 0;
    this.typing = this.time.addEvent({
      delay: 28, loop: true,
      callback: () => {
        i++;
        const ch = text[i - 1];
        this.bodyText.setText(text.slice(0, i));
        if (ch && ch !== " ") {
          visibleCount++;
          if (visibleCount % 2 === 0 && this.npc) beeper.blip(this.npc.voice, ch);
        }
        if (i >= text.length) this.finishTyping(text, footer);
      },
    });
  }

  private finishTyping(text: string, footer: string): void {
    this.typing?.remove();
    this.typing = null;
    this.tweens.killTweensOf(this.portrait);
    this.portrait.setScale(1);
    if (this.npc) this.game.events.emit("npc:talk", this.npc.id, false);
    if (footer) this.bodyText.setText(`${text}\n\n${footer}`).setColor("#ffffff");
  }

  private showInput(): void {
    this.input_.classList.add("visible");
    this.input_.disabled = false;
    this.input_.value = "";
    setTimeout(() => this.input_.focus(), 0);
  }

  private close(): void {
    window.removeEventListener("keydown", this.onKey, true);
    window.removeEventListener("keyup", this.onKeyUp, true);
    this.voice.cancel();
    this.typing?.remove();
    this.stopThinking();
    this.input_.classList.remove("visible");
    this.input_.blur();
    if (this.npc) this.game.events.emit("npc:talk", this.npc.id, false);
    this.game.events.emit("dialogue:close");
    this.scene.stop();
  }
}
