# Production readiness — Custody Note

| Field | Value |
|-------|--------|
| **Candidate version** | 1.9.115 (unchanged) |
| **Audit commit** | `cursor/production-readiness-28b6` (this PR) |
| **Baseline** | `2c43fa8` (v1.9.115 on master) |
| **Audit date (UTC)** | 2026-10-19 |
| **Decision** | **AMBER** — automated scenario matrix largely **GREEN**; packaged Mac/Windows acceptance and gitleaks historical hits remain; **pre-migration safety copy on upgrade** in this PR needs **owner review before merge** |

---

## Scenario evidence (Priorities 1 & 2)

RAG key: **G** = automated test names cited · **A** = partial/static only · **R** = no test (downgraded)

### Priority 1 — Data integrity

| Scenario | Test file | Test name (suite › it) | RAG |
|----------|-----------|------------------------|-----|
| Complete record create + save | `tests/e2e/stress-journey.spec.ts` | `full lifecycle stress journey › B.1 incomplete draft saved` | G |
| Close / reopen record | `tests/e2e/stress-journey.spec.ts` | `full lifecycle › H.0 record loaded into form view` | G |
| Edit after save | `tests/e2e/stress-journey.spec.ts` | `full lifecycle › C.1 edit-after-save persisted` | G |
| Rapid consecutive saves | `tests/syncStress.test.js` | `Stress: Concurrent save storm › syncs under concurrent save storm` | G |
| Kill during save (atomic write) | `tests/killDuringAtomicWrite.test.js` | `Kill during atomic write › SIGKILL mid-write leaves previous on-disk CNDB intact` | G |
| Crash / restart (outbox survives) | `tests/dataSafety.faultInjection.test.js` | `Offline + restart outbox survival › queue + dirty survive simulated restart` | G |
| Upgrade from legacy schema (no schema_version) | `tests/dbMigrations.test.js` | `dbMigrations runner › upgrades a legacy DB (missing column…)` | G |
| Upgrade from v1 → v2+ (stamped v1) | `tests/dbMigrations.test.js` | `dbMigrations runner › sets Tonbridge (BG039) mileage_from_base…` | G |
| Interrupted migration (rollback) | `tests/interruptedMigration.test.js` | `Interrupted / failed schema migration › failed migration rolls back` | G |
| Pre-migration safety copy | `tests/dbStartupIntegrity.test.js` | `dbStartupIntegrity › initDb takes pre-migration safety copy…` (+ `interruptedMigration › pre-migration safety copy pattern`) | G |
| Invalid / partial data | `tests/e2e/stress-journey.spec.ts` | `B.2 missing fields persisted as empty` | G |
| Duplicate protection (finalised DSCC) | `tests/e2e/stress-journey.spec.ts` | `D.2 draft dedupe` / `E.3 attendanceCheckDuplicate matches finalised DSCC` | G |
| Null / empty fields | `tests/e2e/stress-journey.spec.ts` | `B.2 missing fields persisted as empty` | G |
| Unicode / unusual characters | `tests/backupRestoreFieldParity.test.js` | `save → encrypted backup → corrupt live → restore preserves every field` | G |
| Large records (~500KB) | `tests/syncStress.test.js` | `Stress: Large payload (500KB) › syncs record with 500KB data blob` | G |
| Near-concurrent edits | `tests/syncFieldMerge.test.js` | merge / conflict suites | G |
| No silent overwrite of newer data | `tests/dataSafety.faultInjection.test.js` | monitor / never-event suites; `tests/syncFieldMerge.test.js` | G |
| Failed disk flush not shown as success | `tests/dataSafety.flushPolicy.test.js` | flush dirty policy suites | G |
| User-facing save/sync failure copy | `tests/saveNowDurability.test.js` | `Save now fails loudly when backup path invalid` | G |
| Empty outbox false “synced” | `tests/saveSyncEmptyOutbox.test.js` | (full file) | G |
| Server-blocked sync surfaced | `tests/saveSyncBlocked.test.js` | (full file) | G |

