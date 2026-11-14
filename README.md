# Stempel Rush

Multiplayer browser race through a Munich immigration office. Grab all 5 stamps
(Anmeldung, Meldebescheinigung, Krankenkasse, Steuer-ID, Fingerabdruck), dodge the
patrolling clerks, and reach the *Aufenthaltstitel* counter before the office closes.

Built at Game Jam Munich (14 November 2026).

- **3D models:** Meshy (text-to-3D, auto-rigging, walk/run animations)
- **Voices, SFX, music:** ElevenLabs
- **Engine:** Three.js + Vite
- **Realtime server:** Cloudflare Workers + Durable Objects (one room per `?room=` code)

## Play

- Live: https://stempel-rush.dalliagac.workers.dev
- Same room for everyone: `/?room=MUC` (default)
- Big screen / projector view with QR code: `/?host=1`
- Controls: WASD / arrow keys, on phones drag anywhere

## Develop

```bash
npm install
npm run build          # builds the client into dist/
npx wrangler dev       # local server with rooms on http://localhost:8787
npm run deploy         # build + deploy to Cloudflare
```

`npm run dev` runs Vite on :5173 and proxies `/ws` to a running `wrangler dev`.

## Assets

- `tools/meshy.mjs` — generate a model: `node tools/meshy.mjs gen <name> "<prompt>" [--rig]`
  (reads `MESHY_API_KEY` from the environment; never commit keys)
- `tools/optimize.mjs` — shrinks raw Meshy GLBs from `assets-src/models-raw/` into `public/models/`
- `assets-log/` — Meshy task ids and prompts for every model
