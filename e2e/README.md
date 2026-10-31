# Real-model test harness

`driver.mjs` owns one browser session with the real in-browser model (WebGPU, headed Chromium or Brave,
persistent profile so the model downloads once) and exposes it on `http://localhost:5199` so a tester
can talk to NPCs one line at a time and read the engine's full turn report.

```sh
npm run dev                                   # in another terminal
node e2e/driver.mjs --model=3b                # 3b | 7b | 8b | phi | mock ; add --headless=1 for mock only
curl -s localhost:5199/state | jq .phase
curl -s -XPOST localhost:5199/open -d '{"npc":"pugh"}'
curl -s -XPOST localhost:5199/say  -d '{"line":"what was the row about, Captain?"}' | jq '{reply, tone:.report.output.tone, topic:.report.output.topic, voiced:.report.voiced, violations:.report.violations, leaks:.report.leaks}'
curl -s -XPOST localhost:5199/tape -d '{"note":"captain says harrowgate want to buy the place"}'
curl -s -XPOST localhost:5199/op   -d '{"op":"beginDay","day":1}'
curl -s -XPOST localhost:5199/close
```

Fake microphone: make a WAV with `sh e2e/mkwav.sh "Hello grandmother" e2e/wav/hello.wav`, start the
driver with `--mic=e2e/wav/hello.wav`, open a conversation, then `POST /mic {"key":"talk","seconds":4}`.
The reply tells you what transcript reached the game (after the name fixer). One WAV per driver launch.

Every call is logged to `e2e/out/<model>/<run>.jsonl` (turns include the full system prompt and raw model
output). Profiles live in `e2e/.profile/<model>`; delete one to force a re-download.

## Player facade (for naive-player runs)

`/player/state`, `/player/open {npc}`, `/player/say {line}` → `{reply, worthTaping, theyLeft, mood}`,
`/player/tape {note}` → `{recorded, filedUnder, said}`, `/player/close`, `/player/look`,
`/player/activity {id}` (plays a minigame as won; costs its minutes), `/player/bed`, `/player/accuse {npc|null}`.
These return only what the screen shows: no clue ids, flags, pool or prompts. Give a tester nothing else
and you have a player who does not know the story.
