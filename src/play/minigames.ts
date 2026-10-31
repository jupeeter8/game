/** Five small DOM minigames. Each resolves true when completed, false when abandoned. */
export type Minigame = (card: HTMLElement) => Promise<boolean>;

function h(tag: string, attrs: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElement {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v as EventListener);
    else if (k === "class") n.className = String(v);
    else if (k === "style") Object.assign(n.style, v as object);
    else (n as unknown as Record<string, unknown>)[k] = v;
  }
  for (const k of kids) n.append(k);
  return n;
}
function shuffle<T>(xs: T[]): T[] { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/** Edith: three clues, the answers are things she has told you. */
const crossword: Minigame = (card) => new Promise((resolve) => {
  const Q = [
    { clue: "Walter hadn't touched one in twenty years (4)", a: "DROP" },
    { clue: "Walter sold the house to the ____ (12)", a: "FAIRWEATHERS" },
    { clue: "\"Over my dead ____\" (4)", a: "BODY" },
  ];
  const inputs = Q.map((q) => h("input", { type: "text", maxLength: q.a.length, style: { width: "160px", textTransform: "uppercase" } }) as HTMLInputElement);
  const msg = h("div", { class: "muted" });
  const check = () => {
    const ok = Q.every((q, i) => inputs[i].value.trim().toUpperCase() === q.a);
    if (ok) { msg.textContent = "\"Well. You listen, at least.\""; setTimeout(() => resolve(true), 900); }
    else msg.textContent = Q.map((q, i) => inputs[i].value.trim().toUpperCase() === q.a ? "✓" : "✗").join("  ");
  };
  card.replaceChildren(
    h("h3", {}, "The crossword"), h("p", { class: "muted" }, "Edith slides the paper over. Three left. The answers are things she has told you."),
    ...Q.map((q, i) => h("div", { class: "mg-row" }, h("label", {}, q.clue), inputs[i])),
    msg,
    h("div", { class: "mg-row" }, h("button", { class: "primary", onclick: check }, "Check"), h("button", { onclick: () => resolve(false) }, "Give up (3 min)")),
  );
  inputs[0].focus();
});

/** Pugh: higher or lower. Finishing and saying the right thing counts; the score doesn't. */
const cards: Minigame = (card) => new Promise((resolve) => {
  const deck = shuffle(Array.from({ length: 52 }, (_, i) => i));
  let i = 0, right = 0, round = 0;
  const face = (c: number) => { const r = c % 13, s = Math.floor(c / 13); const rank = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"][r]; const suit = ["♠", "♥", "♦", "♣"][s]; return h("span", { class: `card-face ${s === 1 || s === 2 ? "red" : ""}` }, rank + suit); };
  const area = h("div");
  const msg = h("div", { class: "muted" });
  const render = () => {
    area.replaceChildren(face(deck[i]), h("span", {}, `Round ${round + 1} of 6. Next card is…`),
      h("div", { class: "mg-row" }, h("button", { class: "primary", onclick: () => guess(true) }, "Higher"), h("button", { class: "primary", onclick: () => guess(false) }, "Lower")));
  };
  const guess = (higher: boolean) => {
    const a = deck[i] % 13, b = deck[i + 1] % 13;
    const ok = higher ? b > a : b < a;
    if (ok) right++;
    i++; round++;
    msg.textContent = ok ? `"${["Ha!", "Lucky.", "Not bad, boy."][round % 3]}"` : `"${["Wrong.", "Never gamble, boy.", "Tsk."][round % 3]}"`;
    if (round >= 6) finish(); else render();
  };
  const finish = () => {
    area.replaceChildren(h("p", {}, `${right} of 6. The Captain gathers the cards. What do you say?`),
      h("div", { class: "mg-row" },
        h("button", { class: "primary", onclick: () => { msg.textContent = "\"Hm. You'll do.\""; setTimeout(() => resolve(true), 900); } }, "\"Well played, Captain.\""),
        h("button", { onclick: () => { msg.textContent = "\"Out.\""; setTimeout(() => resolve(false), 900); } }, "\"You cheated.\"")));
  };
  card.replaceChildren(h("h3", {}, "Captain's Patience"), h("p", { class: "muted" }, "\"Higher or lower. Six cards. And none of your sulking.\""), area, msg,
    h("div", { class: "mg-row" }, h("button", { onclick: () => resolve(false) }, "Walk away (3 min)")));
  render();
});

/** Rose: pull the weeds, leave the flowers. */
const garden: Minigame = (card) => new Promise((resolve) => {
  const N = 30, weeds = new Set(shuffle(Array.from({ length: N }, (_, i) => i)).slice(0, 10));
  let left = weeds.size, strikes = 0, seconds = 40;
  const msg = h("div", { class: "muted" }, `${left} weeds. ${seconds}s.`);
  const grid = h("div", { class: "mg-grid", style: { gridTemplateColumns: "repeat(6, 1fr)" } });
  const timer = setInterval(() => { seconds--; msg.textContent = `${left} weeds. ${seconds}s.`; if (seconds <= 0) { clearInterval(timer); msg.textContent = "\"Never mind, dear. It's the thought.\""; setTimeout(() => resolve(false), 900); } }, 1000);
  for (let i = 0; i < N; i++) {
    const isWeed = weeds.has(i);
    const cell = h("div", { class: "mg-cell" }, isWeed ? ["🌿", "🌱", "☘️"][i % 3] : ["🌸", "🌼", "🌷", "🌺"][i % 4]);
    cell.addEventListener("click", () => {
      if (cell.classList.contains("pulled")) return;
      if (isWeed) { cell.classList.add("pulled"); left--; if (left === 0) { clearInterval(timer); msg.textContent = "\"Oh, look at that. Thank you, Sam.\""; setTimeout(() => resolve(true), 900); } }
      else { strikes++; cell.textContent = "💔"; cell.classList.add("pulled"); if (strikes >= 3) { clearInterval(timer); msg.textContent = "\"Those were Walter's. Leave it, dear.\""; setTimeout(() => resolve(false), 900); } }
      msg.textContent = `${left} weeds. ${seconds}s. ${strikes ? `${strikes} flowers lost.` : ""}`;
    });
    grid.append(cell);
  }
  card.replaceChildren(h("h3", {}, "The herb bed"), h("p", { class: "muted" }, "\"The weeds are the plain green ones. Mind the flowers, they were Walter's.\""), grid, msg,
    h("div", { class: "mg-row" }, h("button", { onclick: () => { clearInterval(timer); resolve(false); } }, "Stop (3 min)")));
});

/** Tomasz: match each medicine to the resident. */
const trolley: Minigame = (card) => new Promise((resolve) => {
  const pairs = [["Digoxin, 1 a day", "Walter"], ["Co-codamol, hip", "Rose"], ["Donepezil, memory", "Pearl"], ["Warfarin, with the chart", "Edith"], ["Ramipril, blood pressure", "Captain Pugh"]];
  const names = shuffle(pairs.map((p) => p[1]));
  const selects = pairs.map(() => h("select", {}, h("option", { value: "" }, "—"), ...names.map((n) => h("option", { value: n }, n))) as HTMLSelectElement);
  const msg = h("div", { class: "muted" });
  const check = () => {
    const wrong = pairs.filter((p, i) => selects[i].value !== p[1]).length;
    if (!wrong) { msg.textContent = "\"Yes. Yes, that is right. Thank you.\""; setTimeout(() => resolve(true), 900); }
    else msg.textContent = `${wrong} wrong. "Please, check again, it matters."`;
  };
  card.replaceChildren(h("h3", {}, "The trolley"), h("p", { class: "muted" }, "\"Marguerite left the trolley. Help me, please. Hip, memory, heart, pressure, the chart one.\""),
    ...pairs.map((p, i) => h("div", { class: "mg-row" }, h("label", {}, p[0]), selects[i])), msg,
    h("div", { class: "mg-row" }, h("button", { class: "primary", onclick: check }, "Check"), h("button", { onclick: () => resolve(false) }, "Leave it (3 min)")));
});

/** Pearl: find the brooch in the lounge. Warmer / colder. */
const brooch: Minigame = (card) => new Promise((resolve) => {
  const COLS = 6, ROWS = 5, N = COLS * ROWS, target = Math.floor(Math.random() * N);
  let tries = 8;
  const objs = ["📚", "🕯️", "🧶", "🫖", "🖼️", "🪴", "📻", "🧵", "🪑", "🎩", "☕", "📰", "🧦", "🪞", "🔑"];
  const msg = h("div", { class: "muted" }, `${tries} looks left. "It's small. Gold. A little bird."`);
  const grid = h("div", { class: "mg-grid", style: { gridTemplateColumns: `repeat(${COLS}, 1fr)` } });
  for (let i = 0; i < N; i++) {
    const cell = h("div", { class: "mg-cell" }, objs[(i * 7 + 3) % objs.length]);
    cell.addEventListener("click", () => {
      if (cell.classList.contains("pulled")) return;
      cell.classList.add("pulled");
      if (i === target) { cell.textContent = "🐦"; cell.classList.remove("pulled"); msg.textContent = "\"My bird! Oh, Sam.\""; setTimeout(() => resolve(true), 900); return; }
      tries--;
      const d = Math.abs(i % COLS - target % COLS) + Math.abs(Math.floor(i / COLS) - Math.floor(target / COLS));
      msg.textContent = tries > 0 ? `${tries} looks left. ${d <= 1 ? "\"Very warm.\"" : d <= 3 ? "\"Warmer.\"" : "\"Cold, dear.\""}` : "\"Never mind. It'll turn up.\"";
      if (tries <= 0) setTimeout(() => resolve(false), 900);
    });
    grid.append(cell);
  }
  card.replaceChildren(h("h3", {}, "The brooch"), h("p", { class: "muted" }, "The lounge. Pearl points, vaguely, at everything."), grid, msg,
    h("div", { class: "mg-row" }, h("button", { onclick: () => resolve(false) }, "Give up (3 min)")));
});

export const MINIGAME_IMPL: Record<string, Minigame> = { crossword, cards, garden, trolley, brooch };
