/** Every number the play build depends on, editable live. */
export interface MysteryTuning {
  /** activity minutes per day */
  dayMinutes: number;
  /** base conversation limit in minutes, and the cap minigames can raise it to */
  convMinutes: number;
  convMinutesMax: number;
  /** minutes an NPC is away after leaving (patience done, or tired out) */
  awayMinutes: number;
  /** how many locked-topic questions before patience steps (fresh -> tired -> done) */
  patienceStep: number;
  /** closeness (critical clues on tape) that triggers the chandelier on day 2 */
  chandelierCloseness: number;
  /** minutes lost to the chandelier without the wheelchair */
  chandelierMinutes: number;
  /** minutes a minigame costs and adds to the conversation limit */
  minigameMinutes: number;
  minigameBonusMinutes: number;
  /** conversation turns kept per NPC for the model */
  historyTurns: number;
  /** recorder: minimum match score to accept (one keyword hit = 2) */
  matchThreshold: number;
  /** minimum day-minutes a conversation costs per line spoken */
  turnMinutes: number;
  /** a model's "shared" claim is accepted only if the reply scores at least this against the clue */
  shareVerifyScore: number;
}

export const DEFAULT_MTUNING: Readonly<MysteryTuning> = Object.freeze({
  dayMinutes: 45,
  convMinutes: 5,
  convMinutesMax: 7,
  awayMinutes: 6,
  patienceStep: 3,
  chandelierCloseness: 4,
  chandelierMinutes: 10,
  minigameMinutes: 3,
  minigameBonusMinutes: 1,
  historyTurns: 12,
  matchThreshold: 2,
  turnMinutes: 0.5,
  shareVerifyScore: 2,
});

export const MTUNING: MysteryTuning = { ...DEFAULT_MTUNING };

export function resetMTuning(): void {
  Object.assign(MTUNING, DEFAULT_MTUNING);
}
