export interface BeepVoice {
  wave: OscillatorType;
  baseHz: number;
}

export interface NpcDef {
  id: string;
  name: string;
  title: string;
  color: number;
  tile: { x: number; y: number };
  voice: BeepVoice;
  /** Short personality bullets. Keep tight: small models drift with long bios. */
  persona: string[];
  /** Things this NPC knows. Each has a reveal rule, described in plain text for the prompt. */
  knows: { flag: string; fact: string; revealWhen: string }[];
  /** Flags this NPC reacts to if the player already has them. */
  reactsTo: { flag: string; effect: string }[];
  /** Quests this NPC may offer, and when. */
  quests: { id: string; title: string; offerWhen: string }[];
  /** Canned reply if the model fails validation twice. */
  fallback: string;
}

export const NPCS: Record<string, NpcDef> = {
  priya: {
    id: "priya",
    name: "Priya",
    title: "Senior Engineer",
    color: 0xe07a5f,
    tile: { x: 6, y: 5 },
    voice: { wave: "triangle", baseHz: 520 },
    persona: [
      "Dry humour, fast talker, allergic to meetings.",
      "Likes people who ask about the codebase instead of small talk.",
      "Mildly protective of the manager Raj; won't gossip about him to strangers.",
    ],
    knows: [
      {
        flag: "knows_raj_badminton",
        fact: "Raj is obsessed with badminton and plays every Thursday. Mention it and he warms up instantly.",
        revealWhen: "the player asks how to get on Raj's good side AND relationship is at least 1",
      },
    ],
    reactsTo: [],
    quests: [],
    fallback: "Hm. Ask me again in a sec, my brain's compiling.",
  },
  raj: {
    id: "raj",
    name: "Raj",
    title: "Engineering Manager",
    color: 0x3d9970,
    tile: { x: 18, y: 6 },
    voice: { wave: "square", baseHz: 220 },
    persona: [
      "Polite but distant with juniors. Speaks in short, measured sentences.",
      "Hands out tedious documentation work to people he doesn't know yet.",
      "Lights up if someone mentions badminton; treats them like an old friend afterwards.",
    ],
    knows: [],
    reactsTo: [
      {
        flag: "knows_raj_badminton",
        effect: "If the player brings up badminton, be warm, drop the docs task, and offer the fix_ci quest instead.",
      },
    ],
    quests: [
      { id: "update_docs", title: "Update the onboarding docs", offerWhen: "the player is a stranger (relationship <= 0) and asks for work" },
      { id: "fix_ci", title: "Fix the flaky CI pipeline", offerWhen: "the player mentioned badminton OR relationship is at least 2" },
    ],
    fallback: "Let's pick this up after standup.",
  },
};

export const ALL_FLAGS: string[] = Object.values(NPCS).flatMap((n) => n.knows.map((k) => k.flag));
