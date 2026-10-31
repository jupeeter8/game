# Murder at Willowmere — story layout (draft 5, 2026-10-27)

Working title. Everything here is swappable; the structure is the point.

Draft 5 adds: two investigation days with a minute budget, a per-conversation clock that
excludes model and transcription latency, the chandelier attempt, the engineer and the electric
wheelchair, one minigame per NPC, and a live state graph beside the game. See "Time, events and
minigames" below. The play build lives at `play.html`.

Draft 4 changes: numeric trust and the memory system are gone. Per-NPC state is two small discrete
states (mood, patience) plus one bond flag, in the spirit of Event[0]. Clues only count once the
player records them on a tape recorder. Asking about something you have no recording for gets
deflection, then tiredness, then the NPC leaves. The recorder is Sam's father's and replaces the
casebook. Story, cast, three outcomes and win condition are unchanged from draft 3b.

## Pitch

Sam (16) is spending the summer at Willowmere, a small retirement home, with his grandmother Edith.
Sam's father was a police detective who died two years ago. On the night of the midsummer garden
party a resident, Walter Bram, dies in his room. The doctor says heart failure. Edith does not
believe it. The county inspector arrives in two days; by then Sam must have a case, or the
inspector will take the obvious answer.

## Design rules

1. **Evidence never lies. People do.** The game never grants a false flag. Every NPC lie has at
   least three independent ways to be caught.
2. **Nothing counts until it is on tape.** An NPC saying something does not set a flag. The player
   recording it does. The recorder can only match things an NPC has actually voiced this game, so
   speaking a guess into it never creates a flag.
3. **The trap is incompleteness, not misdirection.** Everything about Pugh is true. Accusing him is
   the player choosing to stop digging.
4. **Mistakes are actions with a visible cost the same turn.** Rudeness moves mood. Pushing without
   a recording moves patience. Accusing to someone's face makes them hostile. Nothing is a hidden
   number.
5. **Every conclusion has three routes.** And from any state there is always at least one
   recordable clue available.
6. **No prompt holds the answer.** Locked reveals contribute only a short topic label to the
   prompt, never text, so the NPC can deflect on-topic. Labels must not leak ("the house's
   ownership", never "the covenant"). The win is a conjunction of flags from four different people.

## Core mechanics

### The recorder

Sam's father's old pocket tape recorder. Edith hands it over at M2: "He'd have wanted it used."

- **Hold Space** to talk to the NPC in front of you. **Hold R** to speak into the tape.
- A recording is transcribed by Whisper, then matched against the **candidate pool**: clues that
  have been voiced this game and not yet recorded. The pool is usually one to five items, so
  matching is word overlap against the clue text and the speaker's name, no model call. The model
  is consulted only to break a tie.
- A match sets the clue's flag. The player can file it under the person they heard it from or the
  person it is about: "Edith said Walter owned the house" or "about Walter, he owned the house."
  Both are accepted. If no person is named, it files under the speaker.
- No match: the note is kept as a loose note on the last page, no flag. The player can hear it back.
- The tape has one page per resident, one for Walter, one for each visitor, and a loose page.
- **Contradictions** are two recordings that clash. There is no separate mechanic: the player puts
  them to the NPC in words ("You said you were in your room. Tomasz saw you on the stairs"), and
  the NPC's reveal for that contradiction requires both flags.
- Scripted scene lines (the party, the discovery) go into the same pool and are recordable.

Open UX question: whether a voiced clue gets a subtle cue (a reel icon on the reply) so the
player knows there is something to record. Recommend on by default and tunable off.

### Mood and patience (replaces trust, happiness, busyness and memories)

Each NPC has:

- **Mood:** `warm` → `neutral` → `guarded` → `hostile`. Moves one step per turn by the tone of
  what the player said, as classified by the model's per-turn output (kind / plain / rude /
  accusing). Accusing to their face jumps straight to hostile. At each day boundary mood relaxes
  one step toward neutral. Hostile NPCs answer in one line and share nothing.
