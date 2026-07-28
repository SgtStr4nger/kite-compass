# Kite Compass

Find the best kitesurf destinations **for the month you want to travel**. Kite
Compass ranks spots around the world by wind, conditions and travel vibe, so you
book the right spot at the right time.

Public site: home + search, a ranked results page with a synced list/map, SEO
spot pages, and a methodology page. A private admin area manages spots and
per-month data with a draft/publish workflow.

---

## Tech stack

| Layer     | Choice                                        |
| --------- | --------------------------------------------- |
| Frontend  | React + Vite + Tailwind CSS + shadcn/ui       |
| Backend   | Express (Node.js)                             |
| Database  | SQLite via `better-sqlite3` + Drizzle ORM     |
| Auth      | Email + password, signed bearer tokens (JWT)  |
| Maps      | Leaflet + OpenStreetMap tiles                 |

Everything runs as a **single Node process on one port** — the Express server
serves both the JSON API (`/api/*`) and the built React app.

### A note on Express vs. FastAPI

The original brief suggested a Python/FastAPI backend. This project ships on
**Express (Node.js)** instead. The reason is purely operational: the frontend,
build tooling and preview/deploy pipeline used here are a single-port
Node/Vite stack, so keeping the backend in the same runtime removes a second
language, a second process and a second deploy target. The API surface is a
thin REST layer over the storage interface (`server/storage.ts`), so porting to
FastAPI later — if desired — is mechanical: the routes, request/response shapes
and the SQLite schema all transfer directly.

---

## Project layout

```
kite-compass/
├─ client/src/
│  ├─ pages/            Home, Results, SpotDetail, Methodology, not-found
│  │  └─ admin/         AdminLogin, AdminLayout, AdminSpots, AdminSpotEditor
│  ├─ components/       SiteChrome, SpotCard, SpotMap, Filters, Badges, Logo, ui/
│  └─ lib/              api, auth, queryClient, useHashRoute, filterParams, types
├─ server/
│  ├─ index.ts          Express bootstrap (API + static/Vite), reads PORT/NODE_ENV
│  ├─ routes.ts         All REST routes; draft/publish serialization lives here
│  ├─ storage.ts        IStorage interface + Drizzle implementation (single source of truth)
│  ├─ seed.ts           Idempotent seed from seed_data.json
│  ├─ enrich.ts         CLI to backfill monthly weather data from Open-Meteo (see below)
│  ├─ windProviders.ts  Wind-provider abstraction (Windy/Windfinder stubs — see below)
│  └─ services/
│     ├─ openMeteo.ts   Open-Meteo fetch + per-month aggregation (pure, no DB)
│     └─ enrichment.ts  Orchestration: writes enriched values as drafts, preserves manual data
├─ shared/schema.ts     Drizzle tables + Zod insert schemas (frontend + backend share these)
├─ seed_data.json       78 spots + 162 monthly records
└─ data.db              SQLite database (git-ignored; created on first run/seed)
```

---

## Getting started (local)

```bash
npm install
cp .env.example .env         # then set AUTH_SECRET
npm run seed                 # create + populate data.db (idempotent)
npm run dev                  # http://localhost:5000
```

`npm run dev` runs the API and the Vite dev server on the same port. Open
`http://localhost:5000`, then `http://localhost:5000/#/admin` for the admin area.

### First-run admin setup

There is **no hardcoded admin account**. On first launch, if no admin user
exists, the login screen shows a one-time setup form — create your admin with an
email and password there. (The system is multi-user-ready; additional admins can
be added later via `POST /api/admin/users`.)

---

## Environment variables

| Variable      | Purpose                                                        |
| ------------- | -------------------------------------------------------------- |
| `AUTH_SECRET` | Signs admin auth tokens. **Set a long random value in prod.**  |
| `PORT`        | Port for the combined API + frontend server (default `5000`).  |
| `NODE_ENV`    | `development` (Vite) or `production` (serves built assets).    |

No secrets are hardcoded; the database file and `.env` are git-ignored.

---

## Ranking & draft/publish model

- **Score per spot per month** (0–10) plus a plain-language **season label**
  (peak / good / okay / off). Rankings use a **manual** score today.
- **Ranking mode** (manual vs. automatic) is an **admin-only** setting per spot —
  it is never exposed on the public site.
- **Draft/publish is separate for spots and for monthly records.** Editing saves
  a draft; the public site keeps serving the last *published* snapshot until you
  hit Publish. Admins can preview drafts via `?preview=1` (auth required).
- All wind speeds are shown in **knots**.

---

## Wind providers (stubbed by design)

`server/windProviders.ts` defines a `WindProvider` interface and registers
**Windy** and **Windfinder** stub providers. Per scope, **no real API calls are
made** — `fetchMonthly()` throws "not implemented". The database already has the
fields (`automaticWindScore`, `windSourceName`, `windSourceUrl`) to support a
future automatic score.

Separately, each spot can store `windyUrl` / `windfinderUrl`; the public spot
page renders "check live forecast" buttons **only when a URL exists**. Those are
plain outbound links, not API integrations.

To add a real provider later: implement `fetchMonthly` for one provider, add its
API key as an env var, register it, and enable automatic ranking mode on a spot.

---

