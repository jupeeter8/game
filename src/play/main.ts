import Phaser from "phaser";
import { MINIGAMES, NPCS, PAGES, SCENES, clueById, type NpcDef } from "../mystery/content";
import { ActiveClock } from "../mystery/clock";
import { buildAllowed, buildSystem, mtalk } from "../mystery/engine";
import { accuse, afterEvening, beginDay, canVouch, completeMinigame, endConversation, endDay, lookAround, npcAvailable, pendingScenes, proofs, reassure, record, sitWithEdith, startGame, vouch } from "../mystery/events";
import { CLUES } from "../mystery/content";
import { convLimitMinutes, currentPhase, deserializeM, loadM, minutesLeft, mstate, npcRt, onChange, resetMState, saveM, serializeM, clearM, touch } from "../mystery/state";
import { MysteryMock } from "../mystery/mock";
import type { LLMBackend } from "../llm/types";
import type { SttBackend } from "../voice/types";
import { beeper } from "../audio/beeps";
import { MINIGAME_IMPL } from "./minigames";
import { WillowmereScene, drawPortrait, type Target } from "./scene";

// ---------- DOM helpers ----------
function h(tag: string, attrs: Record<string, unknown> = {}, ...kids: (Node | string | null | false | undefined)[]): HTMLElement {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v as EventListener);
    else if (k === "class") n.className = String(v);
    else if (k === "style") Object.assign(n.style, v as object);
    else if (k in n) (n as unknown as Record<string, unknown>)[k] = v;
    else n.setAttribute(k, String(v));
  }
  for (const k of kids) if (k) n.append(k);
  return n;
}
const $ = (id: string) => document.getElementById(id)!;
const isTyping = () => { const a = document.activeElement; return !!a && (a.tagName === "INPUT" || a.tagName === "SELECT" || a.tagName === "TEXTAREA"); };
function restartHref(): string { const llm = new URLSearchParams(location.search).get("llm"); return `?reset=1${llm ? `&llm=${llm}` : ""}`; }

type Mode = "walk" | "menu" | "dialogue" | "minigame" | "overlay";
const app = {
  mode: "walk" as Mode,
  backend: null as LLMBackend | null,
  stt: null as SttBackend | null,
  scene: null as WillowmereScene | null,
  conv: null as null | { npc: NpcDef; clock: ActiveClock; busy: boolean; timer: number; ended: boolean },
  toast: null as null | (() => void),
  tapePage: "edith",
  lastRec: "",
};
let game: Phaser.Game;
const reports: import("../mystery/engine").MTurnReport[] = [];

function setMode(m: Mode): void {
  app.mode = m;
  app.scene?.setMode(m);
}

// ---------- dialogue box ----------
const dlg = $("dlg"), dlgLines = $("dlg-lines"), dlgName = $("dlg-name"), dlgInput = $("dlg-input"), dlgHint = $("dlg-hint"), portrait = $("portrait") as HTMLCanvasElement;
function line(cls: string, text: string): HTMLElement { const el = h("div", { class: `line ${cls}` }, text); dlgLines.append(el); dlgLines.scrollTop = dlgLines.scrollHeight; return el; }

function typewrite(el: HTMLElement, text: string, npc?: NpcDef): Promise<void> {
  return new Promise((resolve) => {
    let i = 0;
    const step = () => {
      el.textContent = text.slice(0, ++i);
      const ch = text[i - 1];
      if (npc && i % 2 === 0 && /\S/.test(ch)) beeper.blip(npc.voice, ch);
      dlgLines.scrollTop = dlgLines.scrollHeight;
      if (i < text.length) setTimeout(step, /[.,!?]/.test(ch) ? 90 : 24); else resolve();
    };
    step();
  });
}

/** A one-shot text box with no input (noticeboard, Walter, action results). Enter/click closes. */
function toast(name: string, text: string, look?: NpcDef["look"]): Promise<void> {
  return new Promise((resolve) => {
    setMode("dialogue");
    dlgLines.replaceChildren();
    dlgName.textContent = name;
    $("conv-clock").textContent = "";
    if (look) drawPortrait(portrait, look); else { portrait.getContext("2d")!.clearRect(0, 0, 16, 16); }
    dlgInput.replaceChildren(h("button", { class: "primary", onclick: () => close() }, "OK"));
    dlgHint.textContent = "Enter / Esc";
    dlg.classList.add("visible");
    const el = line("npc", "");
    void typewrite(el, text);
    const close = () => { app.toast = null; dlg.classList.remove("visible"); setMode("walk"); resolve(); };
    app.toast = close;
  });
}

