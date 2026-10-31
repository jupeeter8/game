import Phaser from "phaser";
import { NPCS, type Look, type NpcDef } from "../mystery/content";
import { npcAvailable } from "../mystery/events";
import { mstate } from "../mystery/state";

export const TILE = 16;
export const COLS = 40;
export const ROWS = 28;

/**
 * Legend: # wall  . wood  , carpet  g grass  p path  h hedge  f flowers  w herb bed  x tree
 * D door  W window  B bed  T table  c chair  A armchair  S sofa  C meds cabinet  O boiler
 * N noticeboard  K counter  R card table  L chandelier (walkable)  @ player start (day)
 */
const MAP = [
  "########################################",
  "#...N....#A,,,,,,,,,,,,,,,SS.#ggggggggg#",
  "#........#,,,,,,,,,,,,,,,,,,.#ggfgggfgg#",
  "#........#,,,,,,,,,,,,,,,,,,.#gggggggxg#",
  "#........D,,,,,,,,L,,,,,,,,,.Dppgggggg#",
  "#........#,,,,,,,,,,,R,,,,,,.#gpgggggxg#",
  "#........#,,,,,,,,,,c,c,,,,,.#gpggfgggg#",
  "#.......O#,,,,,,,,,,,,,,,,,,.#gpgggggxg#",
  "####D#################D#######gpgggggfg#",
  "#............................#gpggxgggg#",
  "#............................Dppggggggg#",
  "###D######D#####D#######D#####gpgggfggg#",
  "#......#.....#.....#KKKKKKKC.#gpgggggxg#",
  "#B.....#B....#B....#.........#gpgggggfg#",
  "#......#.....#.....#.........#gpgggxggg#",
  "#......#.....#.....#....T....#gpggggggg#",
  "#......#.....#.....#.........#gpggfgggg#",
  "###D######D#####D#######D#####gpgggggxg#",
  "#............................#gpggggggg#",
  "#............................Dppgggggfg#",
  "###D######D#####D#######D#####gpgggggxg#",
  "#......#.....#.....#.........#gpwwwwwgg#",
  "#..T...#B....#B....#B........#gpwwwwwgg#",
  "#..C...#.....#.....#.........#gpwwwwwgg#",
  "#......#.....#.....#.........#gpgggggxg#",
  "#......#.....#.....#.........#gpggfgggg#",
  "#......#.....#.....#.........#ggggggggg#",
  "########################################",
];

export const ROOM_LABELS: { x: number; y: number; text: string }[] = [
  { x: 4, y: 2, text: "hall" }, { x: 19, y: 2, text: "lounge" }, { x: 34, y: 2, text: "garden" },
  { x: 3, y: 16, text: "Walter" }, { x: 10, y: 16, text: "Edith" }, { x: 16, y: 16, text: "Pearl" }, { x: 24, y: 14, text: "kitchen" },
  { x: 3, y: 26, text: "office" }, { x: 10, y: 26, text: "Rose" }, { x: 16, y: 26, text: "Pugh" }, { x: 24, y: 26, text: "Tomasz" }, { x: 34, y: 25, text: "herbs" },
];

export type Target = { kind: "npc"; id: string } | { kind: "board" } | { kind: "chandelier" } | { kind: "walter" };

