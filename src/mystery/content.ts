/**
 * Murder at Willowmere: the whole story as data. Clues, cast, events, minigames.
 * Nothing in here runs; the engine reads it. Keep ids stable: the graph, the tape and tests use them.
 */

export const PHASES = ["party", "day1", "evening", "day2"] as const;
export type Phase = (typeof PHASES)[number];
/** flags set by code, never by a clue; nothing can be "one flag away" from them */
export const EVENT_FLAGS = ["chandelier_fell", "wheelchair_built", "marguerite_tidying", "rose_vouch_used", "wheelchair_requested"] as const;

/** What the world looks like in each phase. The only place the prompt learns the date and the news. */
export const WORLD: Record<Phase, string> = {
  party: "It is the evening of the midsummer garden party at Willowmere. Everyone is outside with a glass. Walter Bram is alive and in fine voice.",
  day1: "It is Day 1. Walter Bram was found dead in his bed this morning. The doctor says his heart. The home is quiet and people are upset.",
  evening: "It is the evening of Day 1. The residents are at supper. Walter Bram died last night; the doctor says his heart.",
  day2: "It is Day 2. Walter Bram died two nights ago; the doctor says his heart. The county inspector comes this evening.",
};

export const MOODS = ["hostile", "guarded", "neutral", "warm"] as const;
export type Mood = (typeof MOODS)[number];
export const PATIENCES = ["fresh", "tired", "done"] as const;
export type Patience = (typeof PATIENCES)[number];
export const TONES = ["kind", "plain", "rude", "accusing"] as const;
export type Tone = (typeof TONES)[number];

/** Condition language over recorded flags, bonds and moods. */
export type Rule =
  | { flag: string }
  | { not: Rule }
  | { all: Rule[] }
  | { any: Rule[] }
  | { bond: string }
  | { mood: string; gte: Mood };

/** A prompt line that may switch on at a phase or when a rule passes. */
export type Layered = string | { text: string; from?: Phase; when?: Rule };

export interface Clue {
  /** unique; the graph node id and the tape entry id */
  id: string;
  /** earliest phase this clue exists at all (default day1). Before it: no text, no label, nothing. */
  from?: Phase;
  /** in-voice refusal used while the clue is in play but not sharable; generic refusal when absent */
  deflect?: string;
  /** who voices it: an npc id, "scene" (scripted line) or "loose" (found by looking around) */
  npc: string;
  /** what the NPC says. Goes to the prompt only once unlocked. */
  text: string;
  /** non-leaking label the prompt sees while locked, so the NPC can deflect on-topic */
  topic: string;
  /** recorded flags this needs before it can be voiced */
  needs?: Rule;
  /** minimum mood to voice it (default: guarded, i.e. anything but hostile) */
  mood?: Mood;
  /** needs this NPC's bond flag */
  bond?: boolean;
  /** flags set when recorded (default: [id]) */
  grants?: string[];
  /** npc ids / "walter" this is about, for filing */
  about?: string[];
  /** words the recorder matches on (prefix match, lowercase) */
  keywords: string[];
  /** terms that must not appear in a reply while locked */
  leakTerms?: string[];
  /** only voiceable on this day (visitors, scene lines) */
  day?: number;
  /** counts toward closeness (the chandelier trigger) */
  critical?: boolean;
  /** a flag that permanently locks this clue */
  lockedBy?: string;
}

export interface DerivedFlag {
  flag: string;
  when: Rule;
  label: string;
}

export interface BeepVoice { wave: OscillatorType; baseHz: number }
export interface Look { hair: string; skin: string; body: string; style: "short" | "bun" | "bald" | "cap" | "hat" | "long"; extra?: "glasses" | "moustache" | "beard" }
export interface Spots { party: [number, number]; day: [number, number] }

export interface NpcDef {
  id: string;
  name: string;
  role: string;
  color: string;
  voice: BeepVoice;
  look: Look;
  /** tile positions on the map: at the party (garden) and on the investigation days */
  spots: Spots;
  /** names Whisper might produce for them */
  aliases: string[];
  persona: Layered[];
  /** what this NPC knows and feels right now; resolved to the latest phase <= current with an entry */
  situation: Partial<Record<Phase, string>>;
  /** the one thing Sam can do for them */
  bondHint: string;
  /** two or three lines in their own voice; small models imitate these far better than they follow bullets */
  voiceLines?: Layered[];
  /** generic in-voice refusals used when code has to answer for a locked topic and the clue has no deflect */
  refusals?: string[];
  /** what they say when they get tired of being pushed, and when they walk off */
  tiredLine?: string;
  leaveLine?: string;
  /** minigame id, if any */
  minigame?: string;
  /** visitor window: day and the minute of the day they leave */
  window?: { day: number; untilMinute: number };
  /** evening visitor: only in the Day 1 evening scene */
  evening?: boolean;
  /** canned lines when the model fails twice, by mood */
  fallback: Record<Mood, string[]>;
  /** mood at the start */
  startMood: Mood;
}

