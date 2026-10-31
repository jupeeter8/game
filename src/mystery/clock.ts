/**
 * Active-time clock for a conversation. Counts wall time while running; `hold()` pauses it for
 * every wait the player is not responsible for (model generation, transcription, typewriter).
 * `now` is injectable so tests can drive it.
 */
export class ActiveClock {
  private accMs = 0;
  private runningSince: number | null = null;
  private holds = 0;
  constructor(private readonly now: () => number = () => performance.now()) {}

  start(): void {
    if (this.runningSince === null && this.holds === 0) this.runningSince = this.now();
  }

  /** Pause for a wait. Returns a release function. */
  hold(): () => void {
    this.holds++;
    this.flush();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holds = Math.max(0, this.holds - 1);
      if (this.holds === 0 && this.started) this.runningSince = this.now();
    };
  }

  private started = false;

  begin(): void {
    this.started = true;
    this.accMs = 0;
    this.holds = 0;
    this.runningSince = this.now();
  }

  stop(): number {
    this.flush();
    this.started = false;
    this.runningSince = null;
    return this.accMs;
  }

  private flush(): void {
    if (this.runningSince !== null) {
      this.accMs += this.now() - this.runningSince;
      this.runningSince = null;
    }
  }

  activeMs(): number {
    const live = this.runningSince !== null ? this.now() - this.runningSince : 0;
    return this.accMs + live;
  }

  activeMinutes(): number {
    return this.activeMs() / 60000;
  }

  isRunning(): boolean {
    return this.runningSince !== null;
  }
}