async function openConversation(npc: NpcDef): Promise<void> {
  if (app.conv) closeConversation("player");
  if (!npcAvailable(npc.id).ok) return;
  setMode("dialogue");
  const clock = new ActiveClock();
  clock.begin();
  app.conv = { npc, clock, busy: false, timer: 0, ended: false };
  dlgLines.replaceChildren();
  dlgName.textContent = npc.name;
  drawPortrait(portrait, npc.look);
  const input = h("input", { type: "text", placeholder: "or type here… (Enter)", onkeydown: (e: KeyboardEvent) => { if (e.key === "Enter") { const v = (e.target as HTMLInputElement).value; (e.target as HTMLInputElement).value = ""; void send(v, true); } } }) as HTMLInputElement;
  dlgInput.replaceChildren(
    h("button", { class: "ptt", id: "ptt", onmousedown: () => void holdStart("talk"), onmouseup: () => holdEnd("talk"), onmouseleave: () => holdEnd("talk") }, "hold SPACE"),
    input,
    h("button", { onclick: () => closeConversation("player") }, "Leave"),
  );
  dlgHint.innerHTML = "hold <b>SPACE</b> to talk · hold <b>R</b> for the tape · <b>Esc</b> to leave · the clock pauses while the game is thinking";
  dlg.classList.add("visible");
  line("sys", npc.evening ? "The engineer looks up from the boiler." : mstate.phase === "prologue" ? `${npc.name} is here, glass in hand.` : npcRt(npc.id).mood === "hostile" ? `${npc.name} is not pleased to see you.` : `${npc.name} looks up.`);
  app.scene?.setTalking(npc.id, true);
  app.conv.timer = window.setInterval(tickClock, 500);
  // no auto-focus: Space must talk by default. The input takes focus when clicked or after a typed line.
  (document.activeElement as HTMLElement | null)?.blur?.();
  void ensureStt();
}

function tickClock(): void {
  const c = app.conv;
  if (!c || c.ended) return;
  const limit = mstate.phase === "day" ? convLimitMinutes() : 3;
  const m = c.clock.activeMinutes();
  const left = Math.max(0, limit - m);
  $("conv-clock").innerHTML = `${c.clock.isRunning() ? "" : "⏸ "}${fmtMin(m)} / ${limit}:00${left < 1 ? ' <span style="color:var(--warn)">tiring</span>' : ""}`;
  if (m >= limit && !c.busy) {
    c.ended = true;
    line("sys", `${c.npc.name}: "I need a sit down, dear. Later."`);
    setTimeout(() => closeConversation("tired"), 1200);
  }
}

function closeConversation(reason: "left" | "tired" | "player"): void {
  const c = app.conv;
  if (!c) return;
  clearInterval(c.timer);
  const mins = c.clock.stop() / 60000;
  app.conv = null;
  app.scene?.setTalking(c.npc.id, false);
  dlg.classList.remove("visible");
  setMode("walk");
  if (mstate.phase === "day") endConversation(c.npc.id, mins, reason);
  else if (reason === "left") endConversation(c.npc.id, 0, reason);
  void processScenes();
}

