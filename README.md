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

- itch.io: https://batudlgc.itch.io/stempel-rush
- Live (direct, best on phones): https://stempel-rush.dalliagac.workers.dev
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

### itch.io build

The build uses relative paths, so `dist/` works from any subfolder. When the game is not
served by the Worker (e.g. inside itch.io), it connects to the Worker's `/ws` directly.

```bash
npm run build && (cd dist && zip -qr ../release/stempel-rush-itch.zip .)
```

Upload `release/stempel-rush-itch.zip` on the itch.io edit page and tick "played in the browser".

## Assets

- `tools/meshy.mjs` — generate a model: `node tools/meshy.mjs gen <name> "<prompt>" [--rig]`
  (reads `MESHY_API_KEY` from the environment; never commit keys)
- `tools/optimize.mjs` — shrinks raw Meshy GLBs from `assets-src/models-raw/` into `public/models/`
- `assets-log/` — Meshy task ids and prompts for every model
