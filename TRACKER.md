# Upstream tracker

This repo rebuilds the Lapor module of `poskokarhutla`, which moves much faster. This file records what we reviewed upstream, whether it affects us, and what each milestone is synced against, so we always know what is stale.

- **Upstream:** `terasurbannetwork/poskokarhutla`, branch `main`, expected at `../poskokarhutla`
- **Last reviewed:** `f938e0b6` (24 Nov 2026)

**We only monitor upstream.** Nothing here writes to `../poskokarhutla`: no edits, commits, pulls or fetches. Every command in this file only reads. Fixes upstream are for its owner to make.

## When to review

| When | What | Output |
|---|---|---|
| Weekly | The four checks below | One review log row |
| Before a milestone opens | The four checks, then the drill-down for that milestone's ledger rows | Behaviour tests, then the milestone's tasks are written |
| When a milestone closes | Compare its ledger rows with upstream | **Synced at** on each row |
| At the switch | Check 4's list of callers | Empty, or a plan per caller |

## Routine

Upstream's Lapor paths took 91 commits in their first five days (19 to 23 Nov 2026), and many subjects say only "gas". Nobody reads those one by one, so the routine is four small checks. Run from this repo root.

Set the range, replacing the first SHA with the last reviewed one above. `origin/main` is as fresh as your own last pull or your editor's auto-fetch.

```bash
RANGE=f938e0b6..origin/main
```

**1. Did Lapor change?** Commits per file in the paths Lapor owns upstream.

```bash
git -C ../poskokarhutla log --no-merges --name-only --format= $RANGE -- 'src/lapor_*.js' 'src/pw_*.js' public/lapor public/sw-lapor.js scripts/lapor 'scripts/wa/lapor_*' tests/lapor 'tests/wa/lapor_*' | sort | uniq -c | sort -rn
```

Lapor's SQL and page routing sit in two shared files. This counts their changed lines that mention Lapor:

```bash
git -C ../poskokarhutla diff $RANGE -- src/hak.js src/worker.js | grep -icE '^[+-].*(lapor([^a]|$)|lj_|pw_)'
```

**2. Anything new?** New routes, tables, files and migrations. Each new one gets a ledger row, or a `skip` note in the log. A line starting with `>` was added, `<` was removed.

```bash
diff <(git -C ../poskokarhutla grep -hoE '"(GET|POST|PUT|PATCH|DELETE) /api/lapor[^"]*"' ${RANGE%%..*} -- src | sort -u) <(git -C ../poskokarhutla grep -hoE '"(GET|POST|PUT|PATCH|DELETE) /api/lapor[^"]*"' origin/main -- src | sort -u)
```

```bash
diff <(git -C ../poskokarhutla grep -hoE 'CREATE TABLE IF NOT EXISTS (lapor_|lj_|pw_)[a-z0-9_]+' ${RANGE%%..*} -- migrations | sort -u) <(git -C ../poskokarhutla grep -hoE 'CREATE TABLE IF NOT EXISTS (lapor_|lj_|pw_)[a-z0-9_]+' origin/main -- migrations | sort -u)
```

```bash
git -C ../poskokarhutla diff --diff-filter=A --name-only $RANGE -- 'src/lapor_*.js' 'src/pw_*.js' public/lapor scripts/lapor 'scripts/wa/lapor_*' tests/lapor
```

```bash
git -C ../poskokarhutla diff --diff-filter=A --name-only $RANGE -- migrations | while read -r f; do git -C ../poskokarhutla grep -qE 'lapor_|lj_|pw_' origin/main -- "$f" && echo "$f"; done
```

**3. Did the owner decide something?** Decision files rank above everything else.

```bash
git -C ../poskokarhutla log --no-merges --date=short --format='%h %ad %s' $RANGE -- data/kajian-bnpb/lapor-ai data/kajian-bnpb/lapor-lanjutan data/kajian-bnpb/lapor-luring data/kajian-bnpb/lapor-kejadian data/kajian-bnpb/pwa-peringatan
```

