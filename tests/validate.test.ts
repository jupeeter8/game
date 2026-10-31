import { describe, expect, it } from "vitest";
import { validate } from "../src/llm/validate";
import type { Allowed } from "../src/llm/types";

const allowed: Allowed = { topics: ["codebase"], events: ["was_rude"], shared: [], quests: ["update_docs"] };

describe("validate", () => {
  it("coerces off-enum values and reports them", () => {
    const v = validate('{"reply":"hi","topic":"salary","event":"insulted_me","shared":["raj_badminton"],"quest_offer":"fix_ci"}', allowed)!;
    expect(v.output).toEqual({ reply: "hi", topic: "other", event: "none", shared: [], quest_offer: "none" });
    expect(v.violations.length).toBe(4);
  });
  it("accepts allowed values, strips fences, trims and caps reply", () => {
    const v = validate('```json\n{"reply":"  ' + "x".repeat(300) + '","topic":"codebase","event":"was_rude","quest_offer":"update_docs"}\n```', allowed)!;
    expect(v.output.reply.length).toBe(240);
    expect(v.output.topic).toBe("codebase");
    expect(v.output.event).toBe("was_rude");
    expect(v.output.quest_offer).toBe("update_docs");
    expect(v.violations).toEqual([]);
  });
  it("rejects garbage and empty replies", () => {
    expect(validate("not json", allowed)).toBeNull();
    expect(validate('{"reply":"   "}', allowed)).toBeNull();
    expect(validate("[1,2]", allowed)).toBeNull();
  });
});
