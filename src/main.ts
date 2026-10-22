import Phaser from "phaser";
import { OfficeScene } from "./scenes/OfficeScene";
import { DialogueScene } from "./scenes/DialogueScene";
import { pickBackend } from "./llm";
import { pickStt } from "./voice";

async function boot(): Promise<void> {
  const loading = document.getElementById("loading")!;
  const fill = loading.querySelector<HTMLDivElement>(".fill")!;
  const text = loading.querySelector<HTMLDivElement>(".text")!;

  const backend = await pickBackend();
  document.getElementById("backend-name")!.textContent = backend.name;

  if (backend.name !== "mock") loading.classList.add("visible");
  try {
    await backend.init((pct, msg) => {
      fill.style.width = `${Math.round(pct * 100)}%`;
      text.textContent = msg;
    });
  } catch (e) {
    text.textContent = `Model failed to load: ${(e as Error).message}. Reload with ?llm=mock`;
    throw e;
  }
  const stt = await pickStt();
  document.getElementById("stt-name")!.textContent = stt.name;
  if (stt.available()) {
    loading.classList.add("visible");
    loading.querySelector("strong")!.textContent = "Loading speech model";
    try {
      await stt.init((pct, msg) => {
        fill.style.width = `${Math.round(pct * 100)}%`;
        text.textContent = msg;
      });
    } catch (e) {
      console.error("speech model failed to load; typing still works", e);
    }
  }
  loading.classList.remove("visible");

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "app",
    width: 800,
    height: 600,
    backgroundColor: "#0f1115",
    pixelArt: true,
    physics: { default: "arcade", arcade: { debug: false } },
    scene: [OfficeScene, DialogueScene],
  });
  game.registry.set("backend", backend);
  game.registry.set("stt", stt);
}

void boot();
