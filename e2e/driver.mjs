#!/usr/bin/env node
/**
 * Real-model test driver for Willowmere.
 *
 * Owns one browser session (headed Chromium or Brave, WebGPU on, persistent profile so the model is
 * downloaded once) and exposes it over a tiny HTTP API so a tester (a person with curl, or an agent)
 * can talk to NPCs one line at a time, read the engine's full turn report, tape notes, and move the
 * game between phases. Every call is appended to e2e/out/<model>/<run>.jsonl.
 *
 *   node e2e/driver.mjs --model=3b            # Qwen 3B (default); 8b = Llama 3.1 8B; mock = no model
 *   node e2e/driver.mjs --model=3b --mic=e2e/wav/hello.wav   # fake microphone fed from a WAV
 *
 * Endpoints (all JSON):
 *   GET  /state                       phase, day, minutes, flags, tape, pool, per-NPC mood/patience/bond/available
 *   POST /open   {npc}                open a conversation (NPC must be available)
 *   POST /say    {line}               send a line; returns {reply, report}
 *   POST /tape   {note}               speak a note into the tape (matched against voiced clues only)
 *   POST /tapeid {id}                 harness shortcut: voice+tape a clue by id (bypasses the NPC)
 *   POST /close                       leave the conversation
 *   POST /op     {op, ...}            reset | beginDay{day} | endDay | afterEvening | flag{flag} | bond{npc} | mood{npc,mood} | place{x,y} | scenes
 *   POST /mic    {key: talk|tape, seconds}   hold SPACE or R for N seconds with the fake mic; returns what reached the game
 *   POST /quit
 */
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { mkdirSync, appendFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ""), "1"]; }));
const MODEL = args.model ?? "3b";
const PORT = Number(args.port ?? 5199);
const BASE = args.base ?? "http://localhost:5173";
const MIC = args.mic ? resolve(args.mic) : null;
const STT = args.stt ?? "base";
const HEADLESS = args.headless === "1";

