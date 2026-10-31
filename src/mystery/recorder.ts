import { CLUES, NPCS, PAGES, clueById, type Clue } from "./content";
import { MTUNING } from "./tuning";
import { mstate } from "./state";

const STOP = new Set(["the", "and", "that", "this", "with", "have", "from", "they", "them", "there", "their", "what", "when", "where", "said", "says", "told", "about", "was", "were", "been", "being", "into", "then", "than", "also", "just", "very", "some", "went", "come", "came", "like", "sam", "walter", "she", "her", "him", "his", "its", "it's", "he's", "she's", "you", "your", "for", "not", "but", "did", "does", "had", "has"]);

export function tokens(s: string): string[] {
  return s.toLowerCase().replace(/[’']/g, "'").split(/[^a-z0-9']+/).filter((w) => w.length > 2 && !STOP.has(w));
}

function prefixHit(hay: Set<string>, needle: string): boolean {
  if (hay.has(needle)) return true;
  const p = needle.slice(0, 5);
  if (p.length < 4) return false;
  for (const h of hay) if (h.startsWith(p) || needle.startsWith(h.slice(0, 5)) && h.length >= 4) return true;
  return false;
}

/** Score a note against one clue: keyword hits (weight 2, phrase hits weight 3) plus text-word overlap. */
export function scoreClue(note: string, clue: Clue): number {
  const lower = note.toLowerCase();
  const hay = new Set(tokens(note));
  let s = 0;
  for (const kw of clue.keywords) {
    const k = kw.toLowerCase();
    if (k.includes(" ")) {
      if (lower.includes(k)) s += 3;
      else {
        const parts = tokens(k);
        // a phrase only counts as a phrase if at least two content words survive stop-word removal
        if (parts.length >= 2 && parts.every((p) => prefixHit(hay, p))) s += 2;
        else if (parts.length === 1 && prefixHit(hay, parts[0])) s += 1;
      }
    } else if (prefixHit(hay, k)) s += 2;
  }
  const words = tokens(clue.text);
  let overlap = 0;
  for (const w of new Set(words)) if (prefixHit(hay, w)) overlap++;
  s += overlap * 0.5;
  return s;
}

export interface MatchResult {
  clue: Clue | null;
  page: string;
  score: number;
  runnerUp: Clue | null;
  runnerUpScore: number;
}

/** Which NPC page did the player name? Defaults to the clue's speaker, or the subject for scene/loose clues. */
export function pageFor(note: string, clue: Clue | null): string {
  const lower = ` ${note.toLowerCase()} `;
  for (const npc of Object.values(NPCS)) {
    for (const a of npc.aliases) if (lower.includes(` ${a} `) || lower.includes(` ${a}'s `) || lower.includes(` ${a}, `)) return npc.id;
  }
  if (/\bwalter\b/.test(lower)) return "walter";
  if (!clue) return "loose";
  if (clue.npc === "scene" || clue.npc === "loose") return clue.about?.[0] ?? "loose";
  return clue.npc;
}

/** Match a spoken note against the pool of voiced-but-unrecorded clues. Never matches anything outside the pool. */
export function matchNote(note: string, poolIds: string[]): MatchResult {
  let pool = poolIds.map(clueById).filter((c): c is Clue => !!c);
  // "Rose said ..." only matches what Rose (or a scene line about her) said; never another speaker's clue
  const named = speakerNamed(note);
  if (named) {
    pool = pool.filter((c) => c.npc === named || (c.npc === "scene" && (c.about ?? []).includes(named)) || c.npc === "loose");
  }
  let best: Clue | null = null, bestS = 0, second: Clue | null = null, secondS = 0;
  for (const c of pool) {
    const s = scoreClue(note, c);
    if (s > bestS) { second = best; secondS = bestS; best = c; bestS = s; }
    else if (s > secondS) { second = c; secondS = s; }
  }
  const accepted = best && bestS >= MTUNING.matchThreshold ? best : null;
  return { clue: accepted, page: pageFor(note, accepted), score: bestS, runnerUp: second, runnerUpScore: secondS };
}

/** The NPC a note attributes a line to ("Edith said", "the Captain told me"), if any. */
export function speakerNamed(note: string): string | null {
  const lower = ` ${note.toLowerCase()} `;
  for (const npc of Object.values(NPCS)) for (const a of npc.aliases) if (new RegExp(`\\b${a}('s)?\\s+(said|says|told|mentioned|thinks|claims|admitted|reckons)\\b`).test(lower)) return npc.id;
  return null;
}

/** Something an NPC genuinely said recently that is not a clue: taped as a quote, filed under them. */
export function matchQuote(note: string): { speaker: string; line: string } | null {
  const hay = new Set(tokens(note));
  if (hay.size < 3) return null;
  let best: { speaker: string; line: string; score: number } | null = null;
  for (const [id, rt] of Object.entries(mstate.npcs)) {
    for (const t of rt.history.filter((h) => h.role === "assistant").slice(-8)) {
      const words = new Set(tokens(t.content));
      if (words.size < 3) continue;
      let hit = 0;
      for (const w of words) if (prefixHit(hay, w)) hit++;
      const score = hit / words.size;
      if (hit >= 3 && score >= 0.5 && (!best || score > best.score)) best = { speaker: id, line: t.content, score };
    }
  }
  return best ? { speaker: best.speaker, line: best.line } : null;
}

export function validPage(p: string): boolean {
  return PAGES.includes(p);
}

export { CLUES };