export const NPCS: Record<string, NpcDef> = {
  edith: {
    id: "edith", name: "Edith", role: "your grandmother", color: "#e0a458",
    voice: { wave: "triangle", baseHz: 440 }, look: { hair: "#d8d8d8", skin: "#f1c9a5", body: "#e0a458", style: "bun" }, spots: { party: [33, 5], day: [11, 3] },
    aliases: ["edith", "gran", "grandma", "grandmother", "nan"],
    persona: [
      "Dry, sharp, eighty-one. Walter's oldest friend here; you argue about crosswords.",
      "Cool and polite toward Marguerite, who 'runs it like a hotel'.",
      "You do not talk about Sam's father unless Sam does first, and then only briefly.",
      { text: "You believe Walter was killed and you want Sam to find out, properly, not like the television.", from: "day1" },
    ],
    situation: {
      party: "Walter is across the lawn holding court with his cocoa. There is a row brewing about the house between him and the Captain, and you have heard the end of a sharper word between Walter and Marguerite by the roses. You are enjoying yourself despite it.",
      day1: "Walter was found dead this morning. The doctor says heart and you do not believe it; he was fine last night. You gave Sam his father's old tape recorder and told him to find out.",
      day2: "The inspector, Halloran, arrives tonight. Sam has until then. You are watching him work and keeping your opinions mostly to yourself.",
    },
    voiceLines: ["\"Sit down, you're making the room untidy.\"", "\"Walter cheated at crosswords for twenty years and I never caught him once. Infuriating man.\"", "\"Don't 'Gran' me. Ask your question.\""],
    refusals: ["\"That's not for now, Sam.\"", "\"Ask me something sensible.\""],
    tiredLine: "\"Enough, Sam. My head.\"", leaveLine: "\"I'm going to sit in the garden. Alone.\"",
    bondHint: "sit with her in the evening", minigame: "crossword",
    startMood: "neutral",
    fallback: { hostile: ["Not now, Sam."], guarded: ["Hm."], neutral: ["Say that again, dear, my hearing aid's playing up."], warm: ["Sorry, love, I was miles away. Go on."] },
  },
  marguerite: {
    id: "marguerite", name: "Marguerite", role: "the manager", color: "#b56576",
    voice: { wave: "sine", baseHz: 380 }, look: { hair: "#2b1d16", skin: "#8d5a3b", body: "#b56576", style: "short" }, spots: { party: [35, 8], day: [4, 23] },
    aliases: ["marguerite", "manager", "margaret", "margarite", "mrs okafor", "okafor"],
    persona: [
      "Warm, tired, competent. You have held this place together for eight years and you want that seen.",
      "You know every resident's medication by heart.",
      { text: "You are helpful about the Captain: everything you say about him is true.", from: "day1" },
      "You deny there is any sale. You are good at changing the subject.",
      { text: "Since the chandelier came down you are short with Sam, busy tidying, and no longer helpful.", when: { flag: "marguerite_tidying" } },
    ],
    situation: {
      party: "The midsummer party is your night: you organised it and it is going well. The Captain and Walter had a public row about the house; you smoothed it over. You had a private word with Walter by the roses that did not go the way you wanted.",
      day1: "A resident died in the night. You found him. You are running the home, keeping everyone calm, and dealing with the doctor and the family.",
      day2: "The inspector comes tonight. You want the day to be ordinary.",
    },
    voiceLines: [{ text: "\"Sam! Have you eaten? There's shepherd's pie going begging.\"", when: { not: { flag: "marguerite_tidying" } } }, "\"It's a lot of pills to keep straight, love. I do it in my sleep now.\"", { text: "\"Oh, the Captain. Bless him. He means well, mostly.\"", when: { not: { flag: "marguerite_tidying" } } }, { text: "\"Not now. I've a home to run.\"", when: { flag: "marguerite_tidying" } }],
    refusals: ["\"Let's not, love.\"", "\"That's not something I'll go into.\""],
    tiredLine: "\"Sam, love, I have forty residents and one of me.\"", leaveLine: "\"I really must get on.\"",
    bondHint: "nothing; she wants nothing from Sam",
    startMood: "neutral",
    fallback: { hostile: ["I have a home to run, Sam."], guarded: ["Let's not."], neutral: ["Sorry, Sam, what was that? It's been a day."], warm: ["Go on, I'm listening."] },
  },
  pugh: {
    id: "pugh", name: "Captain Pugh", role: "a resident, retired army medic", color: "#4f772d",
    voice: { wave: "square", baseHz: 180 }, look: { hair: "#cfcfcf", skin: "#e8b08c", body: "#4f772d", style: "bald", extra: "moustache" }, spots: { party: [33, 11], day: [21, 6] },
    aliases: ["pugh", "captain", "alistair", "the captain", "pew", "pue"],
    persona: [
      "Loud, blunt, seventy-eight. Ex-army medic. Broke. Want to move nearer your daughter.",
      "You want the Harrowgate sale and you say so to Walter's face.",
      "You respect a straight game of cards and people who don't flinch.",
      { text: "Underneath, you are in pieces about the night Walter died, and you cover it with bluster.", from: "day1" },
    ],
    situation: {
      party: "You have just had a row with Walter in front of everyone about the sale of the house, and you are not sorry. You are on your second whisky and looking for a card game.",
      day1: "Walter died in the night. Heart, they say. You are louder than usual.",
      day2: "The inspector comes tonight. You are keeping to the lounge and the card table.",
    },
    voiceLines: ["\"Speak up, boy, I was in artillery.\"", "\"Cards. Sit. We'll see what you're made of.\"", "\"Walter Bram was a stubborn old goat and I'll say it at his funeral.\""],
    refusals: ["\"Not your business, boy.\"", "\"I've nothing to say on that.\""],
    tiredLine: "\"You're wearing me out, boy.\"", leaveLine: "\"Right. That's me done. Out.\"",
    bondHint: "play cards and lose gracefully", minigame: "cards",
    startMood: "neutral",
    fallback: { hostile: ["We're done, boy."], guarded: ["Speak up or clear off."], neutral: ["Eh? Say it again, properly."], warm: ["Ha. Go on, then."] },
  },
  rose: {
    id: "rose", name: "Rose", role: "a resident, Walter's bridge partner", color: "#c77dff",
    voice: { wave: "sine", baseHz: 520 }, look: { hair: "#e9e4ef", skin: "#f3d2b8", body: "#c77dff", style: "long" }, spots: { party: [36, 12], day: [34, 22] },
    aliases: ["rose", "rosie", "miss kellaway", "kellaway"],
    persona: [
      "Flustered, gentle, seventy-four. Bad hip. Walter is your bridge partner.",
      "You dread any talk of the house changing hands: they would move you, and away from someone you love.",
      "You keep secrets badly but loyally.",
      { text: "Walter is dead and you miss him already. You will not say who you were with that night unless you trust Sam.", from: "day1" },
    ],
    situation: {
      party: "A lovely evening. You are sitting near the roses because of your hip, wishing you could get to the far end of the garden on your own. You are wearing your blue cardigan.",
      day1: "Walter died in the night. You have been crying and you are not sure you have stopped.",
      day2: "The inspector comes tonight. You are frightened of what he will ask.",
    },
    voiceLines: ["\"Oh! Sam. You startled me. Sit, sit.\"", "\"Walter always said I overbid. He was right, the beast.\"", "\"I don't sleep well, dear. The hip. One hears things.\""],
    refusals: ["\"I'd rather not, dear.\"", "\"Please don't ask me that.\""],
    tiredLine: "\"Please, dear. I'm very tired.\"", leaveLine: "\"I need to lie down. Excuse me.\"",
    bondHint: "ask about Walter gently, or help in the herb bed", minigame: "garden",
    startMood: "neutral",
    fallback: { hostile: ["Please leave me be."], guarded: ["I'd rather not."], neutral: ["Oh. Sorry, dear, say that again?"], warm: ["Oh, go on, I'm listening."] },
  },
  tomasz: {
    id: "tomasz", name: "Tomasz", role: "the night orderly", color: "#577590",
    voice: { wave: "triangle", baseHz: 300 }, look: { hair: "#5a3b1e", skin: "#f0c8a0", body: "#577590", style: "short" }, spots: { party: [31, 14], day: [23, 14] },
    aliases: ["tomasz", "tomas", "thomas", "tom", "the orderly", "orderly"],
    persona: [
      "Nervous, kind, thirty. Polish. Your English is good but you get formal when scared.",
      "You lied on your CV about a nursing qualification and Marguerite knows.",
      "You like Walter; he helps you with your English on night shifts.",
      { text: "Walter is dead and you are terrified of being blamed for something.", from: "day1" },
    ],
    situation: {
      party: "You are on shift at ten. You have come out to the party for a minute with a lemonade and you are not sure you should be here.",
      day1: "Walter died on your shift. You found nothing wrong at your rounds. You have been asked questions all morning and you want to go home and sleep.",
      day2: "The inspector comes tonight. You have not slept.",
    },
    voiceLines: ["\"Hello, Sam. You are okay? Good. Good.\"", "\"I only do nights. Days, I am sleeping, I know nothing.\"", "\"Walter helped me with my English. 'Tomasz,' he said, 'stop apologising.'\""],
    refusals: ["\"I don't know about this. Sorry.\"", "\"Please, I cannot say.\""],
    tiredLine: "\"Please. I am very tired, Sam.\"", leaveLine: "\"I must sleep now. Sorry.\"",
    bondHint: "promise not to report him, or help sort the trolley", minigame: "trolley",
    startMood: "guarded",
    fallback: { hostile: ["I cannot talk to you."], guarded: ["I don't know anything."], neutral: ["Sorry, again please?"], warm: ["Yes, okay. Ask."] },
  },
  pearl: {
    id: "pearl", name: "Pearl", role: "a resident", color: "#f4a261",
    voice: { wave: "sine", baseHz: 600 }, look: { hair: "#f5f1e6", skin: "#efc9ad", body: "#f4a261", style: "bun", extra: "glasses" }, spots: { party: [34, 16], day: [26, 3] },
    aliases: ["pearl", "mrs ashby", "ashby"],
    persona: [
      "Kind, gentle, eighty-eight. Your memory comes and goes: you sometimes mix up which day a thing happened, but what you saw, you saw.",
      "You answer what you are asked, simply. You have lost your brooch and mention it when there is a pause.",
      { text: "Walter trusted you to keep things because, he said, nobody searches Pearl.", from: "day1" },
    ],
    situation: {
      party: "A party, with music. Walter brought you a biscuit. You have lost your brooch again, a little gold bird.",
      day1: "People say Walter has died. You are not certain which day it is, but you remember the music.",
      day2: "There is a policeman coming, someone said. You would like your brooch back.",
    },
    voiceLines: ["\"Hello, dear. Have you seen my brooch? A little gold bird.\"", "\"Walter used to bring me a biscuit. Not the plain ones.\"", "\"I notice things, you know. Nobody thinks so, but I do.\""],
    refusals: ["\"I don't remember, dear.\"", "\"Have you seen my brooch?\""],
    tiredLine: "\"I'm a bit muddled now, dear.\"", leaveLine: "\"I think I'll have a little sleep.\"",
    bondHint: "find her brooch", minigame: "brooch",
    startMood: "warm",
    fallback: { hostile: ["Have you seen my brooch?"], guarded: ["Have you seen my brooch?"], neutral: ["Have you seen my brooch, dear?"], warm: ["Sit down, dear. Have you seen my brooch?"] },
  },
  dennis: {
    id: "dennis", name: "Dennis", role: "Walter's son, visiting", color: "#8d99ae",
    voice: { wave: "sawtooth", baseHz: 200 }, look: { hair: "#4a3a2a", skin: "#e8b08c", body: "#8d99ae", style: "short" }, spots: { party: [0, 0], day: [3, 14] },
    aliases: ["dennis", "walter's son", "the son"],
    persona: ["Grieving badly, fifty-five. Here to collect your father's things. Short with everyone, not unkind."],
    situation: { day1: "Your father died last night. You drove up this morning and you want to get his things and go." },
    voiceLines: ["\"Sorry. I'm just here for his things.\"", "\"He never said much to me. Said plenty to everyone else, apparently.\""],
    bondHint: "none",
    window: { day: 1, untilMinute: 15 },
    startMood: "neutral",
    fallback: { hostile: ["Not now."], guarded: ["Not now."], neutral: ["Sorry. What?"], warm: ["Sorry. What?"] },
  },
  havell: {
    id: "havell", name: "Mr Havell", role: "Walter's solicitor, visiting", color: "#8d99ae",
    voice: { wave: "triangle", baseHz: 260 }, look: { hair: "#777", skin: "#eec1a0", body: "#3b3f52", style: "short", extra: "glasses" }, spots: { party: [0, 0], day: [5, 4] },
    aliases: ["havell", "solicitor", "lawyer", "mr havell", "havel"],
    persona: ["Precise, dry. You had an appointment with Mr Bram. You say nothing about a client's affairs unless the other party already has the documents."],
    situation: { day2: "You came to keep an appointment Mr Bram made last week and found him dead. You are waiting for someone to tell you what to do with his file." },
    voiceLines: ["\"Mr Havell. I had an appointment with Mr Bram. Evidently not.\"", "\"I don't discuss a client's affairs. Even a late one.\""],
    bondHint: "none",
    window: { day: 2, untilMinute: 12 },
    startMood: "neutral",
    fallback: { hostile: ["Good day."], guarded: ["Good day."], neutral: ["I beg your pardon?"], warm: ["I beg your pardon?"] },
  },
  bodkin: {
    id: "bodkin", name: "Mr Bodkin", role: "a travelling engineer", color: "#06d6a0",
    voice: { wave: "square", baseHz: 700 }, look: { hair: "#c0392b", skin: "#f3d2b8", body: "#06d6a0", style: "hat", extra: "beard" }, spots: { party: [0, 0], day: [7, 6] },
    aliases: ["bodkin", "engineer", "the engineer", "botkin"],
    persona: ["Four foot eleven of pure confidence. Here about the boiler. You can build anything, and you say so, often. You know nothing about anyone here."],
    situation: { evening: "You are in the hall with your toolbox, talking to the boiler. A boy is asking you questions, which is fine, you like questions." },
    voiceLines: ["\"Bodkin! Boilers, bicycles, anything with a bolt in it.\"", "\"Impossible is a word for people without a toolbox.\""],
    bondHint: "none",
    evening: true,
    startMood: "warm",
    fallback: { hostile: ["Anything at all!"], guarded: ["Anything at all!"], neutral: ["Anything at all, sir! Name it!"], warm: ["Anything at all, sir! Name it!"] },
  },
};