**4. Did something around Lapor change?** First, code Lapor borrows. A change here can break our adapters, which is `drift`.

```bash
git -C ../poskokarhutla log --no-merges --name-only --format= $RANGE -- src/masuk_sesi.js src/staf.js src/posko.js src/kemitraan.js src/bnpb.js src/samarkan.js src/media_bersih.js src/media_berkas.js src/push.js public/inti/tema.css public/inti/antre.js public/inti/exif.js public/inti/foto_kecil.js public/bnpb/bnpb.css public/bagi.js public/bencana.json public/prediksi/besok_inti.js | sort | uniq -c | sort -rn
```

Then, other upstream code that calls Lapor. Compare the output with the callers table below. A new name is a new dependency on Lapor, and it must keep working at the switch.

```bash
git -C ../poskokarhutla grep -lE 'lapor_(sesi|tiket|pesan|foto|kelompok|versi)|/api/lapor/' origin/main -- src scripts public tests ':(exclude)src/lapor_*' ':(exclude)src/pw_*' ':(exclude)src/hak.js' ':(exclude)src/worker.js' ':(exclude)public/lapor' ':(exclude)public/sw-lapor.js' ':(exclude)scripts/lapor' ':(exclude)scripts/wa' ':(exclude)tests/lapor' ':(exclude)tests/wa'
```

Data shapes are not tracked by git diff. The contract tests catch them from M01.

## Updating the log

Do this after the four checks.

1. **Log row.** Add it at the top of the review log. `Range` is the SHAs you reviewed. `Notable` is one or two sentences on what a person should know: new behaviour, changed behaviour, owner decisions. Do not list commits. `Affects us` says which milestone it touches and what we do about it, or "No". `Labels` come from the triage table.
2. **Last reviewed.** Move the SHA and date at the top of this file, and the SHA in the `RANGE` line.
3. **Ledger.** A new file, route or table gets a ledger row. A row whose milestone is already built and whose paths changed gets status `Stale`.
4. **Callers.** Update the callers table when check 4 prints a new name.

## Before a milestone opens

Drill down on that milestone only, using its ledger paths. `--stat` makes "gas" commits readable.

```bash
git -C ../poskokarhutla log --no-merges --date=short --format='%h %ad %s' --stat <synced-sha>..origin/main -- <upstream paths>
```

When the milestone closes, set **Synced at** to the upstream commit whose behaviour it matches.

## Triage labels

| Label | Meaning |
|---|---|
| `port` | New behaviour we want. Add it to the milestone map, do not copy the code |
| `watch` | Affects a milestone we have not started, or an item we parked. Note it, nothing to do yet |
| `drift` | Changes a milestone we already built, or something we borrow |
| `risk` | New security or safety problem upstream. Tell the owner. Details never go in this public file |
| `skip` | Data, reports, agent tooling, or out of scope |

## Review log

Newest first.

| Date | Range | Notable | Affects us | Labels |
|---|---|---|---|---|
| 2026-11-24 | `f8789ea3..f938e0b6` | 15 new routes, 5 new tables, migrations 0164 to 0170, decisions K90 to K92 and a new `profil-bpbd` package. BPBD follow-up data, which we had parked, is now built on web and WhatsApp. Also new: one-tap emergency, village QR poster, who took a report, monthly response card, BPBD verification with three-source reconciliation. Two new callers: Dalops and Data Bencana call `meja/rekon`, the leaders' page calls `respons` | Map gains M09 (follow-up data) and M10 (verified and reconciled), plus new tasks in M02, M03, M05 and M06. Nothing built here is stale | `port`, `watch` |
| 2026-11-23 | Baseline `f8789ea3` | First review. Lapor is five days old upstream and live for pilot users: 19 Worker files, 39 API routes, 36 tables in migrations 0155 to 0163, 15 test files, 5 decision packages. Last two days added install as app, push warnings, report without signal, BPBD contact numbers and the regional report card | Everything is new to us and nothing is built, so nothing is stale. This is the baseline every milestone starts from | n/a |

