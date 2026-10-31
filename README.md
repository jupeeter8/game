# Murder at Willowmere

A 2-3 hour voice-driven murder mystery set in a retirement home. Walk the house, talk to the residents with
your voice (or keyboard), and record what they tell you on your late father's tape recorder. The residents
are played by a language model running entirely in your browser; your speech is transcribed locally by
Whisper. Nothing leaves the machine. The story bible is `docs/mystery-design.md`.

```sh
npm install && npm run dev
# http://localhost:5173/              real model in the browser (~2.5 GB download once, needs WebGPU)
# http://localhost:5173/?llm=mock     scripted keyword replies, instant (tests, quick checks)
# add &model=8b (Llama 3.1 8B, ~5 GB) or &model=7b (Qwen 7B) for better character voice on a 16 GB machine
# add &reset=1 to start a fresh game (otherwise a refresh resumes the saved one)
```

Without WebGPU the game falls back to the scripted replies.

## Controls

WASD / arrows to walk, E to interact, hold **SPACE** to talk, hold **R** to speak into the tape, Esc to
leave. Nothing counts until it is on the tape. The conversation clock pauses while the model or Whisper is
working.

## Code

- `src/mystery/` is the engine: `content.ts` (cast, ~41 clues, derived proofs, scenes), `state.ts` (mood /
  patience / bond per NPC, the tape, days and minutes), `engine.ts` (prompt, schema, validation, apply),
  `recorder.ts` (matches a spoken note to a voiced clue; never to anything else), `events.ts` (days,
  chandelier, engineer, wheelchair, outcomes), `graph.ts` (the clue/flag dependency graph, used by the
  content-integrity tests).
- `src/play/` is the page: a Phaser pixel-art scene of the house (`scene.ts`, all textures generated at
  runtime, no asset files), an Undertale-style dialogue box with portraits and per-character beeps,
  push-to-talk, the tape, and the five minigames.
- `src/llm/` is the WebLLM backend (one fixed JSON schema, run in a worker); `src/voice/` is Whisper via
  transformers.js; `src/audio/beeps.ts` is the per-character typing beeps.
- Everything numeric is in `src/mystery/tuning.ts`. `npm test` runs the engine tests.
- Prompts are progressive: clues, persona lines and the NPC's situation switch on by phase (party, day 1,
  evening, day 2) and by taped flags, so an NPC never carries text it should not know yet. See
  `docs/mystery-design.md`, "Progressive prompts".
- `e2e/` drives the real model in a headed browser over a small HTTP API (`e2e/README.md`).

## Deploy

It is a static Vite site: `npm run build` produces `dist/`. On Vercel the Vite preset needs no config;
`.vercelignore` keeps `e2e/` (the browser profile is several GB), tests and docs out of the upload.