export const RESIDENT_IDS = ["edith", "marguerite", "pugh", "rose", "tomasz", "pearl"];
export const PAGES = ["edith", "marguerite", "pugh", "rose", "tomasz", "pearl", "walter", "dennis", "havell", "bodkin", "loose"];

const F = (flag: string): Rule => ({ flag });
const ALL = (...r: Rule[]): Rule => ({ all: r });
const ANY = (...r: Rule[]): Rule => ({ any: r });

export const CLUES: Clue[] = [
  // ---- roots: need nothing ----
  { id: "edith_dead_body", npc: "edith", topic: "what Walter said, who he was angry with", text: "Walter said someone wanted the house and they'd get it over his dead body. He said that about everything, mind.", grants: ["heard_dead_body"], about: ["walter"], keywords: ["dead body", "over his", "wanted the house", "temper"] },
  { id: "edith_house", npc: "edith", topic: "the house, who owned it, its history", text: "This was Walter's house once, before it was a home. He sold it to the Fairweathers thirty years ago, widowed and broke.", grants: ["walter_owned_house"], about: ["walter"], keywords: ["walter's house", "owned", "sold", "fairweather", "thirty years", "his house"] },
  { id: "pugh_row", npc: "pugh", from: "party", mood: "neutral", topic: "the row with Walter, the sale", text: "Harrowgate want to buy this place. There's a payout for every resident. Walter is the one blocking it and I said so to his face.", grants: ["sale_rumour", "pugh_row"], about: ["walter", "pugh"], keywords: ["harrowgate", "payout", "sale", "row", "blocking", "buy this place", "argued"] },
  { id: "marguerite_medic", npc: "marguerite", topic: "the Captain, what he did before", text: "The Captain was a medic, you know. Army. He still takes everyone's pulse at bingo.", grants: ["pugh_medic"], about: ["pugh"], keywords: ["medic", "army", "captain", "pulse"] },
  { id: "tomasz_cocoa", npc: "tomasz", topic: "that night, the cocoa", text: "Marguerite made Walter's cocoa herself that night, half past nine, and carried it up. She said she was passing.", grants: ["cocoa_marguerite"], about: ["marguerite", "walter"], keywords: ["cocoa", "half past nine", "nine thirty", "carried", "made it herself", "marguerite made"] },
  { id: "marguerite_key", npc: "marguerite", topic: "the medicines, who has the key", text: "I keep the medicine cabinet key. Nobody else. I'm very careful about that.", grants: ["only_key"], about: ["marguerite"], keywords: ["key", "cabinet", "nobody else", "only key", "medicine"] },
  { id: "scene_teetotal", npc: "scene", from: "party", topic: "Walter's nightcap", text: "Walter, raising his cocoa at the party: 'Twenty years dry and I still get a nightcap.'", grants: ["walter_teetotal"], about: ["walter"], keywords: ["twenty years", "dry", "nightcap", "doesn't drink", "teetotal", "didn't drink"] },
  { id: "dennis_house", npc: "dennis", day: 1, topic: "his father", text: "Dad said someone wanted the house. He was fighting it. He wouldn't say who.", grants: ["sale_rumour"], about: ["walter"], keywords: ["wanted the house", "fighting", "dad", "wouldn't say"] },
  { id: "loose_pharmacy_slip", npc: "loose", topic: "the hall noticeboard", text: "A pharmacy delivery slip pinned in the hall: Bram, W. — digoxin, 28 capsules, this week.", grants: ["pharmacy_slip"], about: ["walter"], keywords: ["slip", "pharmacy", "twenty-eight", "28", "capsules", "digoxin", "delivery"] },
  { id: "rose_wheelchair", npc: "rose", from: "party", topic: "how she's getting on, her hip", text: "I'd give anything for one of those electric wheelchairs. I could get to the garden on my own.", grants: ["rose_wheelchair_wish"], about: ["rose"], keywords: ["wheelchair", "electric", "garden on her own", "get about", "getting on", "hip", "getting about", "walk"] },
    { id: "bodkin_wheelchair", npc: "bodkin", from: "evening", needs: F("rose_wheelchair_wish"), topic: "building a wheelchair", text: "An electric wheelchair? Child's play. Delivered by breakfast, sir, or my name's not Bodkin.", grants: ["wheelchair_requested"], about: ["rose", "bodkin"], keywords: ["wheelchair", "breakfast", "delivered", "build"] },

  // ---- A. the sale ----
  { id: "rose_fears_sale", npc: "rose", needs: ANY(F("sale_rumour"), F("walter_owned_house")), mood: "neutral", topic: "the sale", text: "If Harrowgate buy it they'll split us up. Move the ones who can't pay. I can't pay.", grants: ["rose_fears_sale", "sale_rumour"], about: ["rose"], keywords: ["split us up", "can't pay", "harrowgate", "move", "sale"] },
  { id: "edith_aside", npc: "edith", needs: ALL(F("heard_dead_body"), F("sale_rumour")), mood: "neutral", topic: "who Walter was angry with", text: "It was Marguerite he said it to, at the party. Over my dead body. I thought it was about the new carpets.", grants: ["dead_body_marguerite"], about: ["marguerite", "walter"], keywords: ["marguerite", "said it to", "carpets", "angry with", "aside"] },
  { id: "tomasz_suit_man", npc: "tomasz", needs: F("sale_rumour"), mood: "neutral", topic: "visitors", text: "A man in a suit came twice last month. Measuring. Marguerite said he was from the insurance.", grants: ["suit_man"], about: ["marguerite"], keywords: ["suit", "measuring", "insurance", "twice", "visitor"] },

  // ---- B. Marguerite's lie ----
  { id: "marguerite_denies", npc: "marguerite", needs: F("sale_rumour"), topic: "the sale", deflect: "People will say anything, love. Have you eaten?", text: "There is no sale. People talk. Walter talked most of all.", grants: ["marguerite_denies_sale"], about: ["marguerite"], keywords: ["no sale", "denies", "people talk", "there is no"] },
  { id: "marguerite_admits", npc: "marguerite", needs: ALL(F("marguerite_denies_sale"), ANY(F("letter_found"), F("suit_man"), F("havell_confirms"))), topic: "the sale, again", text: "Talks. Exploratory talks, nothing more. Walter misunderstood, as he did.", grants: ["marguerite_admits_talks"], about: ["marguerite"], keywords: ["exploratory", "talks", "admits", "misunderstood", "nothing more"] },

  // ---- C. fact one: Pugh went in at 9:50 ----
  { id: "pugh_alibi", npc: "pugh", needs: F("sale_rumour"), lockedBy: "pugh_visit_950", mood: "neutral", topic: "where he was that night", deflect: "Where I always am of an evening, boy. Mind your own.", text: "That night? In my room by half nine, like always. Lights out.", grants: ["pugh_alibi_claim"], about: ["pugh"], keywords: ["his room", "half nine", "nine thirty", "lights out", "alibi", "in bed", "where were you"] },
  { id: "tomasz_saw_pugh", npc: "tomasz", needs: ANY(F("cocoa_marguerite"), F("pugh_alibi_claim")), mood: "neutral", topic: "the Captain that night", text: "I saw the Captain go up the stairs at ten to ten. The cocoa was already up by then.", grants: ["tomasz_saw_pugh"], about: ["pugh"], keywords: ["captain", "stairs", "ten to ten", "nine fifty", "went up", "saw"] },
  { id: "rose_garden", npc: "rose", needs: ANY(F("pugh_alibi_claim"), F("blue_cardigan")), mood: "warm", topic: "where she was that night", deflect: "I was outside for a while, dear. That's all I'll say.", text: "I was in the garden from twenty-five past nine. With a friend. I'd rather not say who.", grants: ["rose_garden"], about: ["rose"], keywords: ["garden", "twenty-five past", "nine twenty-five", "friend", "rather not say"] },
  { id: "rose_pugh_left", npc: "rose", needs: F("rose_garden"), mood: "warm", bond: true, topic: "her friend", deflect: "A friend. I said. Please don't press me.", text: "It was Alistair. He left me at ten to ten to go and say sorry to Walter.", grants: ["rose_saw_pugh_go"], about: ["pugh", "rose"], keywords: ["alistair", "captain", "ten to ten", "say sorry", "left me", "apologise"] },
  { id: "pearl_saw_pugh", npc: "pearl", needs: F("pugh_row"), bond: true, topic: "the Captain", text: "The Captain came out of Walter's room like he'd seen a ghost. After the music.", grants: ["pearl_saw_pugh"], about: ["pugh"], keywords: ["captain", "ghost", "came out", "walter's room", "after the music"] },
  { id: "pugh_garden", npc: "pugh", needs: ANY(F("rose_garden"), F("tomasz_saw_pugh"), F("pearl_saw_pugh")), mood: "warm", topic: "the garden that night", text: "All right. I was in the garden with Rose. Keep that to yourself, there's a good lad.", grants: ["pugh_garden"], about: ["pugh", "rose"], keywords: ["garden", "rose", "with rose", "keep that"] },
  { id: "pugh_admits_visit", npc: "pugh", needs: ANY(F("tomasz_saw_pugh"), F("rose_saw_pugh_go"), F("pearl_saw_pugh")), mood: "neutral", topic: "going up to Walter's room", deflect: "I've said what I've said about that night. Leave it, boy.", text: "Fine. I went up at ten to ten to say sorry. He was slurring. I thought he'd had a skinful. I left him.", grants: ["pugh_visit_950"], about: ["pugh", "walter"], keywords: ["went up", "ten to ten", "slurring", "skinful", "left him", "admits", "say sorry"], leakTerms: ["slurring", "skinful"], critical: true },

  // ---- D. fact two: Pugh knew ----
  { id: "edith_teetotal", npc: "edith", topic: "Walter's habits", text: "Walter hadn't touched a drop in twenty years. Not since Margaret died.", grants: ["walter_teetotal"], about: ["walter"], keywords: ["drop", "twenty years", "margaret", "teetotal", "didn't drink", "doesn't drink"] },
  { id: "rose_teetotal", npc: "rose", topic: "Walter's habits", text: "Walter? Not a drop since Margaret died. Twenty years. He was proud of it.", grants: ["walter_teetotal"], about: ["walter"], keywords: ["drop", "twenty years", "margaret", "teetotal", "didn't drink", "proud"] },
  { id: "pugh_war_stories", npc: "pugh", bond: true, topic: "his army days, medicines, what the pills do", text: "Thirty years a medic. I've seen more overdoses than you've had hot dinners, boy.", grants: ["pugh_medic"], about: ["pugh"], keywords: ["medic", "overdoses", "hot dinners", "army", "thirty years"] },
  { id: "tomasz_antidote", npc: "tomasz", needs: F("cocoa_marguerite"), bond: true, topic: "what the doctor said", text: "The doctor said if someone had rung 999 at ten he would have lived. There is an antidote for those pills.", grants: ["could_have_saved"], about: ["walter"], keywords: ["doctor", "999", "antidote", "would have lived", "saved", "rung"], critical: true },
  { id: "edith_doctor", npc: "edith", needs: F("pugh_visit_950"), mood: "warm", topic: "what the doctor said", text: "I asked the doctor myself. A call at ten and he'd be alive. They have an antidote for it, apparently.", grants: ["could_have_saved"], about: ["walter"], keywords: ["doctor", "antidote", "alive", "call at ten", "saved"], critical: true },
  { id: "rose_white", npc: "rose", needs: F("pugh_visit_950"), mood: "warm", bond: true, topic: "after the apology", text: "He came back white as a sheet. He said 'it's done, Rosie, it's going to be all right.' I thought he meant the apology.", grants: ["pugh_came_back_white"], about: ["pugh"], keywords: ["white as a sheet", "it's done", "came back", "all right", "apology"], critical: true },
  { id: "pugh_breaks", npc: "pugh", needs: ALL(F("pugh_visit_950"), F("walter_teetotal"), F("pugh_medic"), F("could_have_saved")), mood: "neutral", bond: true, topic: "what he really saw", deflect: "I don't want to talk about it. Deal the cards or go.", text: "He didn't drink. I knew that. I know what a digoxin overdose looks like. I stood there and I thought about the payout. And I went back to the garden.", grants: ["pugh_knew"], about: ["pugh", "walter"], keywords: ["knew", "overdose", "digoxin", "payout", "stood there", "went back", "could have saved", "let him die"], leakTerms: ["digoxin", "stood there"], critical: true },
  { id: "pugh_tray", npc: "pugh", needs: F("pugh_knew"), mood: "warm", topic: "the stairs, the tray", text: "She was on the stairs with the tray. Nine forty. I saw the mug by his bed after, sediment in it.", grants: ["pugh_saw_tray"], about: ["marguerite", "pugh"], keywords: ["tray", "stairs", "nine forty", "sediment", "mug", "marguerite"], leakTerms: ["tray", "sediment"], critical: true },

  // ---- E. means ----
  { id: "tomasz_count", npc: "tomasz", needs: ALL(F("cocoa_marguerite"), F("only_key")), mood: "warm", bond: true, lockedBy: "accused_tomasz", topic: "the medicines", deflect: "The cabinet is Marguerite's. I only push the trolley. Please.", text: "The count was four short next morning. Four capsules. Only she has the key. I said nothing because of my papers.", grants: ["tomasz_count_short"], about: ["marguerite", "tomasz"], keywords: ["four short", "capsules", "count", "key", "papers", "missing"], leakTerms: ["four short", "four capsules"], critical: true },
  { id: "edith_blister", npc: "edith", needs: ALL(F("cocoa_marguerite"), F("pharmacy_slip")), mood: "warm", topic: "Walter's pills", text: "I counted his blister pack after the police left. Twenty-eight came, twenty-four left. He took one a day. Four gone in a night.", grants: ["edith_blister"], about: ["walter"], keywords: ["blister", "counted", "twenty-four", "four gone", "pills", "pack"], critical: true },
  { id: "edith_chain", npc: "edith", from: "day2", needs: F("chandelier_fell"), topic: "the chandelier", text: "That chain was cut, Sam. Clean. And the attic key is on the staff ring.", grants: ["chain_cut"], about: ["marguerite"], keywords: ["chain", "cut", "attic", "staff ring", "chandelier"] },

  // ---- F. motive ----
  { id: "pearl_papers", npc: "pearl", needs: ANY(F("walter_owned_house"), F("sale_rumour")), bond: true, topic: "Walter's things", text: "Walter gave me something to keep. Nobody searches Pearl, he said. I've put it somewhere safe. Somewhere.", grants: ["pearl_has_papers"], about: ["walter", "pearl"], keywords: ["something to keep", "nobody searches", "papers", "safe", "gave me"] },
  { id: "pearl_box", npc: "pearl", needs: F("pearl_has_papers"), bond: true, topic: "where she put it", deflect: "Somewhere safe, dear. I'll remember. Have you seen my brooch?", text: "The box! With the brooch. There's a letter from a solicitor and a note in her hand: 'Please, Walter. One signature.'", grants: ["letter_found"], about: ["marguerite", "walter"], keywords: ["box", "letter", "solicitor", "one signature", "note", "please walter", "offer"], leakTerms: ["signature", "solicitor"], critical: true },
  { id: "havell_covenant", npc: "havell", from: "day2", day: 2, needs: F("letter_found"), topic: "his appointment", text: "The covenant ended with Mr Bram's death. The sale may now proceed. I assumed you knew, since you have the letter.", grants: ["havell_confirms"], about: ["walter", "marguerite"], keywords: ["covenant", "ended", "death", "sale may proceed", "solicitor confirms"], leakTerms: ["covenant"], critical: true },

  // ---- G. opportunity ----
  { id: "pearl_cardigan", npc: "pearl", bond: true, topic: "who went in to Walter", text: "The lady in the blue cardigan went in to Walter after the music. I waved. She didn't.", grants: ["blue_cardigan"], about: ["marguerite", "rose"], keywords: ["blue cardigan", "cardigan", "went in", "lady", "after the music"], critical: true },
  { id: "rose_not_me", npc: "rose", needs: ALL(F("blue_cardigan"), F("rose_garden")), mood: "warm", topic: "the blue cardigan", text: "I was in the garden. Whoever went in wearing blue, it wasn't me. Marguerite wore blue too, you know.", grants: ["rose_not_cardigan"], about: ["rose", "marguerite"], keywords: ["wasn't me", "blue", "marguerite wore", "garden", "cardigan"], critical: true },
];