## Weather enrichment (Open-Meteo)

Monthly wind and wave metrics can be **backfilled automatically from
[Open-Meteo](https://open-meteo.com)** (free, no API key). Enrichment reads a
spot's coordinates and computes a per-calendar-month climatology from 10 years
of daily history, writing the results as **drafts** for review.

**Data sources**

- **Archive API** (`archive-api.open-meteo.com/v1/archive`) — daily
  `wind_speed_10m_max`, `wind_gusts_10m_max`, `wind_direction_10m_dominant`,
  requested directly in **knots** (`wind_speed_unit=kn`).
- **Marine API** (`marine-api.open-meteo.com/v1/marine`) — daily
  `wave_height_max`, `wave_period_max`, `wave_direction_dominant` in metres.
  Wave data is **best-effort**: inland/lagoon spots with no wave model degrade
  gracefully (wind still applies; a quality note is recorded).

**Aggregation** (per month, across the whole window; config in `server/services/openMeteo.ts`)

| Metric              | Definition                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| `avgWind10mKnots`   | Mean of daily `wind_speed_10m_max`.                                                                    |
| `maxWind10mKnots`   | **Typical strong-day gust** = the `GUST_PERCENTILE` (default **90th**) percentile of daily gusts. This deliberately ignores once-a-decade extremes so the figure reads as "a strong day here", not a freak storm. |
| `windyDaysCount`    | Average days/month where daily max wind ≥ `WINDY_DAY_THRESHOLD_KNOTS` (**18 kn**).                      |
| `avgWaveHeightM`    | Mean of daily `wave_height_max`.                                                                        |
| `avgWavePeriodS`    | Mean of daily `wave_period_max`.                                                                        |
| wave direction      | Circular mean of daily dominant direction.                                                             |

Historical window: **2015–2024** (`HISTORY_START_YEAR` / `HISTORY_END_YEAR`).
Thresholds and the gust percentile are single constants at the top of
`server/services/openMeteo.ts` — change them there.

**Trigger model (Pattern B — manual)**

Enrichment is **never** run automatically on save. It is triggered explicitly:

- **Admin editor** → a **"Refresh weather data"** button (enabled only once the
  spot has coordinates). Calls `POST /api/admin/spots/:id/enrich`.
- **CLI** for bulk backfill:

  ```bash
  npm run enrich -- --all              # every spot with coordinates
  npm run enrich -- --slug kite-prasonisi
  npm run enrich -- --id 15
  npm run enrich -- --all --delay 500  # ms between spots (be nice to the API)
  ```

**Overwrite & safety rules**

- Enrichment **overwrites** the computed wind/wave metrics but **always
  preserves** manual editorial data: `seasonLabel`, `manualScore`,
  `automaticWindScore` and `internalNotes`.
- Results are written as **unpublished drafts**. The public site keeps showing
  the last published snapshot until an admin reviews and publishes each month.
- **Failure-safe:** if the wind fetch fails, nothing is written and existing
  data is left intact. Missing coordinates return `422`; provider errors `502`.

---

## API overview

Public: `GET /api/filters`, `GET /api/spots` (month + tag filters, sorted by
score; each row includes `seasonByMonth`, a 12-entry Jan→Dec season strip),
`GET /api/spots/slug/:slug`, `GET /api/countries`.

Auth: `POST /api/auth/setup`, `GET /api/auth/status`, `POST /api/auth/login`,
`GET /api/auth/me`.

Admin (bearer token): CRUD + publish for `/api/admin/spots[/:id]` and
`/api/admin/monthly[/:id]`, `POST /api/admin/spots/:id/enrich` (Open-Meteo
refresh → drafts), plus `GET /api/admin/filters`.

---

## Production build

```bash
npm run build                              # builds client + bundles server → dist/
NODE_ENV=production node dist/index.cjs    # serves API + frontend on $PORT
```

---

## Deployment

Kite Compass is a single Node process serving one port, so it runs anywhere Node
runs. Target domain: **kite-compass.com**.

### Option A — self-hosted (VPS)

1. Install Node 18+ on the server.
2. Clone the repo, `npm ci`, set `.env` (`AUTH_SECRET`, `NODE_ENV=production`, `PORT`).
3. `npm run build`, then run `node dist/index.cjs` under a process manager
   (systemd or `pm2`) so it restarts on reboot/crash.
4. Put Nginx/Caddy in front for TLS and proxy to the app port.
5. Back up `data.db` regularly (it holds all content + the admin account).

### Option B — Cloudflare

- **DNS/CDN:** point `kite-compass.com` at your origin via Cloudflare (proxied),
  enable "Always Use HTTPS" and caching for static assets under `/assets/*`.
- **Cloudflare Tunnel:** expose the origin without opening ports —
  `cloudflared tunnel` → your local/VPS `node dist/index.cjs`.
- Note: SQLite requires a persistent disk, so the app itself belongs on a
  VPS/container origin (Cloudflare fronts it); it is not a static-only Pages
  deployment.

---

## Data

`seed_data.json` holds 78 spots and 162 monthly records, derived from the source
kitesurf spreadsheet. `npm run seed` is idempotent (upserts by slug) and marks
seeded content published. `data.db` is git-ignored and never committed.