## Port ledger

One row per milestone of the map. Paths are upstream's.

| Milestone | Upstream paths | Status | Synced at |
|---|---|---|---|
| M01-report-and-track | `src/lapor_mesin.js`, `src/lapor_spek.js`, `src/lapor_model.js`, `src/lapor_wilayah.js`, `src/lapor_jalan.js`, `src/lapor_kontak.js`, `src/lapor_tampil.js`, `public/lapor/index.html`, `public/lapor/lapor.js`, `public/lapor/lapor.css`, `public/lapor/lacak.html`, `public/lapor/lacak.js`, `public/lapor/lacak.css`, `public/lapor/maskot.js`, `public/lapor/ilustrasi.js`, `public/lapor/edukasi.json`, `public/lapor/lambang-bnpb.png`, `migrations/0155_lapor_ai.sql`, `migrations/0159_lapor_perangkat.sql`, `tests/lapor/mesin.test.mjs`, `tests/lapor/rute.test.mjs`, `tests/lapor/gerbang_topik.test.mjs`, `tests/lapor/kontak.test.mjs`, `tests/lapor/tempat_peta.test.mjs`, `data/kajian-bnpb/lapor-ai/` | Not started | |
| M02-desk-and-field | `src/lapor_meja_hak.js`, `src/lapor_periksa.js`, `public/lapor/meja.html`, `public/lapor/meja.js`, `public/lapor/meja.css`, `public/lapor/kontak.js`, `migrations/0157_lapor_lanjut.sql`, `migrations/0162_lapor_periksa.sql`, `migrations/0166_profil_bpbd.sql`, `migrations/0167_lapor_ambil.sql`, `tests/lapor/lokal_periksa.test.mjs`, `tests/lapor/darurat_cepat.test.mjs`, `data/kajian-bnpb/profil-bpbd/` | Not started | |
| M03-documents-and-updates | `scripts/lapor/dokumen.py`, `scripts/wa/lapor_pdf.mjs`, `migrations/0156_lapor_versi.sql` | Not started | |
| M04-whatsapp-door | `scripts/wa/lapor_wa.mjs`, `scripts/wa/gateway/index.js`, `tests/wa/lapor_arah.test.mjs` | Not started | |
| M05-any-language-any-signal | `src/lapor_bahasa.js`, `public/lapor/tr/`, `public/lapor/poster.html`, `public/lapor/poster.js`, `public/lapor/poster.css`, `tests/lapor/poster.test.mjs`, `scripts/lapor/tr_buat.mjs`, `scripts/lapor/tr_kumpul.mjs`, `public/lapor/luring.js`, `public/sw-lapor.js`, `public/lapor/manifest.webmanifest`, `public/lapor/ikon/`, `migrations/0158_lapor_unggah.sql`, `tests/lapor/kamus_tr.test.mjs`, `tests/lapor/lokal_media.test.mjs`, `data/kajian-bnpb/lapor-luring/` | Not started | |
| M06-shared-picture | `src/lapor_gugus.js`, `src/lapor_agregat.js`, `migrations/0160_lapor_kelompok.sql`, `tests/lapor/agregat.test.mjs`, `tests/lapor/lokal_kejadian.test.mjs` | Not started | |
| M07-know-and-be-warned | `src/lapor_info.js`, `src/lapor_besok.js`, `src/lapor_window.js`, `src/pw_inti.js`, `src/pw_peringatan.js`, `public/lapor/peringatan.js`, `migrations/0163_pw_peringatan.sql`, `tests/lapor/peringatan.test.mjs`, `tests/lapor/peringatan_rute.test.mjs`, `tests/lapor/sekitar_ibadah.test.mjs`, `data/kajian-bnpb/pwa-peringatan/` | Not started | |
| Every milestone | `src/lapor_ai.js` (all routes), the Lapor section of `src/hak.js` (all SQL), the Lapor lines of `src/worker.js` | Read per milestone | |
| M09-follow-up-data | `src/lapor_lanjut.js`, `src/lapor_lanjut_mesin.js`, `src/lapor_lanjut_spek.js`, `migrations/0161_lapor_data.sql`, `migrations/0164_tautan_token.sql`, `migrations/0165_lj_sesi.sql`, `tests/lapor/lanjut_*.test.mjs`, `data/kajian-bnpb/lapor-lanjutan/` | Not started | |
| M10-verified-and-reconciled | `src/lapor_kejadian.js`, `migrations/0169_lk_periksa_akun.sql`, `migrations/0170_lk_tarik_usulan.sql`, `tests/lapor/verifikasi_bpbd.test.mjs`, `tests/lapor/lk_migrasi.test.mjs`, `data/kajian-bnpb/lapor-kejadian/` | Not started | |
| Not ported: local review server | `scripts/lapor/lokal.mjs` | Reference only. Some behaviour exists only here | |