- **Patience:** `fresh` → `tired` → `done`. Each question about a topic the player has no
  recording for moves it one step. At `done` the NPC ends the conversation and is unavailable for
  the next 6 turns. Patience resets to fresh when a conversation ends. Leaving is the cost; nobody
  stays tired all day.
- **Bond:** one flag per NPC, set by doing the one thing they want from Sam. Secrets need it.

A reveal's rule is: **needs** (recorded clues), **mood** (minimum), **bond** (yes/no).

### Conversation flow

1. Player speaks. Model classifies tone and picks a topic from the enum of available topic labels.
2. If the topic maps to an unlocked, unvoiced reveal and mood and bond pass: the NPC voices it.
   The clue enters the candidate pool.
3. If the topic maps to a locked reveal: the NPC deflects on-topic. Patience moves one step.
4. If the player repeats a recorded clue to the NPC as a contradiction and the matching reveal
   exists: step 2 applies.
5. Mood moves by tone. At `done`, the NPC leaves.

## Time, events and minigames (draft 5)

### Days
The party and the arrival are a short scripted prologue, outside the clock. Walter is found on
the morning of **Day 1**. The player has **Day 1 and Day 2**. The gathering is the end of Day 2.

Each day has a budget of **activity minutes** (default 45). Conversations and minigames spend it.
When it runs out the day ends: Day 1 ends with the evening scene (the engineer's visit), Day 2
ends with the gathering. Reading, thinking and walking between rooms are free.

### The conversation clock
Each conversation may last **5 minutes** of *active time* before the NPC tires and ends it
("I need a sit down, dear"). Active time is wall-clock time while the conversation is open,
**minus** every interval the game spends waiting: model generation, Whisper transcription, and
the typewriter printing a reply. The clock is paused during those, so a slow model never costs
the player. The limit rises by **1 minute per completed minigame**, to a cap of **7 minutes**.
Active time also drains the day budget. Patience (fresh/tired/done) still applies on top.

### The chandelier (Day 2)
The game keeps a **closeness** count: how many of the critical clues are on tape (fact one,
fact two, and the three proofs' pieces). When closeness crosses a threshold on Day 2, the next
time the player enters the lounge the chandelier comes down. Nobody is killed. Consequences:
- Sam is shaken: **10 minutes** of the day budget are lost, unless the electric wheelchair
  exists, in which case Rose, who now moves faster than anyone in the building, knocks him clear
  and nothing is lost.
- It is a clue, and a true one. Edith: "That chain was cut. The attic key is on the staff ring."
  Recordable as `chain_cut`, a third route to means.
- Marguerite's nervousness rises and she stops being helpful.
It is not a mistake by the player and it is not misdirection. It is the game answering the
player's progress, and it tells them they are right.

### The engineer and the wheelchair
On Day 1 Rose says, unprompted and early, that she wishes she had an electric wheelchair
(`rose_wheelchair_wish`, a root clue). At the end of Day 1 **Mr Bodkin**, a travelling
engineer of enormous confidence and tiny stature, visits for three turns to look at the boiler.
If spoken to, he says he can build anything. If asked for the electric wheelchair (needs
`rose_wheelchair_wish` on tape), it is delivered on the morning of Day 2.

The wheelchair is the game's one **undo**. It does two things:
- Rose, mobile at last, will once **vouch** for Sam with any NPC: that NPC's mood resets to
  neutral, a "done" patience clears, and the `accused_tomasz` lock is lifted if it was Tomasz.
- The chandelier costs nothing (above).
Mr Bodkin is the ninth talkable character. He is never a suspect and knows nothing.

### Minigames
One per NPC, based on who they are. Each costs **3 activity minutes**, sets that NPC's bond,
and adds one minute to the conversation limit (cap 7). Losing still costs the minutes; only a
completed game sets bond.

| NPC | Minigame | Shape |
|---|---|---|
| Edith | The crossword | Fill three clues; the answers are things she has told you |
| Pugh | Captain's Patience | A short higher-or-lower card game; losing gracefully counts |
| Rose | The herb bed | Pull the weeds among the flowers before the timer |
| Tomasz | The trolley | Match each medicine to the right resident |
| Pearl | The brooch | Find it in the lounge, among a dozen other objects |
| Marguerite | none | She wants nothing from Sam |

### The state graph
Beside the game, a graph of every clue, bond, event and outcome, with an edge for each
"needs". Nodes are bright when on tape, half when voiced but not recorded, outlined when
available to ask about, dim when locked. Clicking a node shows its rule and the live trace.
The game maintains it from state; nothing is hand-drawn.

## Progressive prompts (2026-10-29)

An NPC's prompt contains only what exists for them right now, and grows with the player's progress.
Nothing from a later phase is "forbidden"; it is absent, so the NPC simply does not know it.

- **Phases**: party → day1 → evening → day2. `WORLD[phase]` is the one line that tells the model the date
  and the news. Each NPC has a `situation` per phase (what they know and feel), and persona lines can
  switch on at a phase or when a flag is set (`Layered`).
- **Clues have a `from` phase.** Before it the clue is *not yet*: no text, no topic label, not in the
  schema enum. The party has exactly three clues (Walter's nightcap line, Rose's wheelchair wish, the
  Captain's row); the house's ownership and everything about the night are day-1 material.
- **In play** = sharable, voiced, withheld (mood or bond), or locked and exactly one taped flag away.
  Only in-play clues contribute a topic label. A clue two flags away, or waiting on an event flag
  (the chandelier), is unknown to the NPC: asking lands on topic "other" and costs no patience.
- **Deflection is one in-voice line per near clue** (`deflect`, e.g. "I told you. My room, half nine."),
  never a list of subjects and never a prohibition that names them.
- **Guards**: the share verifier (a claimed share must carry the clue's words), the reply leak check
  (now covering not-yet clues), and a new prompt-leak check that fails if any non-sharable clue text or
  out-of-play label appears in the system prompt. `MTurnReport` carries `phase` and `promptLeaks`.
- Tests pin all of this: party prompts contain no future vocabulary; labels grow as flags are taped;
  the schema enum equals the in-play labels; looking around pools nothing at the party.

## Real-model testing

`e2e/driver.mjs` owns a headed Chromium/Brave session with WebGPU and a persistent profile (model
downloaded once) and exposes it over HTTP so a tester can talk to NPCs one line at a time and read the
full turn report. A fake microphone path feeds WAVs made with macOS `say`. Findings land in
`e2e/out/<model>/issues.md`.

## Budget

| Thing | Number | Why |
|---|---|---|
| Activity minutes | 2 days × 45 | Conversations + minigames |
| Conversations | ~14-18 | 5-7 min each |
| Recordings | 20-30 | Whisper only, no model call |
| Talkable NPCs | 9 | 6 present on the night, 2 daytime visitors, the engineer |
| Clue reveals | ~35 | listed below |
| Outcomes | 3 | see below |

## The solution

**Victim:** Walter Bram, 81. Willowmere was his family house. Thirty years ago, widowed and broke,
he sold it to the couple who founded the home, on one condition in the deed: he lives there until
he dies, and while he lives the house is never sold to a chain. Teetotal for twenty years. Takes
digoxin for his heart. Cocoa at 9:30 every night, made in the staff kitchen.

**Culprit:** Marguerite Okafor, the manager. Took over from the founders eight years ago; has kept
the home open on a mortgage she cannot service. A chain, Harrowgate, will buy Willowmere, clear the
debt and keep her on. The covenant blocks the sale. She asked Walter for weeks to sign a waiver.
At the party, within Edith's hearing, he said: "You'll get this house over my dead body."

**Means:** She holds the only key to the medication cabinet. She emptied four of Walter's digoxin
capsules into his cocoa at 9:30. **Opportunity:** she carried it up herself and looked in at 9:40.
Pearl saw "the lady in the blue cardigan" go in. Rose also wore blue.

**The Captain:** Alistair Pugh, resident, ex-army medic, broke, wants to move near his daughter.
Harrowgate's offer includes a resident payout, so he wanted the sale and rowed with Walter about it
at the party. At 9:50 he went up to apologise. He saw Marguerite on the stairs with the tray at
9:40 as he came in from the garden; the mug with sediment at the bedside; Walter slurring, pulse
slow. He is a medic and Walter does not drink. He knew it was the pills and that a 999 call would
have saved him. He thought about the payout, told himself it was a heart attack, and went back to
the garden.

**Fact one:** Pugh went into Walter's room at 9:50. Alone, it makes him look like the killer.
**Fact two:** Pugh knew Walter could be saved and did nothing. Alone, it explains fact one. The
player needs both: fact one to know there is a hole in any case against Marguerite, fact two to
close it.

## The three outcomes

| # | Outcome | Trigger | Result |
|---|---|---|---|
| O1 | **Lose: the Captain** | Sam names Pugh | Pugh is charged and does not defend himself. Harrowgate's sign goes up. Edith: "He went in. Did you ever ask him what he saw?" |
| O2 | **Win: the complete case** | Sam names Marguerite holding `pugh_knew` and at least 2 of `proof_means`, `proof_motive`, `proof_opportunity` | Halloran: "And the man who was seen going in?" Sam explains. Marguerite's scripted confession. Harrowgate withdraws. Halloran: "The Captain walks. Omission isn't murder. He'll have to live with that." Edith: "Your father would have been slower." |
| O3 | **Lose: the wrong person** | Anyone else; Marguerite with an incomplete case; nobody | Halloran asks about the man seen going in; Sam cannot answer; Marguerite deflects the paper; Halloran takes the Captain. Three flavour texts; Edith's last line hints at the missing piece. |

## Cast and relationships

Relationship = mood (how they feel about Sam right now) + bond (whether Sam did the one thing).

| NPC | Who | The one thing (bond) | What makes them guarded |
|---|---|---|---|
| **Edith** | Grandmother, hub. Walter's oldest friend. Cool toward Marguerite. Does not talk about Sam's father. | Sit with her in the evening (1 turn, end of day) | Accusing anyone early ("you sound like the television") |
| **Marguerite** | Manager, culprit. Warm, tired. Everything she says about Pugh is true. One lie: "there is no sale." | None reachable. | Nothing visible. Nervousness rises; she tidies evidence. |
| **Captain Pugh** | Resident, the key. Loud, pro-sale. Secret romance with Rose. Respects a straight game of cards. | Play cards and lose gracefully (2 turns) | Being treated as a suspect; anyone mentioning Rose |
| **Rose** | Walter's bridge partner. Dreads the sale. The cost of exposing Pugh falls on her. | Ask about Walter gently before asking about that night | Her secret repeated before she has told it |
| **Tomasz** | Night orderly. Lied on his CV; Marguerite knows. Liked Walter. | Say you will not report him | Any hint of being accused |
| **Pearl** | Dementia. Walter's trusted keeper of papers. Believed by no one. | Find her brooch (2 turns in the lounge) | Impatience; recovers with one kind turn |
| **Dennis** | Walter's son. Day 2 morning, 10 turns. Not a suspect. | None | None |
| **Mr Havell** | Solicitor. Day 3 morning, 8 turns. Keeps the appointment Walter made. | None | None |

The web: Edith–Walter old friends; Edith–Marguerite polite distrust; Rose–Pugh secret romance;
Rose–Walter fond bridge partners; Pugh–Walter public feud, old respect; Marguerite–Tomasz
leverage; Tomasz–Walter gratitude; Tomasz–Pugh kindness; Pearl–Walter trusted; Pearl–everyone
else ignored.

## Main events

| # | Event | Day | What happens |
|---|---|---|---|
| M0 | Arrival | prologue | Meet Edith. "There's a row brewing about the house." Tutorial: talk, then record one thing she said. |
| M1 | Garden party | prologue | Meet everyone alive. Pugh and Walter row. Walter and Marguerite in a tense aside, Edith in earshot. Rose and Pugh in blue. Walter, raising his cocoa: "Twenty years dry and I still get a nightcap." All recordable. |
| M2 | Discovery | 1 morn | Walter found dead. Doctor: heart. Dennis arrives. Edith hands Sam the recorder: "He was fine. Find out." Halloran due Day 3 evening. |
| M3 | Investigation | 1-2 | Free roam. Minutes tick. Dennis Day 1 morning, Bodkin Day 1 evening, Havell Day 2 morning, chandelier Day 2 on closeness. |
| M4 | The gathering | 2 eve | Halloran in the lounge. Sam names someone, or nobody. |

## Clue reveals, regated

Format: who — what. **needs** recorded clues; **mood** minimum (any / neutral / warm); **bond**.
Flag granted on recording. Topic label in brackets is what the prompt sees while locked.

**Roots (needs nothing; always something to record)**
1. Edith — "Walter said they'd get the house over his dead body. He says that about everything." mood any. `heard_dead_body` [Walter's temper]
2. Edith — Willowmere was Walter's house. mood any. `walter_owned_house` [the house's history]
3. Pugh — the row, the Harrowgate offer, the payout. mood neutral. `sale_rumour` [the row at the party]
4. Marguerite — "He was a medic, you know. Army." mood any. `pugh_medic` [the Captain]
5. Tomasz — cocoa made at 9:30 by Marguerite, she carried it up. mood neutral. `cocoa_marguerite` [that night]
6. Marguerite — "I keep the cabinet key. Nobody else. I'm very careful." mood any. `only_key` [the medicines]
7. Scene — Walter's "twenty years dry" at M1. `walter_teetotal`
8. Dennis — "Dad said someone wanted the house." window. `sale_rumour`
9. Loose — the pharmacy delivery slip pinned in the hall: 28 capsules this week. Found by looking. `pharmacy_slip`

**A. The sale and Walter blocking it**
10. Rose — "they'd split us up." needs `sale_rumour` or `walter_owned_house`; mood neutral. `rose_fears_sale` [the sale]
11. Edith — "It was Marguerite he said it to." needs `heard_dead_body` + `sale_rumour`; mood neutral. `dead_body_marguerite` [who Walter was angry with]
12. Tomasz — "a man in a suit came twice last month, measuring." needs `sale_rumour`; mood neutral. `suit_man` [visitors]

**B. Marguerite's lie and its three catches**
13. Marguerite — "There is no sale. People talk." needs `sale_rumour`; mood any. `marguerite_denies_sale` [the sale]
14. Catches: `letter_found` (29), Havell (30), `suit_man` (12).
15. Marguerite — concedes "talks, nothing more." needs `marguerite_denies_sale` + any catch; mood any. `marguerite_admits_talks` [the sale]. She starts tidying evidence.

**C. Fact one: Pugh went in at 9:50**
16. Pugh — "In my room by half nine." needs `sale_rumour`; mood neutral. `pugh_alibi_claim` [that night]
17. Tomasz — saw Pugh on the stairs at 9:50, after the cocoa was up. needs `cocoa_marguerite` or `pugh_alibi_claim`; mood neutral. `tomasz_saw_pugh` [the Captain]
18. Rose — the garden "with a friend" from 9:25. needs `pugh_alibi_claim` or `blue_cardigan`; mood warm. `rose_garden` [that night]
19. Rose — it was Pugh; he left at 9:50 "to say sorry to Walter." needs `rose_garden`; mood warm; bond. `rose_saw_pugh_go` [her friend]
20. Pearl — "The Captain came out of Walter's room like he'd seen a ghost." needs `sale_rumour` (Sam has heard of the Captain's row); bond. `pearl_saw_pugh` [the Captain]
21. Pugh — admits the garden. needs `rose_garden`, or bond; mood warm. `pugh_garden` [that night]
22. **Pugh — admits the visit.** needs `pugh_alibi_claim` + any of 17/19/20; mood neutral. "He was slurring. I thought he'd had a skinful. I left him." `pugh_visit_950` [that night]

**D. Fact two: Pugh knew and could have saved him**
23. Edith — Walter teetotal twenty years. needs nothing; mood neutral. `walter_teetotal` [Walter's habits]
24. Rose — same, "not a drop since Margaret died." needs nothing; mood neutral. `walter_teetotal` [Walter's habits]
25. Pugh — war stories, "more overdoses than you've had hot dinners." bond. `pugh_medic` [his army days]
26. Tomasz — the doctor said a 999 call at ten would have saved him; there is an antidote. needs `cocoa_marguerite`; bond. `could_have_saved` [what the doctor said]
27. Edith — asked the doctor herself; same. needs `pugh_visit_950`; mood warm. `could_have_saved` [what the doctor said]
28. Rose — he came back "white as a sheet", said "it's done, Rosie." needs `pugh_visit_950`; mood warm; bond. `pugh_came_back_white` [after the apology]
29. **Pugh breaks.** needs `pugh_visit_950` + `walter_teetotal` + `pugh_medic` + `could_have_saved`; mood neutral; bond. He admits he knew and did nothing. `pugh_knew` [that night]. **Required for the win.**
30. Pugh — one turn later, mood warm: "She was on the stairs with the tray. Nine forty. I saw the mug." `pugh_saw_tray` = `proof_opportunity`

**E. Means (paper proof 1)**
31. Tomasz — count four short next morning; only she has the key; he said nothing because of his CV. needs `cocoa_marguerite` + `only_key`; mood warm; bond; not `accused_tomasz`. `proof_means` [the medicines]
32. Edith — counts Walter's blister pack after the police leave: 24 used plus the four he would have taken. needs `cocoa_marguerite` + `pharmacy_slip`; mood warm. `proof_means` [Walter's pills]
33. Combination — `only_key` + `pugh_saw_tray` (the mug with sediment, the one key) counts as `proof_means` (third route).

**F. Motive (paper proof 2)**
34. Pearl — "Walter gave me something to keep. Nobody searches Pearl." needs `walter_owned_house` or `sale_rumour`; bond. `pearl_has_papers` [Walter's things]
35. Pearl — "The box, with the brooch." needs `pearl_has_papers`; bond. The Harrowgate offer, the solicitor's letter, Marguerite's note "Please, Walter. One signature." `letter_found` = `proof_motive` [Walter's things]
36. Havell — confirms the covenant ended on Walter's death. window; needs `letter_found`. `proof_motive` (confirmation route)
37. Combination — `dead_body_marguerite` + `marguerite_admits_talks` counts as `proof_motive` (third route, thinner ending text).

**G. Opportunity (paper proof 3)**
38. Pearl — "the lady in the blue cardigan went in after the music." bond. `blue_cardigan` [that night]
39. Rose — she was in the garden, so not her. needs `blue_cardigan` + `rose_garden`; mood warm. `proof_opportunity` [the blue cardigan]
40. Pugh — reveal 30. `proof_opportunity`
41. Combination — `cocoa_marguerite` + `blue_cardigan` counts as `proof_opportunity` (third route).

Three Clue check: sale (1/3/8 + 10/11/12), fact one (17/19/20), fact two pieces (23/24/7; 4/25; 26/27 + 28),
means (31/32/33), motive (35/36/37), opportunity (39/40/41). Roots 1-9 start every chain.

## Directional events

| Event | Trigger | Effect | Nudges |
|---|---|---|---|
| Find Pearl's brooch | Search the lounge, 2 turns | Pearl bond | toward 20, 34, 38 |
| Play cards, lose gracefully | Accept Pugh's challenge, 2 turns | Pugh bond, mood warm | toward 21, 25, 29 |
| Sit with Edith in the evening | End of Day 1 or 2, 1 turn | Edith bond | toward 11, 27, 32 |
| Reassure Tomasz | Say you will not report him | Tomasz bond | toward 26, 31 |
| Ask Rose about Walter gently | Before asking about that night | Rose bond | toward 19, 28 |
| Take Pugh's side on the sale | Say the payout sounds fair | Pugh mood +1 step, Rose mood -1 step | Pugh route opens |
| Take Rose's side on the sale | Say nobody should be moved | mirror | mirror |
| **Push a locked topic** | Ask about something with no recording | Patience one step; at done the NPC leaves for 6 turns | wastes turns |
| **Be rude** | Tone classified rude | Mood one step toward guarded | secrets close |
| **Accuse Pugh to his face** | Dialogue | Pugh hostile until day boundary; Rose guarded | **away** from 29 |
| **Accuse Tomasz to his face** | Dialogue | `accused_tomasz`; Tomasz hostile; 31 locked for good | means via 32 or 33 |
| **Repeat Rose's secret** | Mention the garden to Pugh or Edith before Rose tells it | Rose hostile; Pugh guarded | away from 19, 28 |
| **Tell Marguerite you are investigating** | Dialogue | She is very helpful about Pugh (all true); the meds log is "lost" a day later unless Tomasz bond is set | time pressure on 31 |
| **Show Marguerite the letter early** | Dialogue with `letter_found` | Walter's room "cleaned for the family"; mug gone (flavour) | warning shot |
| **Accuse early (Day 2)** | Name anyone before Halloran | Named NPC hostile; Marguerite tidies | away |
| Miss Dennis / Miss Havell | Not present in their window | Alternate routes only | neutral |

Bold rows are the active mistakes. Each is something Sam says or does, each has a visible cost
the same turn, and each leaves at least one route open.

## Why the player loses, when they lose

- They found fact one and stopped. Pugh's lie plus three witnesses on the stairs is a
  complete-looking case, and the clock makes stopping tempting.
- They burned Pugh. Hostile until the day boundary, and the cards event costs turns.
- They built the paper case and never explained the man in the room. Halloran will.
- They heard the clues and never recorded them. The game is honest about this: an NPC will say
  "I told you that already" if asked for a voiced-but-unrecorded clue again, and voice it again.

## How this maps onto the engine (built 2026-10-27, `src/mystery/` + `src/play/`)

- Clue = `Clue` in `src/mystery/content.ts`: `needs` rule over taped flags, `mood` floor, `bond`,
  `topic` label for the locked case, `keywords` for the recorder, `leakTerms` for the guard,
  `critical` for closeness, `lockedBy` for the Tomasz lock. Derived proofs are `DERIVED`.
- Per-turn model output enum: tone (kind/plain/rude/accusing) + topic (from the available labels)
  + reply. Code moves mood and patience; code picks which reveal to voice.
- Voiced-but-unrecorded clues live in a candidate pool; recording moves one to flags.
- Per-NPC state is `NpcRt` in `src/mystery/state.ts`: mood, patience, pushes, awayUntil, voiced,
  history, bond. The corporate engine under `src/game/` is untouched and still drives `lab.html`.
- Visitors = NPCs whose availability is a day/turn window.
- M4 outcome rule: O2 if named = Marguerite AND `pugh_knew` AND 2 of 3 proofs; O1 if named = Pugh;
  else O3.
- Days and minutes: `src/mystery/events.ts` (beginDay, spendMinutes, endDay, chandelier, vouch,
  accuse). The conversation clock is `src/mystery/clock.ts`. Numbers live in `src/mystery/tuning.ts`.
- The play page is `play.html` + `src/play/` (Phaser pixel scene in `scene.ts`, controller in `main.ts`,
  SVG graph, minigames). The look is 8-bit: generated tiles and actors, Press Start 2P and VT323 fonts,
  dialogue in a black box with a white border under the canvas. `npm test` covers
  the engine; the headless walkthrough script lives in the session scratchpad.

## Research notes

- **Event[0]**: Kaizen tracks a small emotional state that moves with how you speak, and gates
  what it will say. This is the model for mood, patience and bond.
- **Three Clue Rule** (The Alexandrian): three independent clues per conclusion. Applied above.
- **No red herrings** (The Alexandrian): players latch onto the first conclusion. We plant none.
- **L.A. Noire**: one wrong pick closes a line for good; reviewers hated it. One lock here, with
  two other routes.
- **Return of the Obra Dinn**: no feedback until a set is right. No feedback here until M4.
- **Pentiment**: deliberately inconclusive. The opposite of our rule 1.

## Open questions for you

1. Win = both Captain facts + 2 of 3 paper proofs. Too strict for 50-70 talking turns?
2. Should a voiced clue get a visible cue (reel icon) so the player knows to record it?
3. Setting: English village home as written, or an Indian old age home?
4. Should the loss ending reveal the truth outright, or only hint?
5. Six turns of unavailability after an NPC leaves: right length?
