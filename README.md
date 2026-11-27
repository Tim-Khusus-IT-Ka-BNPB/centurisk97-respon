# Lapor Bencana

Disaster reporting for BNPB. A person reports what happened from a phone, on the web or over WhatsApp, and BNPB and BPBD staff see, check and act on each report.

This repo rebuilds the Lapor module of [poskokarhutla](https://github.com/terasurbannetwork/poskokarhutla) as its own product. Upstream is the behaviour reference, not a source to copy from: the features stay the same, the engineering is redone. The two repos share no git history.

How it is built: typed contracts between pages and API, layered code (route, service, repository) with pure domain rules, every user-facing word in one copy catalogue, every rule enforced on the server, and nothing merged without type checks, lint, 100% unit coverage and browser tests at phone, tablet and desktop widths.

Staging: https://lapor-bencana.centurisk97.id/lapor, synthetic data only.

Status: on staging for the pilot. Reporters: the guided report on the web and WhatsApp (place by search or GPS, hazard, follow-up and rescue questions, photos and video, summary, send), an emergency report, the ticket with the national numbers and its rating, tracking, "Laporan saya", the missing person report, Info daerah with warnings to the phone, and the report pages in local languages. Staff: the desk (map, list, gallery, clusters, status, replies, checks, documents), Orang dicari, Respons BPBD and the WhatsApp pilot numbers. Not built: the main-site login (`/masuk`), so staff and reporters sign in with this product's own codes until it lands.

## Where things are

- [TRACKER.md](TRACKER.md): what was last reviewed upstream, and whether it affects this repo.
- `workflow/`: planning and task files. Local only, not tracked.
- `app/`: pages (React Router, server rendered). `src/`: the API (Hono), domain rules and adapters. `src/platform/cloudflare/`: the Worker entry, the only code that names a Cloudflare binding.
- `db/migrations/`, `db/seed/`: D1 migrations (forward only) and synthetic seed data.
- `scripts/`: database, sweep and budget commands. `tools/model-stub/`: a local stand-in for the model provider. `tools/test-gateway/`: a local stand-in for WhatsApp.

## Rules for this repo

- It is public. No secret, no real report, no phone number and no person's name goes into a tracked file.
- Code, routes, schema and docs are in English. Text a user reads is in Indonesian, kept in one copy catalogue.

## Run it from a fresh clone

Needs Node 26.3 (see `.nvmrc`) and pnpm 10.34.5 (the `packageManager` field; `npm install -g pnpm@10.34.5`). The database is Cloudflare D1, this product's own, separate from upstream's; locally wrangler runs it on disk under `.wrangler/`. Photos go to an R2 bucket of its own (`PHOTOS`), which wrangler also keeps on disk locally. No database server and no containers.

1. Install. This also wires the git hooks in `.githooks/`.

   ```bash
   pnpm install
   pnpm exec playwright install chromium webkit
   ```

2. Settings. Copy both examples; their sample values work locally as they are.

   ```bash
   cp .env.example .env
   cp .dev.vars.example .dev.vars
   ```

3. Database. The local D1 database lives under `.wrangler/state`; the browser tests get their own under `.wrangler/e2e`, made fresh on every run.

   ```bash
   pnpm db:migrate          # applies db/migrations with wrangler's own D1 migration command
   pnpm db:seed             # synthetic data; refused unless APP_ENV is local, test or staging
   ```

   D1 migrations only go forward: a fix is a new migration. To start the local database over, delete `.wrangler/state` and run both again.

4. Run. `pnpm dev` serves the Worker with hot reload at http://localhost:5173/lapor. `pnpm preview` builds and serves the production bundle through `wrangler dev` at http://localhost:8787/lapor.

   ```bash
   pnpm dev
   pnpm model-stub          # only when MODEL_MODE=recorded in .dev.vars
   pnpm sweep:local         # fires the scheduled expiry sweep on the running dev server
   pnpm test-gateway        # a chat page at http://127.0.0.1:8791 that stands in for WhatsApp
   ```

   The test gateway signs each message with the secret in `.env`, which must equal its entry in `GATEWAY_SECRETS` of `.dev.vars`, and keeps what each number received as its outbox (`/api/outbox`). It takes 0800 numbers only and sends nothing to WhatsApp. Only numbers of the pilot are served: allow one on the desk under "Nomor uji WhatsApp", or write `lapor izin 0800...` as 0800 0000 0000.

   Contacts and preparedness topics. The seed loads synthetic stand-ins: the BPBD numbers there are 0800 numbers, never an agency's real line. Upstream's real files load with `reference:import-file`, each checked against its contract first.

   Place data. The seed loads a small pinned cut of the village file and the outlines of those villages, which GPS reads a point against. To cover the whole country, import upstream's `public/data/desa_cari.json`; its outlines are read from `public/geo/desa/` beside it, or from a folder given as a second argument. A file under 80,000 villages or 500 regencies, or outlines for fewer than 80,000 of its villages, is refused, and the same files twice write nothing.

   ```bash
   pnpm reference:import ../../poskokarhutla/public/data/desa_cari.json
   pnpm reference:import-file bpbdContacts ../../poskokarhutla/public/data/bpbd_kontak.json
   pnpm reference:import-file education ../../poskokarhutla/public/lapor/edukasi.json
   pnpm reference:timing    # times the search on the active snapshot of the local database
   pnpm db:seed             # makes the pinned seed file the active snapshot again
   pnpm openapi             # writes the API document generated from the routes to build/openapi.json
   ```

### Restart with other settings

Build once, then start the built Worker again with `--var` overrides; each start reads them fresh, no rebuild. Open the app on the port it serves, so `APP_ORIGIN` names that port. All four switches below are refused outside local and test (the Worker answers 503 and logs the setting names).

- `CLOCK_FIXED:<UTC instant>`: the clock starts there and keeps running.
- `FAULT_PLACE:on`: place search answers that place data cannot be read.
- `FAULT_SEND:on`: every send fails after its inserts, before commit; nothing is stored.
- `MODEL_MODE:recorded`: the model is the local stub (`pnpm model-stub` first).

```bash
pnpm build
pnpm exec wrangler dev --config build/server/wrangler.json \
  --test-scheduled --port 8787 --var APP_ORIGIN:http://localhost:8787 \
  --var CLOCK_FIXED:2026-11-24T03:00:00.000Z --var FAULT_PLACE:on --var FAULT_SEND:on
SWEEP_ORIGIN=http://localhost:8787 pnpm sweep:local   # the scheduled sweep on that server, at its clock
```

Stop the server with Ctrl+C before the next start. One sent to the background is stopped by its own process ids (workerd included): killing only the process on the port leaves workerd answering.

5. Tests and gates. Each runs on its own; CI runs all of them on every push. Every server test file gets its own in-memory D1 database, migrated and seeded, so test files never share rows.

   ```bash
   pnpm check               # types, lint and format, unused code
   pnpm test                # unit and integration tests, 100% coverage required
   pnpm test:mutation       # mutation tests on src/domain
   pnpm test:e2e            # Playwright; starts and stops the app and the model stub itself
   pnpm bundle:check        # the report page must stay under 300 KB gzipped before the map
   pnpm scan                # secret scan, also run by the pre-commit and pre-push hooks
   ```

Server and test output, Worker logs (`.wrangler/logs`) and test results stay on your machine and are ignored by git. Local Playwright traces are kept only for failed tests; CI keeps none.

## Staging

Its own Worker (`lapor-bencana-staging`), D1 database, R2 bucket and address, declared under `env.staging` in `wrangler.jsonc`. It shares only the Cloudflare account and the `centurisk97.id` zone with upstream, and never reads upstream's data. Synthetic data only: no real report, number or name.

```bash
export CLOUDFLARE_ACCOUNT_ID=<the account id>
CI=1 pnpm exec wrangler d1 migrations apply lapor-bencana-staging --remote --env staging
pnpm deploy:staging
```

To roll back, list the versions and make an earlier one live; the same command rolls forward. Migrations only go forward, so a version is only rolled back to one that reads the current schema.

```bash
pnpm exec wrangler deployments list --name lapor-bencana-staging
pnpm exec wrangler rollback <version id> --name lapor-bencana-staging --message "<why>"
```

`KEY_HMAC_SECRET` is a Worker secret (`wrangler secret put KEY_HMAC_SECRET --name lapor-bencana-staging`), never a file. The seeded test sessions are keyed with it, so a new secret means seeding again. The model is off until a key is set as a secret and `MODEL_MODE` is `live`.
