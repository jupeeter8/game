import Phaser from "phaser";
import { NPCS, type NpcDef } from "../game/npcs";
import { describeState } from "../game/state";

export const TILE = 32;
const COLS = 25;
const ROWS = 19;

// 0 floor, 1 wall, 2 desk, 3 computer (player's desk), 4 plant
const MAP: string[] = [
  "1111111111111111111111111",
  "1000000000000000000000001",
  "1000000000000000000000001",
  "1002220000000000000000001",
  "1002220000000000022200001",
  "1000000000000000022200001",
  "1000000000000000000000001",
  "1000000000111110000000001",
  "1000000000100000000000001",
  "1000000000100000000000001",
  "1000000000100000000000001",
  "1000000000111110000000001",
  "1000000000000000000000001",
  "1022200000000000000000001",
  "1023200000000000000000001",
  "1022200000000000000000001",
  "1000000000000000000000401",
  "1000000000000000000000001",
  "1111111111111111111111111",
];

export class OfficeScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<"W" | "A" | "S" | "D", Phaser.Input.Keyboard.Key>;
  private keyE!: Phaser.Input.Keyboard.Key;
  private npcSprites = new Map<string, Phaser.GameObjects.Sprite>();
  private hint!: Phaser.GameObjects.Text;
  private nearest: { kind: "npc"; npc: NpcDef } | { kind: "desk" } | null = null;
  private inDialogue = false;
  private statePanel = document.getElementById("state-panel")!;

  constructor() {
    super("office");
  }

  create(): void {
    this.makeTextures();

    const walls = this.physics.add.staticGroup();
    let deskPos: { x: number; y: number } | null = null;

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const c = MAP[y][x];
        const px = x * TILE + TILE / 2;
        const py = y * TILE + TILE / 2;
        this.add.image(px, py, (x + y) % 2 ? "floor" : "floor2");
        if (c === "1") walls.create(px, py, "wall");
        else if (c === "2") walls.create(px, py, "desk");
        else if (c === "3") {
          walls.create(px, py, "computer");
          deskPos = { x: px, y: py };
        } else if (c === "4") walls.create(px, py, "plant");
      }
    }

    this.player = this.physics.add.sprite(3 * TILE + TILE / 2, 7 * TILE + TILE / 2, "player");
    this.player.setCollideWorldBounds(true);
    this.player.body!.setSize(20, 20).setOffset(6, 10);
    this.physics.add.collider(this.player, walls);

    for (const npc of Object.values(NPCS)) {
      const key = `npc_${npc.id}`;
      this.makeActorTexture(key, npc.color);
      const s = this.add.sprite(npc.tile.x * TILE + TILE / 2, npc.tile.y * TILE + TILE / 2, key);
      s.setData("baseY", s.y);
      this.npcSprites.set(npc.id, s);
      this.add
        .text(s.x, s.y - 26, npc.name, { fontSize: "11px", fontFamily: "monospace", color: "#fff", backgroundColor: "#00000088", padding: { x: 3, y: 1 } })
        .setOrigin(0.5);
      // NPCs block movement too.
      const blocker = walls.create(s.x, s.y, "npc_block") as Phaser.Physics.Arcade.Sprite;
      blocker.setVisible(false).refreshBody();
    }
    if (deskPos) this.add.text(deskPos.x, deskPos.y - 26, "You", { fontSize: "11px", fontFamily: "monospace", color: "#9cf" }).setOrigin(0.5);

    this.physics.world.setBounds(0, 0, COLS * TILE, ROWS * TILE);
    this.cameras.main.setBounds(0, 0, COLS * TILE, ROWS * TILE).startFollow(this.player, true, 0.15, 0.15);

    const kb = this.input.keyboard!;
    this.cursors = kb.createCursorKeys();
    this.wasd = kb.addKeys("W,A,S,D") as typeof this.wasd;
    this.keyE = kb.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.keyE.on("down", () => this.interact());

    this.hint = this.add.text(0, 0, "", { fontSize: "12px", fontFamily: "monospace", color: "#ffe066", backgroundColor: "#000000aa", padding: { x: 4, y: 2 } }).setOrigin(0.5, 1).setDepth(10);

    this.game.events.on("dialogue:open", () => {
      this.inDialogue = true;
      // Phaser preventDefaults captured keys (WASD/E/Space/arrows) globally, which would eat
      // characters typed into the chat box. Release the capture while the dialogue owns input.
      kb.disableGlobalCapture();
      kb.resetKeys();
    });
    this.game.events.on("dialogue:close", () => {
      this.inDialogue = false;
      kb.enableGlobalCapture();
      this.refreshPanel();
    });
    this.game.events.on("npc:talk", (id: string, on: boolean) => this.setTalking(id, on));
    this.game.events.on("state:changed", () => this.refreshPanel());
    this.refreshPanel();
  }

  update(): void {
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(0);
    if (!this.inDialogue) {
      const speed = 170;
      const left = this.cursors.left.isDown || this.wasd.A.isDown;
      const right = this.cursors.right.isDown || this.wasd.D.isDown;
      const up = this.cursors.up.isDown || this.wasd.W.isDown;
      const down = this.cursors.down.isDown || this.wasd.S.isDown;
      body.setVelocityX(left ? -speed : right ? speed : 0);
      body.setVelocityY(up ? -speed : down ? speed : 0);
      body.velocity.normalize().scale(speed);
    }

    this.findNearest();
    if (import.meta.env.DEV) {
      (window as unknown as { __debug: unknown }).__debug = { player: { x: this.player.x, y: this.player.y }, near: this.nearest?.kind ?? null };
    }
  }

  private interact(): void {
    if (this.inDialogue || !this.nearest) return;
    if (this.nearest.kind === "npc") this.scene.launch("dialogue", { npcId: this.nearest.npc.id });
    else this.scene.launch("dialogue", { desk: true });
  }

  private findNearest(): void {
    let best: typeof this.nearest = null;
    let bestD = 56;
    for (const npc of Object.values(NPCS)) {
      const s = this.npcSprites.get(npc.id)!;
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, s.x, s.y);
      if (d < bestD) {
        bestD = d;
        best = { kind: "npc", npc };
      }
    }
    // Player's desk is the "3" tile.
    const deskX = 3 * TILE + TILE / 2;
    const deskY = 14 * TILE + TILE / 2;
    const dd = Phaser.Math.Distance.Between(this.player.x, this.player.y, deskX, deskY);
    if (dd < bestD) best = { kind: "desk" };

    this.nearest = best;
    if (best && !this.inDialogue) {
      this.hint.setText(best.kind === "npc" ? `E  talk to ${best.npc.name}` : "E  desk work (TODO)");
      this.hint.setPosition(this.player.x, this.player.y - 24).setVisible(true);
    } else {
      this.hint.setVisible(false);
    }
  }

  private setTalking(id: string, on: boolean): void {
    const s = this.npcSprites.get(id);
    if (!s) return;
    this.tweens.killTweensOf(s);
    const baseY = s.getData("baseY") as number;
    if (on) {
      this.tweens.add({ targets: s, y: baseY - 4, duration: 90, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    } else {
      s.y = baseY;
    }
  }

  private refreshPanel(): void {
    this.statePanel.textContent = describeState();
  }

  private makeTextures(): void {
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    const rect = (key: string, fill: number, border?: number) => {
      g.clear();
      g.fillStyle(fill).fillRect(0, 0, TILE, TILE);
      if (border !== undefined) g.lineStyle(2, border).strokeRect(1, 1, TILE - 2, TILE - 2);
      g.generateTexture(key, TILE, TILE);
    };
    rect("floor", 0x2b2f3a);
    rect("floor2", 0x2e323e);
    rect("wall", 0x4a5068, 0x383c4c);
    rect("desk", 0x8d6e63, 0x5d4037);
    rect("plant", 0x2e7d32, 0x1b5e20);
    g.clear();
    g.fillStyle(0x8d6e63).fillRect(0, 0, TILE, TILE);
    g.fillStyle(0x263238).fillRect(6, 4, 20, 14);
    g.fillStyle(0x4fc3f7).fillRect(8, 6, 16, 10);
    g.generateTexture("computer", TILE, TILE);
    g.clear();
    g.fillStyle(0x000000, 0).fillRect(0, 0, TILE, TILE);
    g.generateTexture("npc_block", TILE, TILE);
    this.makeActorTexture("player", 0x5b8def);
    g.destroy();
  }

  private makeActorTexture(key: string, color: number): void {
    if (this.textures.exists(key)) return;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(color).fillRoundedRect(6, 10, 20, 20, 4); // body
    g.fillStyle(0xffe0b2).fillCircle(16, 9, 7); // head
    g.fillStyle(0x222222).fillRect(13, 7, 2, 2).fillRect(18, 7, 2, 2); // eyes
    g.generateTexture(key, TILE, TILE);
    g.destroy();
  }
}