/** Flags computed from other flags after every recording. Three routes each. */
export const DERIVED: DerivedFlag[] = [
  { flag: "proof_means", label: "Means: four capsules, one key", when: ANY(F("tomasz_count_short"), F("edith_blister"), ALL(F("only_key"), F("pugh_saw_tray")), ALL(F("only_key"), F("chain_cut"))) },
  { flag: "proof_motive", label: "Motive: the covenant and the sale", when: ANY(F("letter_found"), F("havell_confirms"), ALL(F("dead_body_marguerite"), F("marguerite_admits_talks"))) },
  { flag: "proof_opportunity", label: "Opportunity: the blue cardigan at 9:40", when: ANY(F("rose_not_cardigan"), F("pugh_saw_tray"), ALL(F("cocoa_marguerite"), F("blue_cardigan"))) },
];

export interface MinigameDef {
  id: string;
  npc: string;
  title: string;
  blurb: string;
  minutes: number;
}

export const MINIGAMES: Record<string, MinigameDef> = {
  crossword: { id: "crossword", npc: "edith", title: "The crossword", blurb: "Three clues. The answers are things she has told you.", minutes: 3 },
  cards: { id: "cards", npc: "pugh", title: "Captain's Patience", blurb: "Higher or lower. Losing gracefully counts.", minutes: 3 },
  garden: { id: "garden", npc: "rose", title: "The herb bed", blurb: "Pull the weeds, leave the flowers.", minutes: 3 },
  trolley: { id: "trolley", npc: "tomasz", title: "The trolley", blurb: "Match each medicine to the right resident.", minutes: 3 },
  brooch: { id: "brooch", npc: "pearl", title: "The brooch", blurb: "It is in the lounge, among everything else.", minutes: 3 },
};

