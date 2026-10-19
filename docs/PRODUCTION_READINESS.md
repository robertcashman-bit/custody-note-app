# Production readiness — Custody Note

| Field | Value |
|-------|--------|
| **Candidate version** | 1.9.115 (not bumped in this audit — owner releases separately) |
| **Git commit** | `2c43fa8eba1cd8ea88cd9f0080a6ee7813e5d4b7` |
| **Audit date (UTC)** | 2026-10-19 |
| **Latest shipped reference** | v1.9.115 — Help & feedback button |
| **Decision** | **AMBER** — data/sync/backup gates green in automation; full Windows/Mac packaged acceptance still requires owner hardware (see below) |

---

## Source-of-truth model (summary)

Full diagram: [`docs/data-safety/ARCHITECTURE.md`](data-safety/ARCHITECTURE.md).

| Layer | Location | Authority |
|-------|----------|-----------|
| Working copy | `%APPDATA%/custody-note/attendances.db` (encrypted CNDB) | Local durable copy; required before “Safe locally” |
| Outbox | `sync_queue` + `sync_dirty` | Survives restart; cleared only after server ack |
| Live account SoT | custodynote.com `/api/sync/*` (licence-scoped KV) | Cross-device truth for synced records |
| Server PITR | Website `sot-pitr/{userId}/` | Independent snapshots; not live SoT |
| Client PITR | `Backups/attendance-quick-*.db`, hourly, offsite folder | Generational; verified magic; restore gated |
| Managed cloud backup | AWS (Pro entitlement) | Disaster recovery product; **not** sync SoT |

Conflict rule: per-record merge / newest version; no whole-DB LWW; empty cloud never wipes local; tombstones required for delete.

---

## 1. Data integrity

**Scope:** create/edit/save/reopen, rapid saves, kill mid-save, migrations, invalid data, Unicode, large payloads, concurrent edits, honest failure reporting.

| Evidence | Result |
|----------|--------|
| `npm run test:unit` (191 files) | **2579 pass** / 2581 total, 2 skipped, 0 fail (VM 2026-10-19) |
| `npm run test:data-safety` | **199 pass**, 0 fail (includes new `backupRestoreFieldParity.test.js`) |
| `npm run test:deep` | **66 pass** |
| Playwright `npm run test:e2e` | **56 pass** (incl. 33-step stress journey) |
| Key suites | `attendanceDurability`, `saveNowDurability`, `dbMigrations`, `dataSafety.faultInjection`, `syncStress`, `emptySyncRecovery`, `saveSyncEmptyOutbox`, `silentSyncDeath` |

**RAG: GREEN** for automated regression; **AMBER** for packaged kill-during-save on real OS (simulated via SIGKILL harness + flush policy tests).

---

## 2. Local / cloud backup consistency

| Evidence | Result |
|----------|--------|
| `backupRestoreFieldParity.test.js` | Encrypted generational backup → corrupt live → gate → full field compare; sibling row unchanged; empty-backup refused; mock central SoT after amend; primary-loss rebuild |
| `backupPathAndGenerational.test.js` | Paths, scheduler, restore IPC wiring, degradation UI |
| `backupIntegrityGate` + `dataSafety.greenCloseout` | Empty/corrupt restore over live refused |
| Mock sync server | Push/pull envelope parity (`crossDeviceSync.test.js`) |

**Managed AWS cloud backup** full round-trip is **not** automated (requires live Pro credentials); list/restore IPC error paths covered in `postBillPurge.test.js`.

**RAG: GREEN** local PITR + central sync SoT (mocked); **AMBER** managed AWS backup E2E (manual / smoke script `smoke:licence-backup` when website repo present).

---

## 3. Cross-platform

See [`docs/CROSS_PLATFORM_TEST_MATRIX.md`](CROSS_PLATFORM_TEST_MATRIX.md).

| Platform | Automated | Manual gap |
|----------|-----------|------------|
| Windows NSIS | CI unit + e2e + MSIX config/build job | SmartScreen, upgrade from 1.9.x, non-admin paths |
| Windows Store | `validate:msix`, shared userData unit tests, CI MSIX artefact | Store install, update ring, rating prompt |
| macOS | Shared JS tests; release workflow builds DMG | Notary, Gatekeeper, Apple Silicon vs Intel smoke |

**RAG: AMBER** — code parity green; installer UX on real machines pending owner QA.

---

## 4. CI

Workflow: [`.github/workflows/test.yml`](../.github/workflows/test.yml)

| Step | On every PR/push to master |
|------|----------------------------|
| `npm run test:unit` | Yes |
| `npm run validate:msix` | Yes |
| `npm run test:data-safety` | Yes |
| `npm run security:audit` | Yes |
| `npm run test:e2e` | Yes |
| `msix-package` job | Yes (unsigned build) |
| Legacy `npm test` Electron smoke | **Skipped in CI** (documented flakiness); run locally via `npm run test:all` |

**Recent CI:** Test workflow **success** on v1.9.115 merge (2026-10-15, ~4m). Cloud Agent could not read org billing/minutes via API (integration 403); workflows remain wired.

**Totals (VM 2026-10-19):**

| Suite | Pass | Fail | Skip |
|-------|------|------|------|
| Unit | 2579 | 0 | 2 |
| Data-safety | 199 | 0 | 0 |
| Deep audit | 66 | 0 | 0 |
| Playwright e2e | 56 | 0 | 0 |
| Security audit | pass | — | — |

**RAG: GREEN** for PR gate; **AMBER** for macOS duplicate unit job (deferred for Actions minutes).

---

## 5. Bugbot / recent release issues

