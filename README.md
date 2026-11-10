# hakkurei.com

A personal, Touhou-themed fan site styled as an early-2000s Japanese personal homepage — complete with a fake retro browser window, background music, a guestbook with an interactive offering box, and a dedicated error-page soundtrack.

**Live:** [https://hakkurei.com](https://hakkurei.com)

---

## Overview

The site presents a curated personal portfolio, guestbook, link directory, and credits page, all wrapped in a hand-built recreation of a period-correct Japanese web browser. Every page ships prerendered static HTML; only the interactive surfaces (guestbook, admin panel, JSON APIs) run server-side through the Node adapter.

Touhou Project and all its characters are © ZUN / Team Shanghai Alice. This is a fan-made, non-profit project with no affiliation.

## Features

### Presentation

- **Retro browser chrome** — a hand-built 2002-era Japanese browser frame (menu bar, address bar with per-page tab labels, status bar with marquee) wrapping every page, styled with period-accurate fonts and hard-shadow CSS.
- **Dynamic soundtrack** — a random track from the *Embodiment of Scarlet Devil* OST plays on entry, with per-track color palettes and background artwork that crossfade together when the track rotates. A persisted Now Playing mini window mirrors the current track across navigations.
- **Loading screen** — a physics-based hanging shrine sign; cutting its ropes plays a rope-cut sound and drops the curtain into the page.
- **Ambient life** — falling petal particles, an animated retro cursor set, and an occasional witch flyby crossing the screen at a randomized altitude.

### Interactive systems

- **Guestbook** — SQLite-backed entries with per-IP rate limiting, a whitelist of allowed avatars, and speech-bubble reactions. The offering box (*saisenbako*) accepts canvas-driven coin physics; each coin POSTs to a rate-limited endpoint that increments a persistent donation counter.
- **Error pages** — a dedicated 404 experience with a mascot, randomized dialogue, its own two-track soundtrack, color palette, and background; prerendered and served by middleware with the correct HTTP status for any unmatched route.
- **Project grid** — public repositories are auto-discovered from the GitHub API, filtered to repositories authored by the owner, ranked by stars with commits as a tiebreaker, and capped at the top four. Results are refreshed at most once per day and served from a server-side file cache backed by an in-memory memo; static fallback cards ship for visitors without JavaScript.
- **Admin panel** — session-authenticated entry management (delete, mood switching) with timing-safe credential comparison, HttpOnly session cookies, and brute-force quota on login.
- **Site-wide SFX** — a delegated click layer attaches UI sounds to every interactive element (confirm on click, a distinct sound on donations, mute/unmute pair on the music toggle), rendered through a small Web Audio envelope and surviving View Transition DOM swaps.

## Tech stack

| Layer | Choice |
| :--- | :--- |
| Framework | [Astro](https://astro.build) 7 — static-first, selective SSR |
| Language | TypeScript |
| Server | `@astrojs/node` standalone adapter (Node 22) |
| Database | SQLite via `better-sqlite3` (WAL mode) |
| Styling | Hand-written CSS — custom properties, per-song palette blocks, scoped components |
| Container | Multi-stage Docker build on `node:22-alpine`, non-root runtime via `su-exec` |
| Delivery | Served behind a Cloudflare Tunnel |

## Architecture notes

- **Rendering model** — every page is prerendered at build time; `guestbook`, `admin`, and all API routes opt out with `export const prerender = false`. A server middleware wraps on-demand rendering: API errors keep their JSON contracts, and any other unexpected error is rewritten to the prerendered 404 with the original status preserved.
- **Route-scoped soundtracks** — the BGM manifest (`public/music/songs.json`) supports an optional `route` field. The error page declares itself through an `errorPool` prop instead of URL matching, so the correct soundtrack is baked under any rendering path (dev on-demand, prerender, or middleware rewrite). A reconciliation pass on `astro:page-load` crossfades track, palette, and background whenever the active song does not belong to the incoming page's pool.
- **View Transition conventions** — all client scripts are inline and idempotent, guarded by `window._*` flags, and re-bind through `astro:page-load` listeners so state survives ClientRouter DOM swaps.
- **GitHub stats pipeline** — repository discovery, owner-authored commit counts (via the pagination `Link` header), ranking, and capping run server-side at most once per 24 hours; the result is persisted to `data/github-stats.json` and served from memory afterward. A failed refresh serves the previous file rather than a partial payload.
- **Security posture** — all SQL is parameterized; client input is validated before rate limits are spent; `TRUST_PROXY` governs whether `X-Forwarded-For` is honored for client IPs; secrets are read from the environment at runtime only and never bundled.

## Project structure

```text
/
├── public/
│   ├── backgrounds/        # per-track background artwork (WebP)
│   ├── cursors/            # animated retro cursor set
│   ├── fonts/              # self-hosted display fonts
│   ├── images/             # avatars, badges, sprites (served as-is)
│   ├── music/              # OST tracks + songs.json manifest
│   ├── sfx/                # normalized UI sounds (Ogg Vorbis)
│   └── ...                 # particles, 88x31 badges, wallpapers
├── src/
│   ├── assets/             # build-time processed images (astro:assets)
│   ├── components/
│   │   ├── guestbook/      # guestbook form, entries, offering box
│   │   ├── layout/         # BGM, loading screen, petals, mini window, nav
│   │   └── links/          # link directory portals
│   ├── layouts/            # single global layout (browser chrome, nav, footer)
│   ├── lib/                # server-only logic: db, admin sessions, client IP
│   ├── pages/
│   │   ├── api/            # JSON endpoints (guestbook, donations, stats, admin)
│   │   ├── admin/          # session-gated management panel
│   │   └── ...             # prerendered pages: home, projects, links, credits, 404
│   ├── styles/             # global tokens, browser chrome, per-song palettes
│   └── middleware.ts       # on-demand error handling
├── data/                   # runtime volume: SQLite DB, daily stats cache (gitignored)
├── Dockerfile              # multi-stage build, non-root entrypoint
├── docker-compose.yml      # volume + environment wiring
└── entrypoint.sh           # repairs bind-mount ownership, drops to non-root
```

## Getting started

Prerequisites: Node.js 22+ and npm.

```sh
npm install
npm run dev        # dev server at http://localhost:4321
npm run build      # production build to ./dist
npm run preview    # preview the production build
```

### Environment variables

Define these in a `.env` file next to `docker-compose.yml` — compose reads it automatically and passes the values into the container. `ADMIN_PASSWORD_HASH` and `GITHUB_TOKEN` live there; no password or token is ever hardcoded in the repository.

| Variable | Required | Description |
| :--- | :--- | :--- |
| `ADMIN_PASSWORD_HASH` | Yes | SHA-256 hex hash of the admin panel password (`echo -n 'your password' \| sha256sum`). Without it the admin auth fails closed — no login is possible. |
| `GITHUB_TOKEN` | No | GitHub personal access token (no scopes needed for public repositories). Raises the API quota from 60 to 5,000 requests/hour for the project stats refresh. |
| `TRUST_PROXY` | No | Set when running behind a trusted reverse proxy so client IPs are taken from `X-Forwarded-For` (used by all rate limiting). |
| `HOST` / `PORT` | No | Bind address and port for the standalone server (defaults `0.0.0.0:4321`). |

## Docker deployment

The image builds in two stages: dependencies and toolchain (Python, make, g++ for `better-sqlite3` on musl) in the builder, then a slim runtime with dev dependencies pruned and a non-root `node` user.

```sh
docker compose up -d --build
```

- The entrypoint starts as root only to repair ownership of a possibly root-owned bind mount at `/app/data`, then drops to `node` via `su-exec` for the server process.
- Mount a volume at `/app/data` to persist the SQLite database and the daily GitHub stats cache across restarts.
- The site is delivered through a Cloudflare Tunnel; no inbound ports are required beyond the tunnel itself.

After deploying a changed stats pipeline, delete `data/github-stats.json` once so the first visitor triggers a fresh refresh instead of serving the previous day's cache.

## Credits and legal

- **Touhou Project**, its characters, and the *Embodiment of Scarlet Devil* OST are © ZUN / Team Shanghai Alice. This is a fan-made, non-profit website.
- The display font (DFPPOPCorn-W12) is a commercial typeface by DynaComware, self-hosted for display purposes only — review its license terms before redistributing this repository.
- In-game sprites and additional sound effects originate from Touhou Hisoutensoku, Deltarune, and ULTRAKILL; their respective rights holders are credited on the in-site [credits page](https://hakkurei.com/credits).

## License

The source code is released under the [MIT License](LICENSE).

The license covers the code only. Bundled media — Touhou music and artwork, the DynaComware display font, in-game sprites, and third-party sound effects — remains the property of its respective owners, is included solely as fan-made, non-profit use, and is explicitly excluded from redistribution rights. Anyone reusing this repository's code must obtain those assets independently and comply with their own terms.
