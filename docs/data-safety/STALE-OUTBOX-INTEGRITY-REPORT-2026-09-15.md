# Custody Note sync data-integrity report — stale outbox / fake pending footer

**Date:** 2026-09-15  
**Field device:** Robsprgr (1.9.101)  
**Branch:** `cursor/sync-integrity-stale-outbox-f46a`  
**Release bump:** **Not included** — leave `1.9.102` as a follow-up after CI green on this PR.

---

## CURRENT PROBLEM

After conflict clear + failed reupload thrash + `syncFullResync` on Robsprgr:

- Pull: received 114, merged 0, conflicts 0 — cloud and local content match.
- Integrity: `localOnly=0`, cloud inventory 114 (= 69 active + 45 soft-deleted), `discrepancies=[]`.
- Footer still showed ~139 “pending / not confirmed”.
- Push returned `{ ok: true, written: 0 }` → `Push accepted 0 records (cloud write empty)`.
- Dirty/outbox never cleared; `lastSyncSkipReason` could read `ok_empty_outbox` while `queueLength` stayed high.
- No renderer `clearOutbox` / `markConfirmed` API (by design — ack must come from push path).

---

## ROOT CAUSE

1. **Empty-write never acks (primary).** `assertPushAccepted` correctly refuses `written:0` to prevent the 1.9.82 empty-cloud false-ack class. The worker then `markFailed` and keeps `sync_dirty=1`. When the cloud **already holds** those `sync_id`s (idempotent / already-present write), that leaves a **permanent fake backlog**. Hypothesis confirmed in code: written:0 is treated as failure with no integrity-gated exception.

2. **Pending counter double-count (amplifier).** `pendingUploads` / footer used `pendingChanges + dirtyPushCount`. The same case is normally both dirty and queued → 40 + 99 ≈ 139 for ~99 unique cases.

3. **Integrity IPC incomplete.** `sync-integrity-check` passed `cloudSyncIds: null`, so `localOnly` could not fire from live diagnostics even when IDs were knowable after pull.

4. **`ok_empty_outbox` misnamed.** Cycle outcome was set when *no due items pushed this cycle*, not when the outbox was empty — so it could coexist with `queueLength > 0`.

5. **Full re-sync does not dequeue.** It resets the pull cursor and merges; it does not clear dirty/outbox. By design for empty-cloud safety; repair must go through push ack or integrity-proven already-present reconcile (Fix sync / worker).

---

## DATA AT RISK

| Asset | Risk from this bug | Status |
|-------|--------------------|--------|
| Attendance note bodies | **Not wiped** — fake pending is metadata desync | Preserved |
| Soft-deleted tombstones | Same | Preserved |
| Cloud SoT | Already complete (114) on field device | Intact |
| Local dirty flags / outbox | Stale; blocked honest “synced” UX | Fixed by reconcile |
| False clear on empty cloud | Was the danger of weakening `written:0` | Mitigated: require cloud **sync id set** covering pushed ids |

---

## FIXES

1. **`lib/staleOutboxReconcile.js`** — pure gates: empty-write detection, unique pending case count, `shouldConfirmAlreadyPresent` (requires cloud id set; refuses localOnly / empty cloud / missing ids).
2. **`mayClearOutboxEntry`** — allows clear only when `alreadyPresentInCloud && integrityClean` (in addition to durable `written ≥ sent`).
3. **`main/syncWorker.js`** — on `PUSH_INCOMPLETE` + empty write, if `getCloudPresenceProof` proves every pushed `sync_id` is in cloud → markSynced / clear dirty; log `[SYNC-RECONCILE]` (no note bodies). Honest cycle reason when outbox remains but nothing was due.
4. **`main.js`** — persist `lastVerifiedCloudSyncIds` on pull (replace on from-epoch, merge incremental); wire `getCloudPresenceProof` into worker; integrity check uses persisted ids; sync-status exposes `pendingCaseCount`.
5. **`lib/syncHealth.js` + `lib/footerStatusChips.js` + `app.js`** — pending uploads = unique cases, not dirty+queue sum. Fix sync remains the preferred heal (uses same worker path; **not** reuploadAll).

**Not done (by design / follow-up):** auto Keep-local; reuploadAll as default heal; client wipe to green the report.

---

## FILES

| File | Change |
|------|--------|
| `lib/staleOutboxReconcile.js` | **New** — reconcile + pending case helpers |
| `lib/syncMutationId.js` | already-present ack path |
| `lib/syncHealth.js` | `pendingCaseCount` / honest `pendingUploads` |
| `lib/footerStatusChips.js` | unique case footer count |
| `main/syncWorker.js` | empty-write reconcile; honest skip reason |
| `main.js` | cloud sync id persistence; proof; status; integrity |
| `app.js` | diagnostics copy uses case counts |
| `tests/staleOutboxReconcile.test.js` | **New** regressions |
| `tests/footerStatusChips.test.js` | double-count regression |
| `docs/data-safety/STALE-OUTBOX-INTEGRITY-REPORT-2026-09-15.md` | this report |