| Topic | Status | Version / test |
|-------|--------|----------------|
| Empty outbox → false “synced” | Fixed | 1.9.114 · `saveSyncEmptyOutbox.test.js` |
| Stuck `syncing` rows on startup | Fixed | 1.9.114 · `staleOutboxReconcile` / sync reliability tests |
| `sync.log` + skip reasons | Fixed | 1.9.114 |
| Server-blocked sync silent success | Fixed | 1.9.113–114 · `saveSyncBlocked.test.js` |
| Store vs direct `installSource` | Fixed | 1.9.x · `usageHeartbeat.test.js`, `windowsPackageChannel.test.js` |
| Help & feedback | Shipped | 1.9.115 |

No open medium/high Bugbot items identified on merged PRs #103–#107 from code/test review; re-run Bugbot on this PR before merge.

---

## 6. Version consistency

| Artefact | Value |
|----------|--------|
| `package.json` | 1.9.115 |
| `changelog.json` latest | 1.9.115 (in sync) |
| NSIS artefact | `Custody-Note-Setup-1.9.115.exe` (pattern) |
| MSIX artefact | `Custody-Note-1.9.115.msix` |
| Mac artefacts | `Custody-Note-1.9.115-${arch}.dmg/zip` |
| `latest.yml` / `latest-mac.yml` | Produced at release (not in repo) |
| Website `releases.json` | **Not verified** — `custody-note-website` not in Cloud Agent workspace; run `npm run verify:release` with `WEBSITE_ROOT` before deploy |

**RAG: GREEN** in-repo; **AMBER** until website sync confirmed on deploy machine.

---

## 7. Security / privacy

| Check | Result |
|-------|--------|
| `npm run security:audit` | npm prod vulns 0; secret scan 0 high/medium |
| Static guards | Outlook subject-only, window hardening, capturePage packaged guard |
| Tests | Synthetic fixtures only (`sync-test@example.com`, generated DSCC) |
| Git history | Not fully scanned for unreachable blobs; if past commits contained real client data, **GitHub Support history rewrite** may be required (external blocker) |

**RAG: GREEN** for current tree + audit script; **AMBER** for historical git objects not verified in this environment.

---

## 8. Logging / error handling

Coverage via static + unit tests: `safeLog`, `syncDiagLog`, `securityLog`, save/sync result normalization, backup degradation IPC, restore error strings (no success on gate failure). Logs must not include client PII — enforced by save log builders and audit script.

**RAG: GREEN** for tested paths; ongoing discipline on new IPC.

---

## 9. Recovery safeguards

| Safeguard | Test / code evidence |
|-----------|---------------------|
| Versioned local quick/hourly backups | `backupScheduler`, generational tests |
| Pre-restore safety copy | `createDbSafetyCopy` in restore handlers (static in architecture tests) |
| Restore integrity gate | `mayRestoreBackupOverLive`, field parity test |
| Pre-migration / schema | `dbMigrations.test.js` |
| Failed upgrade retains prior DB | Atomic flush + tmp orphan tests in `dataSafety.greenCloseout` |
| Startup stuck sync reset | 1.9.114 + stale outbox tests |

**RAG: GREEN**

---

## 10. Final acceptance (Cloud Agent environment)

| Step | Result |
|------|--------|
| Synthetic full lifecycle (create → bill → archive) | **Pass** — Playwright stress-journey (56 e2e tests) |
| Field-level backup/restore | **Pass** — `backupRestoreFieldParity.test.js` |
| Packaged install on Windows | **Not run** — no signed installer in agent VM |
| Packaged install on Mac | **Not run** |
| Managed cloud backup UI | **Not run** |
| Owner Windows laptop pass | **Pending** (explicitly separate) |

---

## Known issues

| Severity | Issue | Workaround | Plan |
|----------|-------|------------|------|
| Low | CI skips legacy Electron smoke | Use Playwright e2e + local `npm run test:all` before release | Keep e2e parity with smoke |
| Medium | Managed AWS backup not in automated E2E | Use local generational backup + sync SoT | Optional smoke with website repo |
| Medium | macOS unit not on PR CI | Run `test:unit` on Mac before release | Re-enable mac job when minutes allow |
| Low | Website `releases.json` not checked in agent | Set `WEBSITE_ROOT` on deploy | Standard deploy script |

---

## Overall RAG summary

| Dimension | RAG |
|-----------|-----|
| Data integrity | **GREEN** |
| Local/cloud backup consistency | **GREEN** (AWS DR **AMBER**) |
| Cross-platform reliability | **AMBER** |
| Automated testing | **GREEN** |
| Security/privacy | **GREEN** (history **AMBER**) |
| Windows distribution (NSIS + Store) | **AMBER** (CI build green; real install manual) |
| **Overall** | **AMBER** → promote to **GREEN** after owner Windows/Mac packaged acceptance + website version sync |

---

## Changes in this audit (PR branch)

- Added `tests/backupRestoreFieldParity.test.js` — local encrypted backup + mock central SoT field parity.
- Added `docs/PRODUCTION_READINESS.md`, `docs/CROSS_PLATFORM_TEST_MATRIX.md`.
- Wired new test into `npm run test:data-safety`.

---

## Website / backend (separate repo)

No code defects filed during this pass (website not cloned). Recommended owner checks on `custody-note-website`:

- SoT/PITR API contract tests stay aligned with app `emptyOrFailedResponsePolicy` (503 `INCOMPLETE_SOT_READ`).
- Release metadata sync when deploying app tags.

---

## Mac impact / Windows impact

Identical custody data paths and sync semantics. Windows-only: MSIX updater off, shared userData, Store install detection. macOS-only: DMG signing/notary in release workflow.