## Borrowed from upstream

What Lapor uses but does not own. We do not port these: we read them through an adapter, or write our own.

| What | Upstream paths | Here |
|---|---|---|
| Sessions and roles | `src/masuk_sesi.js`, `src/staf.js`, `src/posko.js`, `src/kemitraan.js` | The identity port |
| Helpers | `src/bnpb.js` (rate limits), `src/samarkan.js` (masking), `src/media_bersih.js`, `src/media_berkas.js`, `src/push.js` | Behaviour reference for our own |
| Shared screen code | `public/inti/tema.css`, `public/inti/antre.js`, `public/inti/exif.js`, `public/inti/foto_kecil.js`, `public/bnpb/bnpb.css`, `public/bagi.js`, `public/bencana.json` | Our own design system and offline queue |
| Forecast | `public/prediksi/besok_inti.js`, `public/prediksi/data/prediksi.json` | Read, never recomputed |
| Reference data | `public/data/desa_cari.json`, `public/data/bpbd.json`, `public/data/bpbd_kontak.json`, `public/data/osm_nasional/`, `public/data/dibi_kejadian.json`, `public/data/status_darurat.json`, `public/data/titik24.json`, `public/banjir/data/risiko_kecamatan.json`, `public/banjir/data/abu_gunungapi.json`, `public/geo/kabupaten/` | Read through contracts. Contents change daily, shapes are what matter |

## Callers of Lapor upstream

Other upstream code that calls Lapor's API. Each must keep working when Lapor moves here.

| Caller | Calls | Since |
|---|---|---|
| `scripts/wa/lapor_wa.mjs`, `scripts/wa/lapor_pdf.mjs` (WhatsApp gateway) | `pesan`, `foto`, `izin`, `bahasa`, `kabar`, `pdf/antre`, `pdf/:x` | Baseline |
| `public/bnpb/dalops_lapor.js` (Dalops card of citizen reports) | `meja` | Baseline |
| `public/inti/alarm.js` (alarm pop-up on hazard pages) | `meja` | Baseline |
| `public/kemitraan/data.js` (campus data view) | `agregat` | Baseline |
| `public/bnpb/dalops.js`, `public/bnpb/data_bencana.js` (Dalops, Data Bencana) | `meja/rekon` | 2026-11-24 |
| `public/admin/pimpinan.js` (leaders' page) | `respons` | 2026-11-24 |
| `scripts/agents/tinjau_lokal.mjs` (local review proxy) | Answers `/api/lapor/*` locally | Baseline, `skip` |

Check 4 also prints `tests/warga/cakupan.json` and `tests/warga/migrasi_beku.json`. They are upstream's own route and migration lists, not callers.
