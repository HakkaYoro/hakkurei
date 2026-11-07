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

No test runner, no linter. `tsconfig.json` extends `astro/tsconfigs/strict`. Node >= 22.23.4.

## Architecture

Touhou-themed personal portfolio / shrine site. Astro 7 in **SSR mode** via `@astrojs/node` (`mode: 'standalone'`, `astro.config.mjs`) — the server ships as `./dist/server/entry.mjs` and is run directly by Node (`Dockerfile`). There is **no UI framework** (no React/Vue/Svelte): pages are `.astro` files and all interactivity is hand-written vanilla JS inside `<script is:inline>` blocks.

### The database is SQLite (data/hakkurei.db)

This is the central architectural choice. `src/lib/db.ts` persists all state in a single SQLite database at `data/hakkurei.db` via **better-sqlite3** (synchronous API, WAL mode):

- `entries` — guestbook entries (seeded with hardcoded Touhou-character comments on first run; each `addGuestbookEntry` prunes the table to the 500 most recent rows)
- `donations_totals` — single-row running donation total
- `rate_limits` — shared rate-limit counters, keyed by bucket (`d:YYYY-MM-DD` daily, `m:YYYY-MM-DDTHH:MM` per-minute) + scope (`guestbook`, `donations`, `admin-login`) + key (IP or `__global__`)

**First-boot migration:** if the `.db` file does not exist but the legacy JSON files (`data/guestbook.json`, `data/donations.json`, `data/guestbook_limits.json`) are present, they are imported as-is; otherwise the seed data (5 character entries, 105-yen total) is written. `public/messages.json`, `public/mood.json` and `public/music/songs.json` are static content, NOT database — mood.json is rewritten only by the admin panel.

`data/` is **gitignored** and created at runtime — the repo never holds live data. In production it lives in a Docker named volume mounted at `/app/data` (`docker-compose.yml`) so donations/guestbook survive image rebuilds. Every read/write funnels through the exported functions in `db.ts`; do not touch the database directly from endpoints. better-sqlite3 ships prebuilt binaries for glibc and musl (no build toolchain needed in the alpine image).

**Atomicity caveat** (see the comment in `db.ts`): better-sqlite3 is synchronous, so statements are serialized per connection, but the app still assumes a **single Node process**. If this ever runs behind more than one process/replica, move to a client-server DB.

### Admin panel (/admin)

Password-only admin at `/admin` (not linked anywhere — direct URL). `POST /api/admin/auth` compares SHA-256 hex of the posted password against a hardcoded hash (override with `ADMIN_PASSWORD_HASH` env, same format) and caps the body at 4KB (413 before parsing, same as the guestbook POST). Sessions are in-memory token cookies (`admin_session`, HttpOnly, SameSite=Strict, `Secure` only when the request arrives over TLS — direct https, or the proxy-appended `x-forwarded-proto` entry when `TRUST_PROXY` is set; TTL 1h) — a restart logs admins out. Login attempts are rate-limited to 5/min/IP through the shared `rate_limits` table. Authenticated endpoints: `PATCH /api/admin/mood` (rewrites `public/mood.json`), `GET /api/admin/entries`, `DELETE /api/admin/entries/:id`, `POST /api/admin/logout` — all return 401 without a valid cookie.

### Hybrid rendering

Pages default to static. Anything that must read live state opts out with `export const prerender = false;` — currently the `/guestbook` and `/admin` pages and all API routes. The public API routes are in `src/pages/api/`:

- `GET /api/guestbook` → entry list; `POST /api/guestbook` → validate + append (name ≤30, message ≤500, avatar allowlisted server-side)
- `POST /api/donations` → +5 yen with rate-limit check (the box POST reads the total from the response; there is no GET route)

The admin API lives in `src/pages/api/admin/` (see the admin section below). The guestbook POST sends JSON with a **4KB Content-Length cap** (413 before parsing); both POST handlers extract the client IP **proxy-aware**: with `TRUST_PROXY` set, the **last** `x-forwarded-for` entry (the one the trusted proxy appended; client-supplied entries come first and are spoofable), otherwise `clientAddress` (correct behind the reverse proxy / TrueNAS setup). Rate limits: donations 50/IP + 1000 global per day; guestbook 5/IP + 50 global per day — enforced in `db.ts` (`checkGuestbookLimit`, `incrementDonations`), not in the routes.

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

Theme tokens are CSS custom properties in `:root` inside `src/styles/global.css` (`--reimu-red`, `--magenta`, `--bg`, `--surface`, `--font-sans`, etc.). Pages embed component styles in scoped `<style is:global>` blocks. The display font (`DFPPOPCorn-W12`, a DynaComware commercial typeface) is self-hosted in `public/fonts/` and served from `/fonts/` via `@font-face` in `global.css`. Cursors, music, particles, and `messages.json` (marquee lines) all live in `public/`.

## Deployment

Container built by `Dockerfile` (node:22-alpine), runs as the non-root `node` user, exposes `PORT`/`HOST` env (default `0.0.0.0:4321`). Target is TrueNAS Scale as a "Custom App" or via `docker compose`. The `hakkurei-data` volume at `/app/data` is the only persistent state — everything else is ephemeral in the image.