const CHROME = join(homedir(), "Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const BRAVE = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const EXE = args.exe === "brave" ? BRAVE : existsSync(CHROME) ? CHROME : BRAVE;

const outDir = resolve(`e2e/out/${MODEL}`);
mkdirSync(outDir, { recursive: true });
const runFile = join(outDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
const logLine = (obj) => appendFileSync(runFile, JSON.stringify({ t: Date.now(), ...obj }) + "\n");

const profile = resolve(`e2e/.profile/${MODEL}`);
mkdirSync(profile, { recursive: true });
const flags = ["--enable-unsafe-webgpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required",
  // the test window sits in the background for an hour; never throttle or discard it
  "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--disable-background-timer-throttling", "--disable-features=HighEfficiencyModeAvailable,MemorySaverMode"];
// the fake device loops the file; hold the key for at least two clip lengths so a whole phrase is captured
if (MIC) flags.push("--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${MIC}`);

console.log(`[driver] model=${MODEL} exe=${EXE.includes("Brave") ? "brave" : "chromium"} mic=${MIC ?? "-"} log=${runFile}`);
const ctx = await chromium.launchPersistentContext(profile, { headless: HEADLESS, executablePath: EXE, args: flags, viewport: { width: 1500, height: 1000 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e.message)));
page.on("console", (m) => { if (m.type() === "warning" && /LEAK|prompt leak|echoed|invalid output/.test(m.text())) logLine({ kind: "console", text: m.text() }); });

const llm = MODEL === "mock" ? "mock" : "webllm";
const url = `${BASE}/?llm=${llm}${llm === "webllm" ? `&model=${MODEL}` : ""}&stt_model=${STT}&reset=1`;
await page.goto(url);
await page.waitForFunction(() => document.getElementById("backend-name")?.textContent !== "…", null, { timeout: 120000 });
const backendName = await page.evaluate(() => document.getElementById("backend-name")?.textContent);
if (llm === "webllm" && backendName !== "webllm") { console.error("[driver] WebGPU unavailable in this browser; got backend", backendName); process.exit(2); }
if (llm === "webllm") {
  console.log("[driver] loading model (first run downloads it; watch the browser header)…");
  let last = "";
  const t0 = Date.now();
  while (Date.now() - t0 < 60 * 60 * 1000) {
    const txt = await page.evaluate(() => document.getElementById("load-text")?.textContent ?? "");
    if (txt !== last) { console.log("[driver]", txt.slice(0, 100)); last = txt; }
    const ready = await page.evaluate(() => document.body.dataset.llm === "ready");
    if (ready) break;
    if (/failed/.test(txt)) { console.error("[driver] model failed:", txt); process.exit(3); }
    await page.waitForTimeout(3000);
  }
}
await page.waitForFunction(() => !!window.__wm?.scene, null, { timeout: 120000 });
console.log("[driver] model ready; the prologue overlay is left for the first caller to read");
console.log(`[driver] listening on http://localhost:${PORT}`);

import { execSync } from "node:child_process";
let page_ = page;
const browserPid = ctx.browser()?.process?.()?.pid ?? null;
/** resident memory of the biggest renderer helper, in MB (macOS). */
function rendererMB() {
  try {
    const out = execSync("ps -axo rss,comm | grep -i 'Helper (Renderer)' | sort -nr | head -1", { encoding: "utf8" });
    const m = out.trim().match(/^(\d+)/);
    return m ? Math.round(Number(m[1]) / 1024) : null;
  } catch { return null; }
}
let lastSnapshot = null;
async function recover(err) {
  if (!/Target crashed|Target closed|Execution context was destroyed/.test(String(err?.message ?? err))) throw err;
  const navigated = /Execution context was destroyed/.test(String(err?.message ?? err));
  console.warn(`[driver] ${navigated ? "page navigated" : "renderer crashed"}; re-acquiring the page and restoring the last snapshot`);
  logLine({ kind: "crash", error: String(err?.message ?? err), rendererMB: rendererMB(), navigated });
  const p = ctx.pages()[0] ?? (await ctx.newPage());
  page_ = p;
  if (!navigated) await p.goto(url.replace("&reset=1", ""));
  await p.waitForFunction(() => document.getElementById("backend-name")?.textContent !== "…", null, { timeout: 120000 });
  const t0 = Date.now();
  while (Date.now() - t0 < 30 * 60 * 1000) { if (await p.evaluate(() => document.body.dataset.llm === "ready")) break; await p.waitForTimeout(2000); }
  await p.waitForFunction(() => !!window.__wm?.scene, null, { timeout: 120000 });
  for (let i = 0; i < 4; i++) { if (!(await p.locator("#overlay.visible").count())) break; await p.locator("#overlay-card button").first().click().catch(() => {}); await p.waitForTimeout(200); }
  if (lastSnapshot) { await p.evaluate((j) => window.__wm.restore(j), lastSnapshot); await p.waitForTimeout(300); for (let i = 0; i < 4; i++) { if (!(await p.locator("#overlay.visible").count())) break; await p.locator("#overlay-card button").first().click().catch(() => {}); await p.waitForTimeout(200); } }
}
async function snapshot() { try { lastSnapshot = await page_.evaluate(() => window.__wm.snapshot()); } catch { /* taken on the next call */ } }
const ev = async (fn, arg) => { try { return await page_.evaluate(fn, arg); } catch (e) { await recover(e); return page_.evaluate(fn, arg); } };
const NPC_SPOT = { party: "party", day: "day" };

async function state() {
  return ev(() => {
    const { mstate, NPCS, currentPhase } = window.__wm;
    const npcs = {};
    for (const id of Object.keys(NPCS)) {
      const rt = mstate.npcs[id];
      npcs[id] = { mood: rt?.mood ?? NPCS[id].startMood, patience: rt?.patience ?? "fresh", bond: !!rt?.bond, voiced: rt?.voiced ?? [] };
    }
    return { phase: currentPhase(), gamePhase: mstate.phase, day: mstate.day, elapsed: mstate.elapsed, flags: [...mstate.flags], tape: mstate.tape.map((t) => t.clueId), pool: mstate.pool, npcs, conv: window.__wm.app.conv?.npc.id ?? null, mode: window.__wm.app.mode, outcome: mstate.outcome };
  });
}

async function open(npc) {
  await ev((id) => { const { NPCS, openConversation } = window.__wm; return openConversation(NPCS[id]); }, npc);
  await page_.waitForTimeout(200);
  const s = await state();
  return { ok: s.conv === npc, conv: s.conv, mode: s.mode };
}

async function say(line) {
  const before = await ev(() => window.__wm.reports.length);
  await ev((l) => window.__wm.send(l, true), line);
  await page_.waitForFunction((n) => window.__wm.reports.length > n && !window.__wm.app.conv?.busy, before, { timeout: 180000 });
  const r = await ev(() => { const r = window.__wm.reports[window.__wm.reports.length - 1]; const { schema, ...rest } = r; return rest; });
  return { reply: r.output.reply, report: r };
}

async function handle(method, path, body) {
  if (method === "GET" && path === "/state") return state();
  if (path === "/open") return open(body.npc);
  if (path === "/say") { const r = await say(body.line); logLine({ kind: "turn", rendererMB: rendererMB(), npc: r.report.npcId, phase: r.report.phase, line: body.line, reply: r.reply, tone: r.report.output.tone, topic: r.report.output.topic, voiced: r.report.voiced, violations: r.report.violations, leaks: r.report.leaks, promptLeaks: r.report.promptLeaks, fallback: r.report.usedFallback, latencyMs: r.report.latencyMs, moodBefore: r.report.moodBefore, moodAfter: r.report.moodAfter, patienceStepped: r.report.patienceStepped, left: r.report.left, raw: r.report.raw, system: r.report.system }); return r; }
  if (path === "/tape") { const r = await ev((n) => { const x = window.__wm.record(n); return { recorded: x.recorded, clue: x.clue?.id ?? null, page: x.page, score: x.score, derived: x.derived, newFlags: x.newFlags }; }, body.note); logLine({ kind: "tape", note: body.note, ...r }); return r; }
  if (path === "/tapeid") { const r = await ev((id) => { const x = window.__wm.tape(id); return x ? { recorded: x.recorded, clue: x.clue?.id ?? null } : null; }, body.id); logLine({ kind: "tapeid", id: body.id, ...(r ?? {}) }); return r; }
  if (path === "/close") { await ev(() => window.__wm.closeConversation("player")); await page_.waitForTimeout(200); return state(); }
  if (path === "/op") {
    const op = body.op;
    logLine({ kind: "op", ...body });
    await ev((b) => {
      const w = window.__wm;
      if (w.app.conv) w.closeConversation("player");
      switch (b.op) {
        case "reset": w.resetMState(); w.startGame(); break;
        case "beginDay": w.beginDay(b.day ?? 1); break;
        case "endDay": w.endDay(); break;
        case "afterEvening": w.afterEvening(); break;
        case "flag": w.mstate.flags.add(b.flag); w.touch(); break;
        case "unflag": w.mstate.flags.delete(b.flag); w.touch(); break;
        case "bond": w.npcRt(b.npc).bond = b.value !== false; w.touch(); break;
        case "mood": w.npcRt(b.npc).mood = b.mood; w.touch(); break;
        case "place": w.scene().placePlayer(b.x, b.y); break;
      }
    }, body);
    await page_.waitForTimeout(300);
    // dismiss any scene overlays so the API stays usable
    for (let i = 0; i < 5; i++) {
      const vis = await page_.locator("#overlay.visible").count();
      if (!vis) break;
      const btn = page_.locator("#overlay-card button").first();
      const label = await btn.innerText().catch(() => "");
      if (/Marguerite|Say nothing|Play again/.test(label)) break; // the gathering choice or an ending: leave it
      await btn.click();
      await page_.waitForTimeout(200);
    }
    return state();
  }
  if (path === "/accuse") { await ev((id) => { window.__wm.accuse(id ?? null); }, body.npc ?? null); await page_.waitForTimeout(300); const s = await state(); logLine({ kind: "accuse", npc: body.npc ?? null, outcome: s.outcome }); return s; }
  if (path === "/mic") {
    if (!MIC) return { error: "driver was not started with --mic=<wav>" };
    const key = body.key === "tape" ? "r" : " ";
    await ev(() => { window.__lastHeard = null; });
    await page_.keyboard.down(key);
    await page_.waitForTimeout((body.seconds ?? 4) * 1000);
    await page_.keyboard.up(key);
    await page_.waitForFunction(() => window.__lastHeard !== null, null, { timeout: 60000 }).catch(() => {});
    const heard = await ev(() => window.__lastHeard);
    logLine({ kind: "mic", key: body.key, heard });
    return { heard };
  }
  // ---- player facade: only what a player sees on screen. No clue ids, flags, pool, or prompts. ----
  if (path.startsWith("/player/")) return player(path.slice(8), body);
  if (path === "/errors") return { pageErrors };
  if (path === "/quit") { setTimeout(() => process.exit(0), 100); return { bye: true }; }
  return { error: `unknown ${method} ${path}` };
}

const PHASE_TEXT = { party: "The midsummer garden party at Willowmere. Walter Bram, a resident, is alive and holding court.", day1: "Day 1. Walter Bram was found dead this morning. The doctor says heart. The inspector arrives tomorrow evening; you have today and tomorrow.", evening: "Evening of Day 1. The residents are at supper. An engineer is in the hall looking at the boiler.", day2: "Day 2. The inspector arrives this evening." };
async function player(op, body) {
  const s = await state();
  const people = await ev(() => { const { NPCS } = window.__wm; const out = {}; for (const id of Object.keys(NPCS)) { const av = window.__wm.app.scene ? null : null; out[id] = { name: NPCS[id].name, role: NPCS[id].role, activity: NPCS[id].minigame ? { id: NPCS[id].minigame, title: ({ crossword: "The crossword", cards: "Captain's Patience (cards)", garden: "The herb bed", trolley: "The trolley", brooch: "The brooch" })[NPCS[id].minigame], minutes: 3 } : null }; } return out; });
  const availability = await page_.evaluate(() => { const out = {}; const w = window.__wm; for (const id of Object.keys(w.NPCS)) { const a = w.npcAvailable ? w.npcAvailable(id) : { ok: true, why: "" }; out[id] = a; } return out; });
  const tapeEntries = await ev(() => window.__wm.mstate.tape.map((t) => ({ page: t.page, note: t.note, said: t.heard ?? (window.__wm.CLUES ?? []).find?.((c) => c.id === t.clueId)?.text ?? "" })));
  const heardNotTaped = await ev(() => window.__wm.mstate.pool.map((id) => window.__wm.mstate.heard[id]).filter(Boolean));
  const view = () => ({
    scene: PHASE_TEXT[s.phase], minutesLeft: s.gamePhase === "day" ? Math.max(0, 45 - Math.round(s.elapsed)) : null, talkingTo: s.conv,
    people: Object.fromEntries(Object.entries(people).filter(([id]) => availability[id]?.ok || s.conv === id).map(([id, p]) => [id, { ...p, status: availability[id]?.why || "here", mood: s.npcs[id].mood }])),
    tape: tapeEntries, heardButNotTaped: heardNotTaped, canGoToBed: s.gamePhase === "prologue" || s.gamePhase === "day" || s.gamePhase === "evening1", gathering: s.gamePhase === "gathering", ended: s.outcome,
  });
  // any scene text that appeared (the party, the discovery, the chandelier, the gathering) is part of what the player sees
  const events = [];
  for (let i = 0; i < 4; i++) {
    if (!(await page_.locator("#overlay.visible").count())) break;
    const lines = await page_.locator("#overlay-card p").allInnerTexts().catch(() => []);
    const btn = page_.locator("#overlay-card button").first();
    const label = await btn.innerText().catch(() => "");
    events.push(lines.join(" "));
    if (/Marguerite|Say nothing|Play again/.test(label)) break; // the gathering choice, or an ending: never press these
    await btn.click().catch(() => {});
    await page_.waitForTimeout(200);
  }
  if (op === "state") return { ...view(), events };
  if (op === "open") { const r = await open(body.npc); return { ...r, ...view() }; }
  if (op === "say") { const r = await say(body.line); logLine({ kind: "player", npc: r.report.npcId, line: body.line, reply: r.reply, voiced: r.report.voiced, refused: r.report.refused, tone: r.report.output.tone, mood: r.report.moodAfter, left: r.report.left, rendererMB: rendererMB() }); const after = await state(); return { reply: r.reply, worthTaping: r.report.voiced.length > 0, theyLeft: r.report.left, mood: r.report.moodAfter, minutesLeft: after.gamePhase === "day" ? Math.max(0, 45 - Math.round(after.elapsed)) : null, events }; }
  if (op === "tape") { const r = await ev((n) => { const x = window.__wm.record(n); return { recorded: x.recorded, filedUnder: x.page, said: x.clue ? (window.__wm.mstate.heard[x.clue.id] ?? x.clue.text) : null }; }, body.note); logLine({ kind: "player-tape", note: body.note, ...r }); const after = await player("state", {}); return { ...r, events: [...events, ...(after.events ?? [])], minutesLeft: after.minutesLeft, talkingTo: after.talkingTo }; }
  if (op === "close") { await ev(() => window.__wm.closeConversation("player")); await page_.waitForTimeout(200); return view(); }
  if (op === "look") { const found = await ev(() => window.__wm.lookAround ? window.__wm.lookAround() : []); return { found: found.length ? "A pharmacy delivery slip pinned in the hall: Bram, W. — digoxin, 28 capsules, this week. Worth taping." : "Nothing new in the hall." }; }
  if (op === "activity") { await ev((id) => { window.__wm.completeMinigame(id, true); }, body.id); await page_.waitForTimeout(200); logLine({ kind: "player-activity", id: body.id }); return { done: true, ...(await player("state", {})) }; }
  if (op === "bed") {
    const opName = s.gamePhase === "prologue" ? "beginDay" : s.gamePhase === "day" ? "endDay" : "afterEvening";
    logLine({ kind: "op", op: opName, day: 1, via: "player" });
    await ev((o) => { const w = window.__wm; if (w.app.conv) w.closeConversation("player"); if (o === "beginDay") w.beginDay(1); else if (o === "endDay") w.endDay(); else w.afterEvening(); }, opName);
    await page_.waitForTimeout(400);
    return player("state", {}); // its overlay loop reads and dismisses the morning/evening/gathering text as events
  }
  if (op === "accuse") {
    const r = await handle("POST", "/accuse", { npc: body.npc ?? null });
    await page_.waitForFunction(() => { const b = document.querySelector("#overlay-card button"); return !!b && /Play again/.test(b.textContent ?? ""); }, null, { timeout: 15000 }).catch(() => {});
    const ending = await page_.locator("#overlay-card p").allInnerTexts().catch(() => []);
    return { outcome: r.outcome, ending };
  }
  return { error: `unknown player op ${op}` };
}

createServer(async (req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    try {
      const out = await handle(req.method, req.url, body ? JSON.parse(body) : {});
      await snapshot();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(out));
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(e?.message ?? e) }));
    }
  });
}).listen(PORT);
