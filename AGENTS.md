# AGENTS.md

## Cursor Cloud specific instructions

Aurisar is an RPG-powered fitness tracker: a React 19 + Vite single-page app
(`aurisar-app`) deployed on Netlify. The core product is the fitness tracker
(log workouts/exercises, earn XP, level up, quests, leaderboards, trends). A
secondary "World" feature (`src/features/world/`) is a Babylon.js 3D/2D
multiplayer world backed by SpacetimeDB.

### Services and how to run them

The only service you must start locally for the core product is the Vite dev
server. Backends default to hosted/managed services (see below), so no local
database or auth stack is required.

| Service | Required? | Command | Notes |
|---|---|---|---|
| Vite dev server (the app) | Required | `npm run dev` | Port `5173`, `strictPort` (fixed). `predev` auto-runs `sync:terrain-assets`. |
| Supabase (auth + data) | Remote by default | none | `src/utils/supabase.js` has a hardcoded live project URL + anon key, so login/data work with zero setup. Override with `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`. |
| SpacetimeDB (World multiplayer) | Optional | none (uses remote maincloud) | Client bindings are committed; the World renders against `wss://maincloud.spacetimedb.com`. Only needed locally to modify/publish the module in `spacetimedb/`, which requires the external `spacetime` CLI (not installed by default). |
| Netlify Functions (`/api/*`) | Optional | `netlify dev` | Powers admin panel, WHOOP OAuth, Resend emails, GitHub issue creation. Needs the Netlify CLI + function secrets. Core logging/XP/leaderboards do not need these. |

### Testing the core product without real credentials

Use dev **Preview Mode** to test the fitness tracker end-to-end without signing
up: on the login screen click "Preview Mode" and enter the dev PIN `1234`
(overridable via `VITE_PREVIEW_PIN`). This loads a demo account with sample
data so you can build/log a one-off workout and see XP gained. Preview Mode is
dev-only (`import.meta.env.DEV`) unless `VITE_ALLOW_PREVIEW=true` at build time.

### Lint / test / build

Standard scripts live in `package.json`. Non-obvious notes:

- `npm run lint` currently reports many pre-existing errors on `main` and is
  **not** run by CI — do not treat a red lint run as a regression you caused.
- CI (`.github/workflows/ci.yml`) gates on the freshness/determinism checks
  (`sync:content:check`, `emit:*:check`, `check:assets`, `vendor:meshopt:check`,
  `check:audio`, `verify:worldgen`), then `npm test` (Vitest) and `npm run build`.
  If you touch world/asset/content generators, run the matching `*:check` script
  and regenerate committed outputs, or CI will fail on drift.
- `npm run build` can be memory-hungry; CI sets `NODE_OPTIONS=--max-old-space-size=4096`.
- `.npmrc` sets `legacy-peer-deps=true` (required so `eslint-plugin-jsx-a11y`
  installs against ESLint 10). Keep it; `npm install` relies on it.