export class WillowmereScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<"W" | "A" | "S" | "D", Phaser.Input.Keyboard.Key>;
  private walls!: Phaser.Physics.Arcade.StaticGroup;
  private npcSprites = new Map<string, { s: Phaser.GameObjects.Sprite; label: Phaser.GameObjects.Text; block: Phaser.Physics.Arcade.Sprite }>();
  private walter: { s: Phaser.GameObjects.Sprite; label: Phaser.GameObjects.Text } | null = null;
  private hint!: Phaser.GameObjects.Text;
  private chandelier!: Phaser.GameObjects.Sprite;
  private chandelierDown = false;
  private nearest: Target | null = null;
  private lastPhase = "";
  /** set by the controller; when not "walk", movement and E are ignored */
  uiMode: "walk" | "menu" | "dialogue" | "minigame" | "overlay" = "walk";

  constructor() { super("willowmere"); }

  create(): void {
    this.makeTextures();
    this.walls = this.physics.add.staticGroup();
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const c = MAP[y][x];
      const px = x * TILE + TILE / 2, py = y * TILE + TILE / 2;
      const base = c === "g" || c === "f" || c === "x" || c === "w" || c === "p" || c === "h" ? "grass" : c === "," || c === "A" || c === "S" || c === "R" || c === "c" || c === "L" ? "carpet" : "wood";
      this.add.image(px, py, base);
      const solid = (key: string) => { this.add.image(px, py, key); this.walls.create(px, py, "blk").setVisible(false).refreshBody(); };
      switch (c) {
        case "#": solid("wall"); break;
        case "D": this.add.image(px, py, "door"); break;
        case "p": this.add.image(px, py, "path"); break;
        case "f": this.add.image(px, py, "flowers"); break;
        case "w": this.add.image(px, py, "herbs"); break;
        case "x": solid("tree"); break;
        case "B": solid("bed"); break;
        case "T": solid("table"); break;
        case "c": this.add.image(px, py, "chair"); break;
        case "A": solid("armchair"); break;
        case "S": solid("sofa"); break;
        case "C": solid("cabinet"); break;
        case "O": solid("boiler"); break;
        case "N": solid("board"); break;
        case "K": solid("counter"); break;
        case "R": solid("cardtable"); break;
        case "L": this.chandelier = this.add.sprite(px, py - 2, "chandelier").setDepth(5); break;
      }
    }
    for (const l of ROOM_LABELS) this.add.text(l.x * TILE + TILE / 2, l.y * TILE, l.text, { fontSize: "6px", fontFamily: "'Press Start 2P', monospace", color: "#ffffff66" }).setOrigin(0.5).setDepth(1);

    this.player = this.physics.add.sprite(4 * TILE + 8, 5 * TILE + 8, "actor_player");
    this.player.setDepth(4);
    this.player.body!.setSize(10, 8).setOffset(3, 14);
    this.physics.add.collider(this.player, this.walls);
    this.physics.world.setBounds(0, 0, COLS * TILE, ROWS * TILE);
    this.cameras.main.setBounds(0, 0, COLS * TILE, ROWS * TILE).startFollow(this.player, true, 0.12, 0.12).setZoom(2);

    const kb = this.input.keyboard!;
    this.cursors = kb.createCursorKeys();
    this.wasd = kb.addKeys("W,A,S,D") as typeof this.wasd;
    kb.addKey(Phaser.Input.Keyboard.KeyCodes.E).on("down", () => this.tryInteract());
    kb.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER).on("down", () => { if (this.uiMode === "walk") this.tryInteract(); });

    this.hint = this.add.text(0, 0, "", { fontSize: "8px", fontFamily: "'Press Start 2P', monospace", color: "#ffe066", backgroundColor: "#000000bb", padding: { x: 3, y: 2 } }).setOrigin(0.5, 1).setDepth(10);
    this.refreshNpcs();
    this.game.events.on("state:changed", () => this.refreshNpcs());
    this.game.events.emit("scene:ready");
  }

  update(): void {
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(0);
    const typing = !!document.activeElement && ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName);
    if (this.uiMode === "walk" && !typing) {
      const speed = 90;
      const l = this.cursors.left.isDown || this.wasd.A.isDown, r = this.cursors.right.isDown || this.wasd.D.isDown;
      const u = this.cursors.up.isDown || this.wasd.W.isDown, d = this.cursors.down.isDown || this.wasd.S.isDown;
      body.setVelocityX(l ? -speed : r ? speed : 0);
      body.setVelocityY(u ? -speed : d ? speed : 0);
      body.velocity.normalize().scale(speed);
      if (l) this.player.setFlipX(true); else if (r) this.player.setFlipX(false);
    }
    this.player.setDepth(4 + this.player.y / 10000);
    this.findNearest();
  }

  setMode(m: WillowmereScene["uiMode"]): void {
    this.uiMode = m;
    const kb = this.input.keyboard!;
    if (m === "walk") kb.enableGlobalCapture(); else { kb.disableGlobalCapture(); kb.resetKeys(); }
  }

  /** Teleport Sam (phase changes). */
  placePlayer(tx: number, ty: number): void { this.player.setPosition(tx * TILE + 8, ty * TILE + 8); }

  private tryInteract(): void {
    const typing = !!document.activeElement && ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName);
    if (this.uiMode !== "walk" || !this.nearest || typing) return;
    this.game.events.emit("interact", this.nearest);
  }

  private findNearest(): void {
    let best: Target | null = null, bestD = 30;
    for (const [id, o] of this.npcSprites) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, o.s.x, o.s.y);
      if (d < bestD) { bestD = d; best = { kind: "npc", id }; }
    }
    const bx = 4 * TILE + 8, by = 1 * TILE + 8;
    if (Phaser.Math.Distance.Between(this.player.x, this.player.y, bx, by) < 26) best = { kind: "board" };
    if (this.walter && Phaser.Math.Distance.Between(this.player.x, this.player.y, this.walter.s.x, this.walter.s.y) < bestD) best = { kind: "walter" };
    if (this.chandelierDown && Phaser.Math.Distance.Between(this.player.x, this.player.y, this.chandelier.x, this.chandelier.y) < 24) best = { kind: "chandelier" };
    this.nearest = best;
    if (best && this.uiMode === "walk") {
      const label = best.kind === "npc" ? NPCS[best.id].name : best.kind === "board" ? "noticeboard" : best.kind === "walter" ? "Walter" : "the chandelier";
      this.hint.setText(`E  ${label}`).setPosition(this.player.x, this.player.y - 14).setVisible(true);
    } else this.hint.setVisible(false);
  }

  /** Add/remove NPC sprites to match availability and phase. Called on every state change. */
  refreshNpcs(): void {
    const party = mstate.phase === "prologue";
    if (this.lastPhase !== mstate.phase + mstate.day) {
      this.lastPhase = mstate.phase + mstate.day;
      if (party) this.placePlayer(31, 20); else if (mstate.phase === "day" || mstate.phase === "evening1") this.placePlayer(4, 5);
    }
    for (const npc of Object.values(NPCS)) {
      const here = npcAvailable(npc.id).ok;
      const spot = party ? npc.spots.party : npc.spots.day;
      const cur = this.npcSprites.get(npc.id);
      if (here && !cur) {
        const x = spot[0] * TILE + 8, y = spot[1] * TILE + 8;
        const s = this.add.sprite(x, y, `actor_${npc.id}`).setDepth(4 + y / 10000);
        s.setData("baseY", y);
        const label = this.add.text(x, y - 16, npc.name, { fontSize: "7px", fontFamily: "'Press Start 2P', monospace", color: "#fff", backgroundColor: "#00000088", padding: { x: 2, y: 1 } }).setOrigin(0.5).setDepth(9);
        const block = this.walls.create(x, y + 3, "blk") as Phaser.Physics.Arcade.Sprite;
        block.setVisible(false).refreshBody();
        this.tweens.add({ targets: s, y: y - 1, duration: 600 + Math.random() * 400, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
        this.npcSprites.set(npc.id, { s, label, block });
      } else if (!here && cur) {
        cur.s.destroy(); cur.label.destroy(); cur.block.destroy();
        this.npcSprites.delete(npc.id);
      } else if (here && cur) {
        const x = spot[0] * TILE + 8, y = spot[1] * TILE + 8;
        if (Math.abs(cur.s.x - x) > 1 || Math.abs((cur.s.getData("baseY") as number) - y) > 1) {
          this.tweens.killTweensOf(cur.s);
          cur.s.setPosition(x, y); cur.s.setData("baseY", y); cur.label.setPosition(x, y - 16); cur.block.setPosition(x, y + 3).refreshBody();
          this.tweens.add({ targets: cur.s, y: y - 1, duration: 800, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
        }
      }
    }
    if (party && !this.walter) {
      const x = 35 * TILE + 8, y = 4 * TILE + 8;
      const s = this.add.sprite(x, y, "actor_walter").setDepth(4 + y / 10000);
      const label = this.add.text(x, y - 16, "Walter", { fontSize: "7px", fontFamily: "'Press Start 2P', monospace", color: "#fff", backgroundColor: "#00000088", padding: { x: 2, y: 1 } }).setOrigin(0.5).setDepth(9);
      this.walter = { s, label };
    } else if (!party && this.walter) { this.walter.s.destroy(); this.walter.label.destroy(); this.walter = null; }
    if (mstate.flags.has("chandelier_fell") && !this.chandelierDown) this.dropChandelier(true);
  }

  setTalking(id: string, on: boolean): void {
    const o = this.npcSprites.get(id);
    if (!o) return;
    this.tweens.killTweensOf(o.s);
    const baseY = o.s.getData("baseY") as number;
    if (on) this.tweens.add({ targets: o.s, y: baseY - 3, duration: 90, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    else { o.s.y = baseY; this.tweens.add({ targets: o.s, y: baseY - 1, duration: 800, yoyo: true, repeat: -1, ease: "Sine.easeInOut" }); }
  }

  /** The chandelier comes down. Resolves when the crash is over. */
  dropChandelier(instant = false): Promise<void> {
    this.chandelierDown = true;
    return new Promise((resolve) => {
      if (instant) { this.chandelier.setTexture("chandelier_down").setDepth(2); resolve(); return; }
      this.cameras.main.pan(this.chandelier.x, this.chandelier.y, 500, "Sine.easeInOut");
      this.tweens.add({ targets: this.chandelier, y: this.chandelier.y + 6, duration: 700, ease: "Quad.easeIn", onComplete: () => {
        this.chandelier.setTexture("chandelier_down").setDepth(2);
        this.cameras.main.shake(400, 0.01);
        this.time.delayedCall(700, () => { this.cameras.main.startFollow(this.player, true, 0.12, 0.12); resolve(); });
      } });
    });
  }

  // ---------- pixel textures, generated once ----------
  private makeTextures(): void {
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    const px = (x: number, y: number, c: number, w = 1, h = 1) => g.fillStyle(c).fillRect(x, y, w, h);
    const tex = (key: string, draw: () => void, w = TILE, h = TILE) => { g.clear(); draw(); g.generateTexture(key, w, h); };
    tex("wood", () => { px(0, 0, 0x8a6a46, 16, 16); for (let y = 0; y < 16; y += 4) { px(0, y, 0x7a5c3c, 16, 1); px((y / 4) * 5 % 16, y + 2, 0x6e5234, 1, 2); } });
    tex("carpet", () => { px(0, 0, 0x6b3b4a, 16, 16); for (let y = 0; y < 16; y += 2) for (let x = (y / 2) % 2; x < 16; x += 2) px(x, y, 0x73424f); px(0, 0, 0x5a2f3d, 16, 1); px(0, 15, 0x5a2f3d, 16, 1); });
    tex("grass", () => { px(0, 0, 0x3f8f3f, 16, 16); for (let i = 0; i < 9; i++) px((i * 7) % 16, (i * 5) % 16, 0x4ca24c, 1, 2); px(13, 3, 0x357f35); px(3, 11, 0x357f35); });
    tex("path", () => { px(0, 0, 0xb8a27a, 16, 16); px(2, 3, 0xa8926a, 3, 2); px(9, 9, 0xa8926a, 4, 2); px(12, 2, 0xc9b58d, 2, 2); });
    tex("flowers", () => { px(0, 0, 0x3f8f3f, 16, 16); for (let i = 0; i < 5; i++) { const x = (i * 6 + 2) % 14, y = (i * 4 + 3) % 13; px(x, y, [0xff6b9d, 0xffd166, 0xffffff, 0xff6b6b, 0xc77dff][i], 2, 2); px(x, y + 2, 0x2d6b2d, 1, 2); } });
    tex("herbs", () => { px(0, 0, 0x5b3d26, 16, 16); for (let i = 0; i < 6; i++) { const x = (i * 5 + 1) % 14, y = (i * 7 + 2) % 12; px(x, y, 0x7bc96f, 2, 3); px(x + 1, y - 1, 0x9fdc8f, 1, 1); } });
    tex("wall", () => { px(0, 0, 0x4a3f55, 16, 16); for (let y = 0; y < 16; y += 4) for (let x = (y / 4) % 2 ? 0 : 4; x < 16; x += 8) px(x, y, 0x5a4d66, 7, 3); px(0, 0, 0x33293d, 16, 1); });
    tex("door", () => { px(0, 0, 0x8a6a46, 16, 16); px(2, 0, 0x5c3a1e, 12, 16); px(3, 1, 0x7a4f2a, 10, 14); px(11, 8, 0xffd166, 2, 2); });
    tex("tree", () => { px(0, 0, 0x3f8f3f, 16, 16); px(6, 9, 0x5c3a1e, 4, 7); px(1, 1, 0x2d6b2d, 14, 9); px(3, 0, 0x3c8a3c, 10, 3); px(4, 3, 0x4ca24c, 4, 3); });
    tex("bed", () => { px(0, 0, 0x8a6a46, 16, 16); px(1, 1, 0x5c3a1e, 14, 14); px(2, 2, 0xf1ede4, 12, 12); px(3, 3, 0xd9e6f2, 10, 3); px(2, 7, 0x8b4d6b, 12, 7); });
    tex("table", () => { px(0, 0, 0x8a6a46, 16, 16); px(1, 3, 0x5c3a1e, 14, 9); px(2, 4, 0x7a4f2a, 12, 7); px(2, 12, 0x4a2e16, 2, 3); px(12, 12, 0x4a2e16, 2, 3); });
    tex("chair", () => { px(0, 0, 0x6b3b4a, 16, 16); px(5, 4, 0x5c3a1e, 6, 8); px(5, 2, 0x7a4f2a, 6, 3); });
    tex("armchair", () => { px(0, 0, 0x6b3b4a, 16, 16); px(2, 2, 0x9b2226, 12, 12); px(4, 5, 0xc0392b, 8, 7); px(2, 2, 0x7a1a1d, 12, 3); });
    tex("sofa", () => { px(0, 0, 0x6b3b4a, 16, 16); px(0, 3, 0x4b3f8a, 16, 11); px(1, 6, 0x6a5bb8, 14, 6); px(0, 3, 0x3b3170, 16, 3); });
    tex("cabinet", () => { px(0, 0, 0x8a6a46, 16, 16); px(2, 1, 0xd9dde3, 12, 14); px(3, 2, 0xf4f6f8, 10, 12); px(7, 5, 0xc0392b, 2, 6); px(5, 7, 0xc0392b, 6, 2); px(6, 12, 0x555, 4, 1); });
    tex("boiler", () => { px(0, 0, 0x8a6a46, 16, 16); px(3, 1, 0x3a3a3a, 10, 14); px(4, 2, 0x5a5a5a, 8, 12); px(7, 4, 0xff8c42, 2, 2); px(5, 9, 0x2a2a2a, 6, 4); });
    tex("board", () => { px(0, 0, 0x4a3f55, 16, 16); px(1, 2, 0x5c3a1e, 14, 11); px(2, 3, 0x9b7b4f, 12, 9); px(3, 4, 0xfff8e0, 4, 5); px(9, 5, 0xfff8e0, 4, 4); px(4, 5, 0x333, 2, 1); });
    tex("counter", () => { px(0, 0, 0x8a6a46, 16, 16); px(0, 2, 0x9aa5ad, 16, 10); px(0, 2, 0xc9d1d6, 16, 3); px(2, 7, 0x6e787f, 5, 3); });
    tex("cardtable", () => { px(0, 0, 0x6b3b4a, 16, 16); px(1, 2, 0x5c3a1e, 14, 11); px(2, 3, 0x2e7d32, 12, 9); px(4, 5, 0xfff, 3, 4); px(9, 5, 0xfff, 3, 4); px(5, 6, 0xc0392b, 1, 1); });
    tex("chandelier", () => { px(7, 0, 0xd4af37, 2, 4); px(3, 4, 0xd4af37, 10, 2); px(2, 6, 0xd4af37, 2, 3); px(12, 6, 0xd4af37, 2, 3); px(7, 6, 0xd4af37, 2, 3); px(2, 3, 0xfff6c2, 2, 1); px(12, 3, 0xfff6c2, 2, 1); px(7, 3, 0xfff6c2, 2, 1); px(4, 9, 0xffe9a8, 8, 1); });
    tex("chandelier_down", () => { px(1, 9, 0x8a7a3a, 14, 2); px(3, 11, 0xd4af37, 3, 2); px(9, 12, 0xd4af37, 4, 2); px(0, 13, 0xd4af37, 2, 2); px(6, 7, 0xfff6c2, 2, 2); px(12, 8, 0xfff6c2, 1, 2); px(5, 14, 0x5a4a1a, 6, 1); });
    tex("blk", () => { g.fillStyle(0, 0).fillRect(0, 0, 16, 16); });
    this.makeActor("actor_player", { hair: "#3a2a1a", skin: "#f1c9a5", body: "#4a90e2", style: "short" });
    this.makeActor("actor_walter", { hair: "#e8e8e8", skin: "#e8b08c", body: "#7d6b5a", style: "bald", extra: "glasses" });
    for (const n of Object.values(NPCS)) this.makeActor(`actor_${n.id}`, n.look);
    g.destroy();
  }

  private makeActor(key: string, look: Look): void {
    if (this.textures.exists(key)) return;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    const c = (s: string) => Phaser.Display.Color.HexStringToColor(s).color;
    const px = (x: number, y: number, col: number, w = 1, h = 1) => g.fillStyle(col).fillRect(x, y, w, h);
    const hair = c(look.hair), skin = c(look.skin), body = c(look.body);
    // 16 x 24: head rows 2-9, body 10-18, legs 19-23
    px(5, 3, skin, 6, 7);
    if (look.style !== "bald") px(4, 2, hair, 8, 3);
    if (look.style === "bun") { px(4, 2, hair, 8, 2); px(10, 1, hair, 3, 3); }
    if (look.style === "long") { px(3, 2, hair, 10, 3); px(3, 5, hair, 2, 6); px(11, 5, hair, 2, 6); }
    if (look.style === "cap") { px(3, 1, body, 10, 3); px(2, 3, body, 4, 1); }
    if (look.style === "hat") { px(3, 2, 0x333333, 10, 2); px(5, 0, 0x333333, 6, 3); }
    if (look.style === "bald") { px(4, 3, hair, 1, 3); px(11, 3, hair, 1, 3); }
    px(6, 5, 0x222222); px(9, 5, 0x222222);
    if (look.extra === "glasses") { px(5, 5, 0x222222, 3, 1); px(8, 5, 0x222222, 3, 1); px(6, 4, 0xffffff, 1, 1); }
    if (look.extra === "moustache") px(6, 8, hair, 4, 1);
    if (look.extra === "beard") px(5, 8, hair, 6, 2);
    px(4, 10, body, 8, 9);
    px(2, 11, body, 2, 5); px(12, 11, body, 2, 5);
    px(2, 16, skin, 2, 1); px(12, 16, skin, 2, 1);
    px(5, 19, 0x2a2a3a, 2, 4); px(9, 19, 0x2a2a3a, 2, 4);
    px(4, 22, 0x1a1a1a, 3, 2); px(9, 22, 0x1a1a1a, 3, 2);
    g.generateTexture(key, 16, 24);
    g.destroy();
  }
}

/** Draw a 32x32 pixel portrait of a look onto a canvas (scaled up by CSS). */
export function drawPortrait(canvas: HTMLCanvasElement, look: Look): void {
  canvas.width = 16; canvas.height = 16;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, 16, 16);
  const px = (x: number, y: number, c: string, w = 1, h = 1) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  px(0, 0, "#000", 16, 16);
  px(4, 4, look.skin, 8, 9);
  if (look.style !== "bald") px(3, 2, look.hair, 10, 4);
  if (look.style === "bun") px(11, 1, look.hair, 4, 4);
  if (look.style === "long") { px(2, 2, look.hair, 12, 4); px(2, 6, look.hair, 2, 8); px(12, 6, look.hair, 2, 8); }
  if (look.style === "hat") { px(2, 3, "#333", 12, 2); px(4, 0, "#333", 8, 4); }
  if (look.style === "bald") { px(3, 5, look.hair, 1, 3); px(12, 5, look.hair, 1, 3); }
  px(6, 7, "#222", 1, 2); px(9, 7, "#222", 1, 2);
  if (look.extra === "glasses") { px(5, 7, "#ddd", 3, 1); px(8, 7, "#ddd", 3, 1); px(5, 8, "#ddd"); px(7, 8, "#ddd"); px(8, 8, "#ddd"); px(10, 8, "#ddd"); }
  if (look.extra === "moustache") px(6, 10, look.hair, 4, 1);
  if (look.extra === "beard") px(5, 11, look.hair, 6, 2);
  px(7, 11, "#a0523d", 2, 1);
  px(3, 13, look.body, 10, 3);
}
