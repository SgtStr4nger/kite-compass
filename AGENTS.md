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

## GitHub issue triage (status labels)

The issue-driven pipeline (`ticket-creator` → `planner` → `implementer`, plus `orchestrator` for batch planning; all in `.opencode/agents/`) uses `status:*` labels as the single source of truth for who owns an issue. Every bot reads the labels to find the tickets meant for it and flips them so the next bot knows it is their turn. **Never rely on the issue being assigned to a user — the `status:*` label is the authority.**

Round-trip lifecycle:

```
new ticket ─► status:needs-planner ─► status:planner-working ─► status:needs-implementer ─► status:implementer-working ─► status:needs-review ─► status:done (close)
                 ▲        │                                      ▲                                  │
                 │        └─────► status:blocked ◄──────┐        └──────────── implementer hand-back: status:needs-planner ────┘
                 │                                       │
                 └──── human answers, planner resumes ───┘
```

| Label | Meaning / who acts | Set by |
| --- | --- | --- |
| `status:needs-planner` | Planner must analyze/plan (fresh ticket, or hand-back from implementer) | ticket-creator, implementer |
| `status:planner-working` | Planner is actively working | planner, orchestrator |
| `status:blocked` | Needs human/product input (open questions); no bot can proceed | planner |
| `status:needs-implementer` | Plan posted & approved; implementer's turn | planner, orchestrator |
| `status:implementer-working` | Implementer is actively building | implementer |
| `status:needs-review` | Implementation done (PR open); planner reviews | implementer |
| `status:done` | Reviewed & complete; safe to close | planner |

### Priority labels (`priority:*`)

Priority is an **initial assumption that can be corrected** — it only breaks
ties when several issues carry the same `status:*` label; it never changes who
owns an issue.

| Label | Meaning | Initial set by | Adjusted by |
| --- | --- | --- | --- |
| `priority:p0` | Critical — blocks release, breaks the product, security/data loss | ticket-creator | planner |
| `priority:p1` | High — significant user impact, core experience, high value | ticket-creator | planner |
| `priority:p2` | Normal — the default for most tickets | ticket-creator | planner |
| `priority:p3` | Low — nice-to-have, minor, can wait | ticket-creator | planner |

- The **ticket-creator** assigns the initial `priority:*` at creation as a
  best-effort guess (default `p2` when unsure). Never create a ticket without
  one.
- The **planner** re-evaluates it during analysis and adjusts the label (up or
  down) when the plan is published, stating the change in the plan's
  "Priority assessment" section. The orchestrator applies the planner's verdict
  when posting plans in a batch.
- The **implementer** never changes `priority:*` — it only uses it for ordering
  and may flag a wrong priority in its final comment.
- Ordering everywhere (planner, implementer, orchestrator): `p0` > `p1` > `p2` >
  `p3`, then issues with no `priority:*` label last. All issue lists should
  show the priority label so humans can re-rank cheaply.

### Proposing new tickets

Any agent may propose a new ticket (e.g. a docs gap or uncovered edge case it
finds while planning/implementing). Rules:

- Proposals are surfaced to the user — in chat or as a `## Suggested new
  ticket` section in a plan/comment — with title, why, rough scope, and
  suggested `type:*`/`area:*`/`priority:*`. Never create a ticket silently.
- Only the **ticket-creator** creates issues, and only after the user
  explicitly confirms. The proposing agent then invokes the ticket-creator via
  the Task tool with the confirmed description; the ticket-creator applies the
  full label set (type/area/priority/`status:needs-planner`).
- A proposed ticket does not change the current issue's plan, status, or
  priority — it is a separate follow-up that enters the normal
  `status:needs-planner` queue.

Rules for every agent:

- Pick up only issues whose `status:*` label matches your role. Skip the rest.
- When you start an issue, set the matching `-working` label (unless it already says `-working` for you).
- When you finish, set the **next owner's** label so the hand-off is automatic.
- Hand-backs: implementer returns a ticket to the planner with `status:needs-planner`; a planner who wants changes after review returns it to the implementer with `status:needs-implementer`; open product questions become `status:blocked`.
- `PATCH /repos/{owner}/{repo}/issues/{number}` **replaces the whole label list**. Read the current labels first, drop the old `status:*` one, add the new one, and never touch `type:*`/`area:*` labels.
- Status labels are auto-created the first time they are assigned via the API; if one is ever missing, create it with `POST /repos/{owner}/{repo}/labels` (`{"name": "status:xxx", "color": "..."}`).

Update-labels helper (PowerShell; OWNER/REPO from `git remote get-url origin`):

```powershell
$issue = curl -s -H "Authorization: token ${GH_TOKEN}" "https://api.github.com/repos/{OWNER}/{REPO}/issues/{NUMBER}" | ConvertFrom-Json
$labels = ($issue.labels.name | Where-Object { $_ -notlike "status:*" }) + "status:NEW_VALUE"
$body = @{ labels = $labels } | ConvertTo-Json
curl -s -X PATCH -H "Authorization: token ${GH_TOKEN}" -H "Accept: application/vnd.github+json" -H "Content-Type: application/json" -d $body "https://api.github.com/repos/{OWNER}/{REPO}/issues/{NUMBER}"
```

## Repo-specific workflow

- **Working directories & git sync** (parallel-safety): the main checkout
  (`kite-compass`) is the shared, read-only home for planning/coordination and
  always stays on `main` + clean. Planners/orchestrator read code there after
  `git fetch origin` (and `git pull --ff-only origin main` when clean) — never
  checkout branches. **Implementers never work in the main checkout**: each
  opens its own git worktree per issue, branched fresh from `origin/main`
  (`git worktree add "../kite-compass.worktrees/kc-impl-{N}" -b "feat/{N}-{slug}" origin/main`),
  syncs with `git fetch origin && git rebase origin/main` before building, and
  removes the worktree after its PR merges. Each worktree needs its own
  `npm install` and `.env`; `data.db` is git-ignored and per-worktree. "Pull
  first" alone does not make parallel agents safe — isolation via worktrees
  does. Full rules in the agent files.
- The product spec (`Kite-Compas - specs v1.txt`) and `WORK_PACKAGE_PLAN.md` are **gitignored in this repo** and their authoritative copies live in the sibling git worktree `kite-compass.worktrees/kite-compass-spec-review-and-steps`. The work plan drives package-by-package implementation — read package scope from the spec, validate with `npm run check`/`npm run build`, and update the plan file when done.
- Wind providers (`server/windProviders.ts`: Windy/Windfinder) are **stubs by design** — `fetchMonthly()` throws; no real API calls. Do not treat them as implemented integrations.
- Open-Meteo enrichment thresholds/percentiles/window are constants at the top of `server/services/openMeteo.ts`; change them there. Results are written as drafts and preserve manual editorial fields.