### Priority 2 — Local / cloud backup consistency

| Scenario | Test file | Test name | RAG |
|----------|-----------|-----------|-----|
| Local generational backup | `tests/backupPathAndGenerational.test.js` | `generational quick backups + visible degradation` | G |
| Field-level local restore | `tests/backupRestoreFieldParity.test.js` | full suite (4 tests) | G |
| Empty backup refused over live | `tests/backupRestoreFieldParity.test.js` | `refuses empty backup over live data` | G |
| Corrupt / empty restore gate | `tests/dataSafety.greenCloseout.test.js` | `restore scoring refuses empty/corrupt over live` | G |
| Missing backup (no files) | `lib/backupIntegrityGate` via `tests/dataSafety.architecture.test.js` | `evaluateBackupSeriesIntegrity` / empty series | G |
| Offline (sync) | `tests/syncEngine.test.js` | `Sync Engine: Offline persistence` | G |
| Cloud down / failed pull | `tests/silentSyncDeath.test.js`, `tests/emptySyncRecovery.test.js` | (suites) | G |
| Interrupted local backup | `tests/backupScheduler.test.js` | `handles backup error gracefully` | G |
| App hidden / close flush backup | `tests/backupScheduler.test.js` | `forces immediate backup on background flush` | G |
| Conflicting edits (merge) | `tests/syncConflicts.test.js`, `tests/syncFieldMerge.test.js` | (suites) | G |
| Central SoT amend vs PITR baseline | `tests/backupRestoreFieldParity.test.js` | `amend after backup → mock central SoT…` | G |
| Managed cloud backup upload/list/restore | `tests/managedCloudBackupE2e.test.js` | `upload → amend → re-upload → restore…` | G |
| Managed cloud auth failure | `tests/managedCloudBackupE2e.test.js` | `auth failure surfaces PERMISSION_DENIED` | G |
| Managed cloud quota / 5xx mapping | `tests/managedCloudBackupE2e.test.js` | `quota and 5xx map to user-visible codes` | G |
| Older vs newer cloud copy (PITR independence) | `tests/dataSafety.greenCloseout.test.js` | `PITR prefix independent from live SoT` | G |
| Real AWS / Partner Center path | — | Manual Pro licence smoke | R |

**Source-of-truth model:** [`docs/data-safety/ARCHITECTURE.md`](data-safety/ARCHITECTURE.md)

---

## Recovery safeguards (Priority 9)

| Safeguard | Evidence |
|-----------|----------|
| Startup encrypted-file integrity (`bad_magic`, empty file) | `lib/dbStartupIntegrity.js` + `tests/dbStartupIntegrity.test.js` |
| Pre-migration safety copy (when schema behind & rows exist) | `main.js` `initDb` + tests above |
| Versioned quick/hourly backups + retention | `tests/backupPathAndGenerational.test.js`, `tests/backupScheduler.test.js` |
| Restore gate (empty over live) | `lib/backupIntegrityGate.js` + parity tests |
| `sync-integrity-check` IPC | `main.js` handler + `tests/dataSafety.architecture.test.js` |
| Atomic DB writes | `lib/dbAtomicWrite.js` + `tests/killDuringAtomicWrite.test.js` |

---

## Bugbot / PR audit (#90+)

