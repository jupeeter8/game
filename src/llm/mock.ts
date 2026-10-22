import type { LLMBackend, ChatRequest, NpcOutput } from "./types";
import { state, rel } from "../game/state";

/** Keyword-driven stand-in so the game loop is playable without a model download. */
export class MockBackend implements LLMBackend {
  readonly name = "mock";

  async init(onProgress: (pct: number, text: string) => void): Promise<void> {
    onProgress(1, "mock ready");
  }

  async chat(req: ChatRequest, meta: { npcId: string }): Promise<string> {
    await new Promise((r) => setTimeout(r, 350 + Math.random() * 350));
    const line = req.history[req.history.length - 1]?.content.toLowerCase() ?? "";
    const out = meta.npcId === "priya" ? priya(line) : raj(line);
    return JSON.stringify(out);
  }
}

const rude = (l: string) => /\b(stupid|shut up|idiot|hurry|whatever|useless)\b/.test(l);
const kind = (l: string) => /\b(hi|hello|hey|thanks|thank you|please|how are you|good morning|nice)\b/.test(l);

function priya(l: string): NpcOutput {
  if (rude(l)) return { reply: "Cool. I'll be over here, not helping.", mood: "cold", flags_set: [], quest_offer: "none" };
  if (/\braj\b/.test(l) && /(good side|impress|like me|warm|friend|talk to|approach|advice)/.test(l)) {
    if (rel("priya") >= 1 && !state.flags.has("knows_raj_badminton")) {
      return {
        reply: "Fine, since you've been decent: Raj is a badminton nut. Plays every Thursday. Bring it up and he melts.",
        mood: "neutral",
        flags_set: ["knows_raj_badminton"],
        quest_offer: "none",
      };
    }
    if (state.flags.has("knows_raj_badminton")) {
      return { reply: "I already told you. Badminton. Thursdays. Go.", mood: "neutral", flags_set: [], quest_offer: "none" };
    }
    return { reply: "I don't gossip about Raj with people I just met. Earn it.", mood: "neutral", flags_set: [], quest_offer: "none" };
  }
  if (/(code|repo|bug|deploy|ci|pipeline|test)/.test(l))
    return { reply: "Finally, a real question. The CI's been flaky for weeks; nobody owns it.", mood: "warm", flags_set: [], quest_offer: "none" };
  if (kind(l)) return { reply: "Hey. Coffee machine's dead, so manage your expectations.", mood: "warm", flags_set: [], quest_offer: "none" };
  return { reply: "Mm. Did you need something, or is this a vibes check?", mood: "neutral", flags_set: [], quest_offer: "none" };
}

function raj(l: string): NpcOutput {
  if (rude(l)) return { reply: "Let's keep it professional.", mood: "cold", flags_set: [], quest_offer: "none" };
  const knows = state.flags.has("knows_raj_badminton");
  if (knows && /badminton/.test(l)) {
    const offered = state.quests["fix_ci"];
    return {
      reply: offered
        ? "Thursday, 7pm, courts behind the mall. Don't be late."
        : "You play? Finally someone on this floor. Forget the docs, I need someone sharp on the CI pipeline.",
      mood: "warm",
      flags_set: [],
      quest_offer: offered ? "none" : "fix_ci",
    };
  }
  if (/(work|task|do|assign|help|anything)/.test(l)) {
    if (rel("raj") >= 2 && !state.quests["fix_ci"])
      return { reply: "Actually, yes. The CI pipeline is flaky. Take a look?", mood: "neutral", flags_set: [], quest_offer: "fix_ci" };
    if (!state.quests["update_docs"])
      return { reply: "The onboarding docs are out of date. Start there.", mood: "neutral", flags_set: [], quest_offer: "update_docs" };
    return { reply: "You still have the docs. Finish those first.", mood: "neutral", flags_set: [], quest_offer: "none" };
  }
  if (kind(l)) return { reply: "Morning. Standup is at ten.", mood: "warm", flags_set: [], quest_offer: "none" };
  return { reply: "Was there something you needed?", mood: "neutral", flags_set: [], quest_offer: "none" };
}
