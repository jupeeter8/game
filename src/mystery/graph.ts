import { CLUES, DERIVED, EVENT_FLAGS, NPCS, PAGES, grantsOf, type Clue } from "./content";
import { clueStatus, type ClueState } from "./engine";
import { flagsIn, ruleOk } from "./rules";
import { mstate, npcRt } from "./state";

export type NodeKind = "clue" | "bond" | "proof" | "event" | "outcome";
export type NodeState = ClueState | "done" | "available" | "off";

export interface GNode {
  id: string;
  kind: NodeKind;
  lane: string;
  label: string;
  detail: string;
  critical?: boolean;
  depth: number;
  state: NodeState;
}
export interface GEdge { from: string; to: string; kind: "needs" | "bond" | "proof" | "outcome" }
export interface Graph { nodes: GNode[]; edges: GEdge[]; lanes: string[] }

const LANES = [...PAGES.filter((p) => p !== "loose"), "loose", "proof", "outcome"];

function laneOf(c: Clue): string {
  if (c.npc === "scene") return "walter";
  return c.npc;
}

/** Static structure: computed once. */
export function buildStructure(): { nodes: Omit<GNode, "state">[]; edges: GEdge[] } {
  const nodes: Omit<GNode, "state">[] = [];
  const edges: GEdge[] = [];
  const byFlag = new Map<string, string[]>();
  for (const c of CLUES) for (const f of grantsOf(c)) byFlag.set(f, [...(byFlag.get(f) ?? []), c.id]);
  byFlag.set(EVENT_FLAGS[0], ["ev_chandelier"]);
  byFlag.set(EVENT_FLAGS[1], ["ev_wheelchair"]);
  for (const d of DERIVED) byFlag.set(d.flag, [d.flag]);

  for (const c of CLUES) {
    nodes.push({ id: c.id, kind: "clue", lane: laneOf(c), label: shortLabel(c), detail: c.text, critical: c.critical, depth: 0 });
    for (const f of flagsIn(c.needs)) for (const src of byFlag.get(f) ?? []) edges.push({ from: src, to: c.id, kind: "needs" });
    if (c.bond) edges.push({ from: `bond_${c.npc}`, to: c.id, kind: "bond" });
    if (c.needs) collectBondRules(c.needs).forEach((b) => edges.push({ from: `bond_${b}`, to: c.id, kind: "bond" }));
  }
  for (const id of Object.keys(NPCS)) {
    const n = NPCS[id];
    if (n.bondHint === "none") continue;
    nodes.push({ id: `bond_${id}`, kind: "bond", lane: id, label: `bond: ${n.bondHint}`, detail: `Do the one thing ${n.name} wants.`, depth: 0 });
  }
  nodes.push({ id: "ev_chandelier", kind: "event", lane: "loose", label: "the chandelier", detail: "Day 2, when enough critical clues are on tape.", depth: 0 });
  nodes.push({ id: "ev_wheelchair", kind: "event", lane: "bodkin", label: "the wheelchair arrives", detail: "Morning of Day 2, if Bodkin was asked.", depth: 0 });
  edges.push({ from: "bodkin_wheelchair", to: "ev_wheelchair", kind: "needs" });
  for (const d of DERIVED) {
    nodes.push({ id: d.flag, kind: "proof", lane: "proof", label: d.label, detail: "Any of three routes.", depth: 0 });
    for (const f of flagsIn(d.when)) for (const src of byFlag.get(f) ?? []) edges.push({ from: src, to: d.flag, kind: "proof" });
  }
  nodes.push({ id: "O2", kind: "outcome", lane: "outcome", label: "WIN: name Marguerite with a complete case", detail: "pugh_knew + 2 of 3 proofs", depth: 0 });
  nodes.push({ id: "O1", kind: "outcome", lane: "outcome", label: "LOSE: name the Captain", detail: "You stopped at fact one.", depth: 0 });
  nodes.push({ id: "O3", kind: "outcome", lane: "outcome", label: "LOSE: anyone else, or an incomplete case", detail: "Halloran asks about the man seen going in.", depth: 0 });
  for (const src of byFlag.get("pugh_knew") ?? []) edges.push({ from: src, to: "O2", kind: "outcome" });
  for (const d of DERIVED) edges.push({ from: d.flag, to: "O2", kind: "outcome" });
  for (const src of byFlag.get("pugh_visit_950") ?? []) edges.push({ from: src, to: "O1", kind: "outcome" });

  // depth = longest path from a root
  const ids = new Set(nodes.map((n) => n.id));
  const inc = new Map<string, string[]>();
  for (const e of edges) if (ids.has(e.from) && ids.has(e.to)) inc.set(e.to, [...(inc.get(e.to) ?? []), e.from]);
  const memo = new Map<string, number>();
  const depth = (id: string, seen = new Set<string>()): number => {
    if (memo.has(id)) return memo.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const d = Math.max(0, ...(inc.get(id) ?? []).map((p) => depth(p, seen) + 1));
    memo.set(id, d);
    return d;
  };
  for (const n of nodes) n.depth = depth(n.id);
  return { nodes, edges: edges.filter((e) => ids.has(e.from) && ids.has(e.to)) };
}

function collectBondRules(r: import("./content").Rule, out: string[] = []): string[] {
  if ("all" in r) r.all.forEach((x) => collectBondRules(x, out));
  else if ("any" in r) r.any.forEach((x) => collectBondRules(x, out));
  else if ("not" in r) collectBondRules(r.not, out);
  else if ("bond" in r) out.push(r.bond);
  return out;
}

function shortLabel(c: Clue): string {
  const t = c.text.replace(/^[^:]*: '/, "").replace(/["']/g, "");
  return t.length > 54 ? t.slice(0, 52) + "…" : t;
}

let structure: ReturnType<typeof buildStructure> | null = null;

/** Live graph: structure plus each node's state from the game. */
export function buildGraph(): Graph {
  structure ??= buildStructure();
  const nodes: GNode[] = structure.nodes.map((n) => ({ ...n, state: stateOf(n) }));
  return { nodes, edges: structure.edges, lanes: LANES };
}

function stateOf(n: Omit<GNode, "state">): NodeState {
  if (n.kind === "clue") return clueStatus(CLUES.find((c) => c.id === n.id)!).state;
  if (n.kind === "bond") return npcRt(n.id.slice(5)).bond ? "done" : "available";
  if (n.kind === "proof") return mstate.flags.has(n.id) ? "done" : ruleOk(DERIVED.find((d) => d.flag === n.id)!.when) ? "done" : "locked";
  if (n.kind === "event") {
    if (n.id === "ev_chandelier") return mstate.flags.has("chandelier_fell") ? "done" : "locked";
    return mstate.flags.has("wheelchair_built") ? "done" : mstate.flags.has("wheelchair_requested") ? "available" : "locked";
  }
  if (mstate.outcome) return mstate.outcome === n.id ? "done" : "off";
  if (n.id === "O2") return mstate.flags.has("pugh_knew") && ["proof_means", "proof_motive", "proof_opportunity"].filter((f) => mstate.flags.has(f)).length >= 2 ? "available" : "locked";
  return "available";
}
