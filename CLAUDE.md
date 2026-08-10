# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
npm run dev        # dev server at localhost:4321
npm run build      # SSR build -> ./dist/
npm run preview    # preview the built server
npm run astro check         # type-check .astro + .ts (no dedicated script; @astrojs/check is installed)
docker compose up -d --build   # production container, port 4321
```

No test runner, no linter. `tsconfig.json` extends `astro/tsconfigs/strict`. Node >= 22.12.

## Architecture

Touhou-themed personal portfolio / shrine site. Astro 6 in **SSR mode** via `@astrojs/node` (`mode: 'standalone'`, `astro.config.mjs`) — the server ships as `./dist/server/entry.mjs` and is run directly by Node (`Dockerfile`). There is **no UI framework** (no React/Vue/Svelte): pages are `.astro` files and all interactivity is hand-written vanilla JS inside `<script is:inline>` blocks.

### The database is JSON files (not a real DB)

This is the central architectural choice. `src/lib/db.ts` persists all state as plain JSON under `data/` using synchronous `node:fs`:

- `data/guestbook.json` — entries (seeded with hardcoded Touhou-character comments on first run via `ensureFilesExist()`)
- `data/donations.json` — running donation total + per-day/IP counters
- `data/guestbook_limits.json` — rate-limit counters

`data/` is **gitignored** and created at runtime — the repo never holds live data. In production it lives in a Docker named volume mounted at `/app/data` (`docker-compose.yml`) so donations/guestbook survive image rebuilds. Every read/write funnels through the exported functions in `db.ts`; do not touch the files directly from endpoints.

**Atomicity caveat** (see the `ponytail:` comment in `db.ts`): the read-modify-write pattern is only accidentally atomic because the whole app runs in a single Node process. There is no locking. If this ever runs behind more than one process/replica, add locking.

### Hybrid rendering

Pages default to static. Anything that must read live state opts out with `export const prerender = false;` — currently the `/guestbook` page and both API routes. The API routes are in `src/pages/api/`:

- `GET /api/guestbook` → entry list; `POST /api/guestbook` → validate + append (name ≤30, message ≤500, avatar allowlisted server-side)
- `GET /api/donations` → `{ total }`; `POST /api/donations` → +5 yen with rate-limit check

Both POST handlers extract the client IP **proxy-aware**: `x-forwarded-for` first hop, falling back to `clientAddress` (correct behind the reverse proxy / TrueNAS setup). Rate limits: donations 50/IP + 1000 global per day; guestbook 5/IP + 50 global per day, tracked in `guestbook_limits.json`. Limits are enforced in `db.ts` (`checkGuestbookLimit`, `incrementDonations`), not in the routes.

The donation box POST sends an **empty body** and reads JSON — it uses `request.json()`, not `.formData()`. There is intentionally no CSRF guard on these public, rate-limited, +5-yen endpoints.

### View Transitions constrain how scripts are written

`Layout.astro` mounts `<ClientRouter />` (View Transitions). This is why nearly all client scripts are `<script is:inline>` rather than bundled: inline scripts survive the head/DOM swap and are not re-executed, while bundled module scripts would re-run on every navigation. State that must survive navigations is guarded with one-shot `window.*` flags:

- `window._bgmInitialized` (random BGM track from `/public/music/*.ogg`, fade crossfading)
- `window._cursorAnimInit` (animated cursor: injects a `<style>` that swaps `/cursors/*_frames/*.png` every 96ms, re-attached if a transition removed it)
- `window._loadingScreenSwapHooked` + `astro:before-swap` (the first-visit loading screen is removed from the incoming document before swap so it never re-shows)

The `<audio id="bgm">` element uses `transition:persist` so playback continues across page loads.

The first-visit loading screen (`#loading-screen`) is a sizable piece of vanilla JS: a 2D rigid-body simulation of a hanging shrine sign on two cords (springs, damping, gusty wind, cuttable ropes). The guestbook donation box runs its own canvas coin/spark physics + Web Audio synth (coin/chime/buzzer). Both are pure client-side and read state only through the two API endpoints above.

### Styling

The whole site leans hard into a **Neocities / early-2000s web aesthetic**, filtered through **Touhou Project** (the shrine, characters, music, spell cards, Gensokyo flavor). Anime/toho retro is the dominant lens — copy, art assets, sounds, and the loading-screen/cursor gimmicks all serve that tone, not a "modern minimal" look. When adding UI, match the busy nostalgic vibe (border styles, red/magenta palette, Japanese + emoji flavor text) rather than flattening it into a generic modern design.

Theme tokens are CSS custom properties in `:root` inside `src/styles/global.css` (`--reimu-red`, `--magenta`, `--bg`, `--surface`, `--font-sans`, etc.). Pages embed component styles in scoped `<style is:global>` blocks. The display font (`DFPPOPCorn-W12`) is loaded from an external CDN in `global.css`. Cursors, music, particles, and `messages.json` (marquee lines) all live in `public/`.

## Deployment

Container built by `Dockerfile` (node:22-alpine), runs as the non-root `node` user, exposes `PORT`/`HOST` env (default `0.0.0.0:4321`). Target is TrueNAS Scale as a "Custom App" or via `docker compose`. The `hakkurei-data` volume at `/app/data` is the only persistent state — everything else is ephemeral in the image.