async function send(text: string, typed = false): Promise<void> {
  const c = app.conv;
  if (!c || c.busy || c.ended || !app.backend) return;
  text = text.trim();
  if (!text) return;
  c.busy = true;
  line("you", text);
  const release = c.clock.hold();
  let r;
  try { r = await mtalk(app.backend, c.npc, text); } finally { release(); }
  reports.push(r);
  console.log(`[${c.npc.id}] tone=${r.output.tone} topic=${r.output.topic} shared=${r.voiced.join(",") || "-"} ${r.refused ? "REFUSED:" + r.refused + " " : ""}${r.usedFallback ? "FALLBACK " : ""}${r.violations.length ? "violations=" + r.violations.join("|") + " " : ""}${r.leaks.length ? "LEAK=" + r.leaks.join("|") : ""}\n`, r.output.reply, "\n--- raw:", r.raw, "\n--- prompt:\n" + r.system);
  if (c.npc.id === "tomasz" && /\b(won't|will not|not going to|never)\b.*\b(tell|report|say)\b|\bsecret('s| is) safe\b|\bpromise\b/i.test(text)) reassure("tomasz");
  if (c.npc.id === "rose" && r.output.tone === "kind" && /\bwalter\b/i.test(text)) reassure("rose");
  const el = line("npc", "");
  const release2 = c.clock.hold();
  await typewrite(el, r.output.reply, c.npc);
  release2();
  if (r.voiced.length) el.append(h("span", { class: "reel" }, "● tape it"));
  if (r.leaks.length) console.warn("LEAK", r.leaks);
  c.busy = false;
  if (r.left) { c.ended = true; line("sys", `${c.npc.name} has had enough and walks off.`); setTimeout(() => closeConversation("left"), 1200); }
  if (typed) (dlgInput.querySelector("input") as HTMLInputElement | null)?.focus();
}

function tapeNote(note: string): void {
  note = note.trim();
  if (!note) return;
  const r = record(note);
  const msg = r.recorded ? `● taped under ${NPCS[r.page]?.name ?? r.page}: "${clueById(r.clue!.id)?.topic}"${r.derived.length ? ` · ${r.derived.join(", ")}` : ""}` : `○ noted (nothing said yet matches that)`;
  app.lastRec = msg;
  if (app.conv) line("sys", msg); else if (app.mode === "walk") void toast("The tape", msg);
  renderRight();
  void processScenes();
}

