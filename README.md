# Corporate Ladder (prototype)

2D office game. Walk around, talk to coworkers with your voice (or keyboard), and let an in-browser LLM play the NPCs.
Think Undertale branching + Stardew relationships + Papers Please desk work (desk work not built yet).

## Run

```sh
npm install
npm run dev
```

Open http://localhost:5173 . Defaults to the **mock** backend (keyword-driven, instant, no download) so the loop is playable immediately.

- `?llm=mock`   – scripted NPC replies, good for testing game logic.
- `?llm=webllm` – real model in the browser via WebGPU. First load downloads ~2.5 GB (cached after). Needs Chrome/Edge/Brave desktop or recent Safari with WebGPU and a GPU with ~3 GB free VRAM. Falls back to mock if WebGPU is missing.

Speech-to-text runs locally too:

- default (`?stt=whisper`) – Whisper base.en via transformers.js, in a Web Worker. WebGPU when an adapter exists, WASM otherwise. Downloads ~80 MB (WASM, q8) or ~200 MB (WebGPU, fp32 encoder + q4 decoder) once. Works in Brave, Firefox, Safari, Chrome. Transcribes after you release the key: ~0.5 s on GPU, 2–3 s on WASM.
- `?stt=web` – the browser's Web Speech API. Zero download, but it sends audio to Google and only works in Chrome/Edge. Brave ships the API without a backend, so it ends sessions immediately there.

## Controls

| Key | Action |
|---|---|
| WASD / arrows | move |
| E | talk to nearby NPC / use desk |
| hold SPACE | push-to-talk (release to send) |
| type + Enter | text fallback |
| Esc | leave conversation |

Mic permission is requested when you open a conversation. Hold SPACE or tap it to toggle; release / tap again / Enter to send. A clip under 0.4 s or near-silent is dropped with "didn't catch that".

## How a conversation turn works

1. `src/llm/prompt.ts` builds a short system prompt from the NPC definition plus only the slice of game state that NPC cares about.
2. The backend (`src/llm/webllm.ts` or `src/llm/mock.ts`) returns JSON constrained to a schema: `reply`, `mood`, `flags_set`, `quest_offer`.
3. `src/llm/validate.ts` rejects anything off-schema or not in the NPC's allowed flag/quest lists. One retry, then a canned fallback line.
4. `src/llm/talk.ts` applies the deltas to `src/game/state.ts`. The model proposes; code decides.

NPC text is typed out with per-character beeps (Web Audio oscillators, different waveform/pitch per NPC) while the sprite bobs. No speech synthesis.

## Content

NPCs live in `src/game/npcs.ts`. Each has persona bullets, secrets with reveal conditions, flags they react to, and quests they can offer. The two shipped NPCs form the smallest loop that shows the mechanic:

- **Priya** reveals that Raj loves badminton once you've been friendly and ask how to win him over.
- **Raj** gives strangers boring doc work, but if you mention badminton he offers the CI quest instead.

## Swap the models

- LLM: `MODEL_ID` in `src/llm/webllm.ts`. Any entry from `prebuiltAppConfig.model_list` in `@mlc-ai/web-llm` works; 3–4B q4f16 instruct models are the sweet spot.
- STT: `WHISPER_MODEL_ID` in `src/voice/whisper.ts`. `onnx-community/whisper-tiny.en` is smaller and faster but mangles names more.

## Not built yet

- Desk work minigame (the "You" desk just shows a placeholder).
- Art, tilemaps, animations beyond placeholder rectangles.