export type Outcome = "O1" | "O2" | "O3";

export const SCENES = {
  prologue: [
    "Summer. Willowmere, a small retirement home at the end of a lane. Your grandmother Edith meets you at the gate.",
    "\"There's a row brewing about the house,\" she says, before hello. \"You'll hear it tonight.\"",
    "The midsummer party. Captain Pugh and Walter Bram argue about a sale in front of everyone. Walter and Marguerite, the manager, have a tense word by the roses; Edith is near enough to hear the end of it.",
    "Rose and the Captain are both in blue. Walter raises his cocoa to the table: \"Twenty years dry and I still get a nightcap.\"",
  ],
  discovery: [
    "Morning. Walter Bram is dead in his bed. The doctor says heart.",
    "Edith puts something in your hand: your father's old pocket tape recorder. \"He was fine last night. He'd have wanted this used. Find out.\"",
    "The county inspector, Halloran, arrives tomorrow evening. You have today and tomorrow.",
    "Hold SPACE to talk. Hold R to speak into the tape. Nothing counts until it is on tape.",
  ],
  evening1: [
    "Evening, Day 1. The residents are at supper. A very small man with a very large toolbox is in the hall, looking at the boiler and talking to it.",
  ],
  morning2: [
    "Day 2. Halloran arrives tonight.",
  ],
  wheelchair: [
    "There is an electric wheelchair in the hall with a bow on it. Rose is already in it, doing laps. \"Sam! Anything you need. Anything.\"",
  ],
  chandelier: [
    "You step into the lounge. The chandelier comes down where you were standing a second ago.",
  ],
  chandelierSaved: [
    "You step into the lounge. Something hits you from the side at speed: Rose, in the chair. The chandelier comes down where you were standing.",
    "\"Told you,\" she says. \"Anything.\"",
  ],
  gathering: [
    "Evening, Day 2. Inspector Halloran has everyone in the lounge. He looks at you. \"Your grandmother says you've been asking questions. Well?\"",
  ],
  O1: [
    "You name the Captain.",
    "He does not defend himself. He looks at the floor and lets them take him; he thinks he deserves it.",
    "A week later the Harrowgate sign goes up at the gate. Rose is moved to a home forty miles away.",
    "Edith, on the last night: \"He went in. Did you ever ask him what he saw?\"",
  ],
  O2: [
    "You name Marguerite.",
    "Halloran: \"And the man who was seen going in?\" You tell him. The Captain went in at ten to ten and found a dying man and did nothing, because a dead man ends a covenant and a covenant was all that stood between him and a payout.",
    "Marguerite listens to the rest with her hands folded. Then: \"He could have signed. One line. I asked him so many times.\"",
    "Harrowgate withdraws. Halloran, leaving: \"The Captain walks. Omission isn't murder. He'll have to live with that.\"",
    "Edith: \"Your father would have been slower.\"",
  ],
  O3: [
    "Halloran listens. Then: \"And the man who was seen going in?\"",
    "You have no answer. Marguerite does: exploratory talks, a key that hangs on a hook, half the room in blue.",
    "Halloran takes the man who was seen going in.",
  ],
  O3_hint_pugh: ["Edith, on the last night: \"The Captain went in, Sam. Did you ever ask him what he saw?\""],
  O3_hint_proof: ["Edith, on the last night: \"You knew. You just couldn't show it. That's the part that takes patience.\""],
  O3_hint_nobody: ["Edith, on the last night: \"You had to say something, love. Anything.\""],
} as const;

export function clueById(id: string): Clue | undefined {
  return CLUES.find((c) => c.id === id);
}

export function cluesFor(npcId: string): Clue[] {
  return CLUES.filter((c) => c.npc === npcId);
}

export function grantsOf(c: Clue): string[] {
  return c.grants ?? [c.id];
}
