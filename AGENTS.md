# AGENTS.md

Kite Compass: kitesurf destination ranking site (React + Vite + Tailwind/shadcn on the client, Express + better-sqlite3 + Drizzle on the server). Runs as a **single Node process on one port (5000)** — Express serves both `/api/*` and the built React app.

## Commands

- `npm run dev` — API + Vite dev server on `http://localhost:5000` (`tsx server/index.ts`).
- `npm run check` — typecheck (`tsc --noEmit`). This is the primary validation; run it after changes.
- `npm run build` — production build: Vite client → `dist/public`, esbuild bundles server → `dist/index.cjs`. Run this too before finishing.
- `npm run start` — serve the built app (`NODE_ENV=production node dist/index.cjs`).
- `npm run seed` — idempotent seed from `seed_data.json` (upsert by slug, publishes everything). Creates `data.db` on first run.
- `npm run enrich -- [--all | --slug X | --id N] [--delay ms]` — bulk Open-Meteo weather backfill CLI. Enrichment is **never** automatic; also triggered per-spot from the admin editor ("Refresh weather data").
- `npm run recover-main-admin` — reset the Main Admin password (forces change + unlock).
- `npm run db:push` — drizzle-kit schema push.
- **There is no test suite and no linter.** Validation = `npm run check` + `npm run build`.

## Environment gotcha

`.env.example` ships with `NODE_ENV=production`. If you copy it for local dev as-is, `npm run dev` serves stale built assets instead of the Vite dev server (`server/index.ts` branches on `NODE_ENV === "production"`). Set `NODE_ENV=development` locally (a generated `.env` from `run_server.bat` does this). `AUTH_SECRET` is required for admin auth; no admin account is hardcoded — the first launch shows a one-time setup form.

## Architecture

- `server/storage.ts` — single source of truth: `IStorage` interface + Drizzle/better-sqlite3 implementation (synchronous queries). Storage methods, not routes, own the data logic.
- `server/routes.ts` — all REST routes; draft/publish serialization and preview rules live here.
- `shared/schema.ts` — Drizzle tables + Zod insert schemas, imported by **both** frontend and backend. Update tables here, not in per-side copies.
- `shared/scoring.ts` — authoritative score-resolution logic (manual vs. automatic ranking mode; non-evaluable months must stay non-evaluable, never silently zeroed). Both server and client must use it.
- `shared/locations.ts` — shared country/region data.
- **No migration runner.** Additive `ALTER TABLE` migrations and table rebuilds run at server startup inside `storage.ts` (see `migrate*` functions). Keep schema changes additive there; `npm run seed` + fresh `data.db` exercises them.
- `data.db` is git-ignored and never committed; it holds all content plus the admin account.

## Draft/publish model

- Drafts are separate for **spots** and for **monthly records**. Editing saves a draft (`hasDraft`); the public site serves the last published snapshot until an admin publishes. Drafts preview via `?preview=1` (auth required).
- Seeded content is published directly. Ranked output uses a manual score today; all wind speeds are in **knots**.

## Frontend

- Client-side routing is **hash-based** (`client/src/lib/useHashRoute.ts`): links look like `#/results?month=July`, admin at `#/admin`. Use hash links, not `history.pushState`.
- Path aliases (tsconfig + Vite): `@/*` → `client/src/*`, `@shared/*` → `shared/*`.
- API calls go through `client/src/lib/api.ts` (Bearer token held in module memory, never localStorage; token refresh via `x-auth-token` response header).

## Repo-specific workflow

- The product spec (`Kite-Compas - specs v1.txt`) and `WORK_PACKAGE_PLAN.md` are **gitignored in this repo** and their authoritative copies live in the sibling git worktree `kite-compass.worktrees/kite-compass-spec-review-and-steps`. The work plan drives package-by-package implementation — read package scope from the spec, validate with `npm run check`/`npm run build`, and update the plan file when done.
- Wind providers (`server/windProviders.ts`: Windy/Windfinder) are **stubs by design** — `fetchMonthly()` throws; no real API calls. Do not treat them as implemented integrations.
- Open-Meteo enrichment thresholds/percentiles/window are constants at the top of `server/services/openMeteo.ts`; change them there. Results are written as drafts and preserve manual editorial fields.