| PR | Finding (severity) | Fixed? | Merged | First release | Regression test |
|----|-------------------|--------|--------|---------------|-----------------|
| 95 | Trial-started payload missing `installSource` (Medium) | Y | #95 | 1.9.112 area | `tests/usageHeartbeat.test.js` |
| 96 | Dirty flag blocks note switch refresh (Medium) | Y (this PR) | pending | — | `tests/openNoteCentralSyncIndicator.test.js` (source wiring) |
| 96 | Refresh overwrites failed disk flush (Low) | Y (this PR) | pending | — | `_openNoteLastDurableOnDisk` in `app.js` + test above |
| 97 | Validate clears device revoke backoff (Medium) | Y | #97 | 1.9.112 | `tests/freeSyncDeviceRevoke.test.js` / licence validate paths |
| 97 | Key activate drops free_sync tier (Medium) | Y | #97 | 1.9.112 | `tests/licenceActivateHonesty.test.js`, `applyStoredServerTier` |
| 97 | Bootstrap races sync worker (Medium) | Y | #97 | 1.9.112 | sync bootstrap tests in PR 97 |
| 103–107 | Bugbot usage limit (no scan) | n/a | merged | 1.9.113–115 | existing sync regression suites |
| Store vs direct | — | Y | #95 | 1.9.112+ | `tests/windowsPackageChannel.test.js`, `tests/usageHeartbeat.test.js` |
| Website links | — | Y | ongoing | — | `tests/websiteLinks.test.js` |
| Release-note filtering | — | Y | — | — | `tests/publicReleaseNotes.test.js` |
| Telemetry / heartbeat | — | Y | #95 | 1.9.112+ | `tests/usageHeartbeat.test.js` |

---

## CI fail conditions

| Workflow | Failing steps (non-zero exit) |
|----------|--------------------------------|
| `.github/workflows/test.yml` | `npm run test:unit`, `validate:msix`, `test:data-safety`, dedicated migration/kill/cloud backup steps, `security:audit`, `test:e2e` |
| `.github/workflows/release-publish.yml` | `prepare-release-draft` job: `test:unit`, `test:data-safety`, `security:audit`, migration regression |
| `msix-package` job | MSIX build artefact missing → fail |

Evidence: local VM 2026-10-19 — `test:unit` **2590 pass / 2 skip**, `test:data-safety` **211 pass**, `test:e2e` **56 pass**, `test:deep` **66 pass**, `security:audit` pass.

---

## Security scan (Priority 7)

| Scan | Result |
|------|--------|
| `npm run security:audit` | Pass (prod deps + static guards) |
| gitleaks (794 commits, redacted) | **25 findings** — rules: generic-api-key (21), aws-access-token (2), jwt (1), curl-auth-header (1). Paths include **test fixtures**, `docs/SMOKE_TEST_LICENCE.md`, one workflow — **no values quoted here**. Treat as **AMBER** until owner confirms all are synthetic/rotated. |
| Working-tree PII grep (tests/docs) | Synthetic emails (`example.com`, `sync-test@…`); no real client matter content in tests |

**External blocker:** unreachable git objects not scanned; GitHub Support if historical real data ever committed.

---

## Error handling (Priority 8)

| Area | Change / evidence |
|------|-------------------|
| Managed cloud upload | Errors mapped via `lib/backupErrorMap.js`; failures emit `cloud-backup-status-changed` with message (no silent `.catch(() => {})` on final failure path) |
| Startup DB | Bad magic → `PersistenceStartupError` with user-facing restore guidance |
| Migration failure | Transaction rollback (`tests/interruptedMigration.test.js`) |
| Open-note sync UI | No central “safe locally” after known flush fail (`app.js`) |

---

## Overall RAG (updated)

| Dimension | RAG | Notes |
|-----------|-----|-------|
| Data integrity scenarios | **GREEN** | Matrix above |
| Local / cloud backup scenarios | **GREEN** | Managed AWS real bucket still manual |
| Cross-platform | **AMBER** | [`CROSS_PLATFORM_TEST_MATRIX.md`](CROSS_PLATFORM_TEST_MATRIX.md) |
| Automated testing / CI | **GREEN** | Release gates added |
| Security / privacy | **AMBER** | gitleaks 25 hits to triage |
| Windows distribution | **AMBER** | CI MSIX build green; real install manual |
| **Overall** | **AMBER** | Owner packaged QA + **review pre-migration backup on upgrade** |

---

## Mac / Windows impact

Shared logic: backup ops, migration safety, sync UI fixes, startup integrity. Windows/macOS install artefacts unchanged.

---

## Website / backend (separate repo)

No code defects filed (website not in workspace). Keep SoT/PITR 503 contract aligned with app pull guards.