---

## DB CHANGES

- **No schema migration.**
- New settings key: `lastVerifiedCloudSyncIds` (JSON array of sync ids, capped at 5000).
- Existing: `lastVerifiedCloudInventory`, `sync_queue`, `sync_dirty` semantics unchanged except clear path for proven already-present.

---

## ARCHITECTURE

```
Renderer (UI) → preload IPC → main
  Local durable: attendances.db (CNDB) + sync_dirty + sync_version
  Durable outbox: sync_queue (mutation_id)
  Push → /api/sync/push → require written≥sent OR integrity-proven already-present
  Pull → merge-only; persist inventory + cloud sync id set
  Backup scheduler / AWS entitlement / server sot-pitr = independent of live SoT
```

---

## SoT

- **Local durable DB** = working copy + outbox (required before “Safe locally”).
- **Central `/api/sync` (licence-scoped)** = account Source of Truth.
- **Outbox** survives restart; clear only after confirmed write **or** cloud-id-proven already-present empty-write.
- **Backup / PITR** ≠ sync SoT (footer “Backup queued” is separate from sync pending).

---

## TESTS

| Suite | Result |
|-------|--------|
| `tests/staleOutboxReconcile.test.js` | pass |
| `tests/footerStatusChips.test.js` | pass |
| `tests/emptySyncRecovery.test.js` | pass (written:0 without proof still retains dirty) |
| `tests/dataSafety.architecture.test.js` | pass |
| `tests/dataSafety.faultInjection.test.js` | pass |
| `tests/silentSyncDeath.test.js` | pass |
| `tests/syncWorker.test.js` / `syncEngine.test.js` | pass |
| `tests/attendanceDurability.test.js` | pass |
| `tests/staleSyncCatchUpRunner.test.js` | pass |

**Invariants covered:** refuse bare written:0; confirm only with cloud id coverage; refuse localOnly / empty cloud / ok:false; unique pending cases; Fix sync drains via reconcile; no reuploadAll default.

---

## RESULTS counts

- Targeted + related sync suites run this agent: **193+** assertions across listed files, **0 fail**.
- Field-scale reconciliation (Robsprgr numbers): with cloud id set of 114 and empty-write pushes, unique pending should drain to **0** via Fix sync / sync cycles — not stay at 139.

---

## FAULT-INJECTION

| Injection | Expected | Covered |
|-----------|----------|---------|
| `ok:true written:0` + cloud ids cover | clear dirty | yes |
| `ok:true written:0` + id missing / localOnly | retain dirty | yes |
| `ok:false` | retain dirty | yes |
| Omitted written | refuse (existing assertPushAccepted) | yes |
| Rate limit 429 | retain; no false confirm | existing suites |
| Empty cloud inventory | refuse confirm | yes |
| Crash mid-push | dirty retained until ack (existing outbox) | existing |

Multi-device metal kill-9 / live network: harness-limited; not claimed green here.

---

## RECONCILIATION numbers (field model)

| Metric | Before (1.9.101 field) | After fix (expected) |
|--------|------------------------|----------------------|
| Cloud inventory | 114 | 114 |
| localOnly | 0 | 0 |
| pendingUploads (UI) | ~139 (40+99) | unique cases → 0 after reconcile |
| dirty / queue | stuck | cleared for ids in cloud set |

---

## BACKUP TEST

Not re-run end-to-end in this change (backup path untouched). Existing `footerStatusChips` backup-queued vs sync separation tests still pass. Sync heal does **not** delete backup files.

---

## REMAINING RISKS

1. **Cloud id set incomplete until from-epoch / first pull with records** after upgrade — Fix sync after Full re-sync populates ids; incremental-only devices may need one Full re-sync to enable reconcile. **Sev3.**
2. **Server `written:0` semantics** if ever meaning “rejected newer local” while id still in cloud — gate is presence not version equality. Prefer server return explicit already-present ack later. **Sev3 / monitor.**
3. **Orphan queue rows** without matching dirty still count toward unique cases until drained/failed GC. **Sev3.**
4. Residual items from `docs/data-safety/REMAINING-RISKS.md` (429 budget, key escrow, etc.) unchanged.

No open Sev1/Sev2 for this failure class after the fix.

---

## PRODUCTION READINESS

**PASS**

(For the Robsprgr stale-outbox / fake-pending class and counter honesty. Ship via CI → then bump **1.9.102** + changelog as a second step.)