// ---------- voice ----------
/** Names the speech model routinely mangles. Conservative: only clear mishearings. */
const FIXES: [RegExp, string][] = [
  [/\b(red|rand|ground|grant|grand) ?mother\b/gi, "grandmother"],
  [/\bgram\b/gi, "gran"],
  [/\b(captain )?(pew|pue|pooh|poo|pyu)\b/gi, "$1Pugh"],
  [/\b(tomas|thomas|tomash)\b/gi, "Tomasz"],
  [/\b(havel|havoc|hovel)\b/gi, "Havell"],
  [/\b(botkin|bodkins|bod kin)\b/gi, "Bodkin"],
  [/\b(willow ?mere|willow mare|will o'? ?mere)\b/gi, "Willowmere"],
  [/\b(margarite|margherita|marguerita)\b/gi, "Marguerite"],
  [/\b(harrow ?gate|harrogate)\b/gi, "Harrowgate"],
];
export function fixTranscript(t: string): string { let out = t; for (const [re, rep] of FIXES) out = out.replace(re, rep); return out; }
let holding: null | "talk" | "tape" = null;
let pendingHold: (() => void) | null = null;
async function ensureStt(): Promise<SttBackend | null> {
  if (app.stt) return app.stt;
  try {
    const { pickStt } = await import("../voice");
    const stt = await pickStt();
    if (!stt.available()) return null;
    const text = $("load-text"), bar = $("load-bar"), fill = bar.querySelector<HTMLDivElement>(".fill")!;
    bar.classList.add("visible");
    await stt.init((pct, msg) => { fill.style.width = `${Math.round(pct * 100)}%`; text.textContent = msg; });
    bar.classList.remove("visible"); text.textContent = "";
    await stt.prepare();
    app.stt = stt;
    return stt;
  } catch (e) { console.warn("stt unavailable", e); $("load-text").textContent = "mic unavailable; type instead"; return null; }
}
let cancelled = false;
async function holdStart(kind: "talk" | "tape"): Promise<void> {
  if (holding) return;
  cancelled = false;
  if (!app.stt) { $("load-text").textContent = "loading the speech model… hold again when it's ready"; }
  const stt = await ensureStt();
  if (!stt || stt.isListening() || cancelled) return;
  holding = kind;
  let release: (() => void) | undefined;
  stt.start({
    onInterim: () => {},
    onFinal: (t) => { release?.(); holding = null; refreshHold(); t = fixTranscript(t); (window as unknown as { __lastHeard: string }).__lastHeard = t; if (kind === "talk") void send(t); else tapeNote(t); },
    onError: (m) => { release?.(); holding = null; refreshHold(); if (app.conv) line("sys", `(mic: ${m})`); },
  });
  pendingHold = () => { release = app.conv?.clock.hold(); };
  refreshHold();
}
function holdEnd(kind: "talk" | "tape"): void {
  cancelled = true;
  if (holding !== kind || !app.stt) return;
  pendingHold?.(); pendingHold = null;
  app.stt.stop();
}
function refreshHold(): void {
  $("rec").classList.toggle("visible", holding === "tape");
  const p = document.getElementById("ptt");
  if (p) { p.classList.toggle("live", holding === "talk"); p.textContent = holding === "talk" ? "listening…" : "hold SPACE"; }
}

// ---------- keys ----------
document.addEventListener("keydown", (e) => {
  if (e.key === "r" || e.key === "R" || e.key === " ") beeper.unlock();
  // keys handled here must not reach Phaser's window listeners, or E/Enter would re-trigger the interaction
  const eat = () => { e.preventDefault(); e.stopPropagation(); };
  if (app.mode === "menu") {
    if (e.key === "ArrowDown" || e.key === "s") { menuMove(1); eat(); }
    else if (e.key === "ArrowUp" || e.key === "w") { menuMove(-1); eat(); }
    else if (e.key === "Enter" || e.key === "e" || e.key === " ") { eat(); menuPick(); }
    else if (e.key === "Escape") { eat(); closeMenu(); }
    return;
  }
  if (app.mode === "dialogue") {
    if (e.key === "Escape") { eat(); if (app.toast) app.toast(); else closeConversation("player"); return; }
    if (app.toast && e.key === "Enter" && !isTyping()) { eat(); app.toast(); return; }
  }
  if (isTyping() || e.repeat || app.mode === "overlay" || app.mode === "minigame") return;
  if (e.key === " " && app.conv) { e.preventDefault(); void holdStart("talk"); }
  else if (e.key.toLowerCase() === "r" && (app.mode === "walk" || app.conv)) { e.preventDefault(); void holdStart("tape"); }
});
document.addEventListener("keyup", (e) => { if (e.key === " ") holdEnd("talk"); else if (e.key.toLowerCase() === "r") holdEnd("tape"); });
document.addEventListener("pointerdown", () => beeper.unlock(), { once: true });
// typing into any text box must not move Sam or trigger E
document.addEventListener("focusin", () => { if (isTyping()) app.scene?.input.keyboard?.disableGlobalCapture(); });
document.addEventListener("focusout", () => { if (app.mode === "walk") app.scene?.input.keyboard?.enableGlobalCapture(); });

// ---------- menu ----------
const menuEl = $("menu");
let menuOpts: { label: string; run: () => void }[] = [];
let menuSel = 0;
function openMenu(title: string, opts: { label: string; run: () => void }[]): void {
  menuOpts = [...opts, { label: "Back", run: () => {} }];
  menuSel = 0;
  setMode("menu");
  menuEl.classList.add("visible");
  renderMenu(title);
}
function renderMenu(title?: string): void {
  if (title !== undefined) menuEl.dataset.title = title;
  menuEl.replaceChildren(h("div", { class: "title px" }, menuEl.dataset.title ?? ""), ...menuOpts.map((o, i) => h("div", { class: `opt ${i === menuSel ? "sel" : ""}`, onclick: () => { menuSel = i; menuPick(); } }, o.label)));
}
function menuMove(d: number): void { menuSel = (menuSel + d + menuOpts.length) % menuOpts.length; renderMenu(); }
function closeMenu(): void { menuEl.classList.remove("visible"); setMode("walk"); }
function menuPick(): void { const o = menuOpts[menuSel]; closeMenu(); o.run(); }

function onInteract(t: Target): void {
  if (app.mode !== "walk") return;
  beeper.unlock();
  if (t.kind === "board") { const f = lookAround(); void toast("Noticeboard", f.length ? "A pharmacy delivery slip pinned in the hall: Bram, W. — digoxin, 28 capsules, this week. Worth taping." : "Bingo Thursdays. A pharmacy slip you have already read. Nothing new."); return; }
  if (t.kind === "walter") { void toast("Walter", "Walter raises his cocoa to the table. \"Twenty years dry and I still get a nightcap.\" He winks at Edith.", { hair: "#e8e8e8", skin: "#e8b08c", body: "#7d6b5a", style: "bald", extra: "glasses" }); return; }
  if (t.kind === "chandelier") { void toast("The chandelier", "Glass everywhere. The chain is cut clean through, not frayed."); return; }
  const npc = NPCS[t.id];
  const opts: { label: string; run: () => void }[] = [{ label: "Talk", run: () => void openConversation(npc) }];
  if (npc.minigame && mstate.phase === "day") opts.push({ label: `${MINIGAMES[npc.minigame].title} (${MINIGAMES[npc.minigame].minutes} min)`, run: () => void playMinigame(npc.minigame!) });
  if (npc.id === "edith" && mstate.phase === "day") opts.push({ label: "Sit with her a while (1 min)", run: () => { sitWithEdith(); void toast("Edith", "You sit with Edith a while. She says nothing, which is her way of saying a lot.", npc.look); } });
  if (npc.id === "rose" && canVouch()) {
    for (const id of Object.keys(NPCS).filter((i) => i !== "rose" && !NPCS[i].window && !NPCS[i].evening)) opts.push({ label: `Ask her to vouch for you with ${NPCS[id].name}`, run: () => { vouch(id); void toast("Rose", `"Leave it with me." She is gone before you can answer, at speed. Later, ${NPCS[id].name} looks at you differently.`, npc.look); } });
  }
  openMenu(npc.name, opts);
}

// ---------- minigames ----------
async function playMinigame(id: string): Promise<void> {
  const impl = MINIGAME_IMPL[id];
  if (!impl) return;
  setMode("minigame");
  const host = $("minigame"), card = $("minigame-card");
  host.classList.add("visible");
  let won = false;
  try { won = await impl(card); } finally { host.classList.remove("visible"); card.replaceChildren(); }
  setMode("walk");
  completeMinigame(id, won);
  void processScenes();
}

// ---------- scenes ----------
const overlay = $("overlay"), overlayCard = $("overlay-card");
let sceneBusy = false;
async function processScenes(): Promise<void> {
  if (sceneBusy) return;
  sceneBusy = true;
  for (let batch = pendingScenes(); batch.length; batch = pendingScenes()) {
    for (const s of batch) {
      if (s.id.startsWith("chandelier") && app.scene) { if (app.conv) closeConversation("player"); setMode("overlay"); app.scene.placePlayer(19, 6); await app.scene.dropChandelier(); }
      await showScene(s.id, s.lines);
    }
  }
  sceneBusy = false;
  renderHud();
}
function showScene(id: string, lines: readonly string[]): Promise<void> {
  return new Promise((resolve) => {
    const prev = app.mode;
    setMode("overlay");
    const row = h("div", { class: "row" });
    const done = () => { overlay.classList.remove("visible"); setMode(prev === "overlay" ? "walk" : prev); resolve(); };
    const then = (fn: () => void) => () => { done(); fn(); void processScenes(); };
    if (id === "prologue") row.append(h("button", { class: "primary", onclick: done }, "Mingle at the party"), h("button", { onclick: then(() => beginDay(1)) }, "Go to bed"));
    else if (id === "evening1") row.append(h("button", { class: "primary", onclick: done }, "Talk to the engineer"), h("button", { onclick: then(afterEvening) }, "Go to bed"));
    else if (id === "gathering") {
      const picks = h("div", { class: "row" });
      for (const id2 of ["marguerite", "pugh", "rose", "tomasz", "pearl", "edith"]) picks.append(h("button", { onclick: then(() => accuse(id2)) }, NPCS[id2].name));
      picks.append(h("button", { onclick: then(() => accuse(null)) }, "Say nothing"));
      row.append(h("div", { class: "px", style: { width: "100%" } }, "NAME THE KILLER"), picks);
    } else if (id === "O1" || id === "O2" || id === "O3") row.append(h("button", { class: "primary", onclick: () => { clearM(); location.href = restartHref(); } }, "Play again"), h("button", { onclick: done }, "Close"));
    else row.append(h("button", { class: "primary", onclick: done }, "Continue"));
    overlayCard.replaceChildren(...lines.map((l) => h("p", {}, l)), row);
    overlay.classList.add("visible");
    (row.querySelector("button") as HTMLButtonElement | null)?.focus();
  });
}

// ---------- HUD + right column ----------
function fmtMin(m: number): string { const s = Math.floor(m * 60); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }
function renderHud(): void {
  const ph = mstate.phase;
  $("status").innerHTML = ph === "prologue" ? "THE PARTY" : ph === "evening1" ? "DAY 1 · EVENING" : ph === "gathering" ? "THE GATHERING" : ph === "ended" ? `THE END · ${mstate.outcome}` :
    `DAY ${mstate.day} · ${Math.ceil(minutesLeft())} min left · talks up to ${convLimitMinutes()} min · ${mstate.tape.length} on tape · proofs ${proofs().length}/3`;
  const acts = $("hud-actions");
  acts.replaceChildren();
  if (ph === "prologue") acts.append(h("button", { onclick: () => { beginDay(1); void processScenes(); } }, "Go to bed"));
  if (ph === "day") acts.append(h("button", { onclick: () => { if (confirm(`End day ${mstate.day} now?`)) { if (app.conv) closeConversation("player"); endDay(); void processScenes(); } } }, `End day ${mstate.day}`));
  if (ph === "evening1") acts.append(h("button", { onclick: () => { afterEvening(); void processScenes(); } }, "Go to bed"));
  if (ph === "gathering") acts.append(h("button", { class: "primary", onclick: () => { const q = pendingScenes(); if (q.length) { for (const sc of q) void showScene(sc.id, sc.lines); } else void showScene("gathering", SCENES.gathering); } }, "Go to the lounge"));
  if (ph === "ended" && mstate.outcome) acts.append(h("button", { onclick: () => void showScene(mstate.outcome!, SCENES[mstate.outcome!]) }, "Read the ending again"));
}

const right = $("col-right");
const tapePanel = h("section", { class: "panel" });
right.append(tapePanel);

function renderRight(): void {
  tapePanel.replaceChildren(h("h2", {}, "THE TAPE", h("span", { class: "small" }, `${mstate.pool.length} said, not taped`)));
  const tabs = h("div", { class: "tabs" });
  for (const p of PAGES) {
    const n = mstate.tape.filter((t) => t.page === p).length;
    if (!n && !["edith", "marguerite", "pugh", "rose", "tomasz", "pearl", "walter", "loose"].includes(p)) continue;
    tabs.append(h("button", { class: app.tapePage === p ? "active" : "", onclick: () => { app.tapePage = p; renderRight(); } }, `${NPCS[p]?.name ?? (p === "walter" ? "Walter" : "Loose")}${n ? ` ${n}` : ""}`));
  }
  tapePanel.append(tabs);
  const entries = mstate.tape.filter((t) => t.page === app.tapePage);
  if (!entries.length) tapePanel.append(h("div", { class: "muted small" }, "nothing on this page"));
  for (const t of entries) tapePanel.append(h("div", { class: "entry", style: t.clueId === "quote" ? { borderColor: "#777" } : {} }, h("div", {}, t.heard ?? clueById(t.clueId)?.text ?? t.clueId), h("div", { class: "note" }, `“${t.note}” · day ${t.day}${t.clueId === "quote" ? " · quote" : ""}`)));
  const unt = mstate.pool.filter((id) => mstate.heard[id] && (app.tapePage === "loose" || clueById(id)?.npc === app.tapePage || (clueById(id)?.about ?? []).includes(app.tapePage)));
  if (unt.length) { tapePanel.append(h("div", { class: "muted small", style: { marginTop: "6px" } }, "Said to you, not yet on tape:")); for (const id of unt) tapePanel.append(h("div", { class: "entry", style: { borderColor: "#6b2a2a", opacity: ".8" } }, h("div", { class: "note" }, `“${mstate.heard[id]}”`))); }
  if (app.tapePage === "loose") for (const n of mstate.looseNotes) tapePanel.append(h("div", { class: "entry", style: { borderColor: "#444" } }, h("div", { class: "note" }, `“${n}”`)));
  tapePanel.append(h("div", { class: "mg-row" }, h("button", { class: "tape", onmousedown: () => void holdStart("tape"), onmouseup: () => holdEnd("tape"), onmouseleave: () => holdEnd("tape") }, "● hold R"),
    h("input", { type: "text", style: { flex: 1 }, placeholder: "or type a note for the tape…", onkeydown: (e: KeyboardEvent) => { if (e.key === "Enter") { tapeNote((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).value = ""; } } })));
  if (app.lastRec) tapePanel.append(h("div", { class: "muted small" }, app.lastRec));
}

// ---------- boot ----------
async function pickBackend(): Promise<LLMBackend> {
  // the real in-browser model is the default; ?llm=mock opts into instant keyword replies (tests, quick checks)
  if (new URLSearchParams(location.search).get("llm") === "mock") return new MysteryMock();
  // navigator.gpu can exist with no usable adapter behind it, so ask for one before committing to the model
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  const adapter = gpu ? await gpu.requestAdapter().catch(() => null) : null;
  if (adapter) { const { WebLLMBackend } = await import("../llm/webllm"); return new WebLLMBackend(); }
  $("load-text").textContent = "This browser has no WebGPU, so the residents can only give simple scripted replies. For the full game use a recent Chrome, Edge or Brave on desktop with WebGPU enabled.";
  $("load-text").style.color = "var(--bad)";
  return new MysteryMock();
}

async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
  if (params.get("reset") === "1") {
    clearM();
    // the flag has done its job: drop it from the URL so a refresh (or a discarded tab coming back) restores the game instead of wiping it
    params.delete("reset");
    history.replaceState(null, "", `${location.pathname}${params.toString() ? "?" + params.toString() : ""}`);
  }
  const loaded = params.has("reset") ? false : loadM();
  if (!loaded) startGame();
  document.querySelectorAll<HTMLAnchorElement>("header a[href='?reset=1']").forEach((a) => (a.href = restartHref()));

  game = new Phaser.Game({ type: Phaser.AUTO, parent: "game", width: 800, height: 560, backgroundColor: "#000", pixelArt: true, physics: { default: "arcade", arcade: { debug: false } }, scene: [WillowmereScene] });
  await new Promise<void>((r) => game.events.once("scene:ready", () => r()));
  app.scene = game.scene.getScene("willowmere") as WillowmereScene;
  game.events.on("interact", (t: Target) => onInteract(t));

  let queued = false;
  onChange(() => { if (queued) return; queued = true; queueMicrotask(() => { queued = false; saveM(); renderHud(); renderRight(); game.events.emit("state:changed"); void processScenes(); }); });
  renderHud(); renderRight();
  void processScenes();

  const nameEl = $("backend-name"), bar = $("load-bar"), fill = bar.querySelector<HTMLDivElement>(".fill")!, text = $("load-text");
  const backend = await pickBackend();
  nameEl.textContent = backend.name;
  if (backend.name !== "mock") bar.classList.add("visible");
  try { await backend.init((pct, msg) => { fill.style.width = `${Math.round(pct * 100)}%`; text.textContent = msg; }); if (backend.name !== "mock") text.textContent = "model ready"; }
  catch (e) { text.textContent = `The model could not load (${(e as Error)?.message ?? e}). Add ?llm=mock to the address to play with scripted replies.`; throw e; }
  bar.classList.remove("visible");
  app.backend = backend;
  document.body.dataset.llm = "ready";
  void ensureStt();
  /** harness helper: voice a clue and tape it by its own keywords (bypasses the NPC; for tests only) */
  const tape = (id: string) => { const c = CLUES.find((x) => x.id === id); if (!c) return null; if (!mstate.pool.includes(c.id)) mstate.pool.push(c.id); return record(c.keywords.slice(0, 3).join(" ") + " " + c.text); };
  (window as unknown as { __wm: unknown }).__wm = { mstate, record, send, openConversation, closeConversation, beginDay, endDay, afterEvening, startGame, resetMState, accuse, npcRt, touch, buildSystem, buildAllowed, currentPhase, tape, NPCS, CLUES, npcAvailable, lookAround, completeMinigame, snapshot: () => JSON.stringify(serializeM()), restore: (json: string) => { deserializeM(JSON.parse(json)); pendingScenes(); }, app, scene: () => app.scene, interact: onInteract, reports };
}

void boot();
