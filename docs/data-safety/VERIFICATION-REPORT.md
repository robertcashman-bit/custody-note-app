# CUSTODYNOTE DATA SAFETY VERIFICATION

**Date:** 2026-09-10  
**App version under test:** 1.9.92 (stacks on 1.9.91 empty-cloud auto-heal + silent-cycle heartbeat)  
**Branch base:** `cursor/fix-cloud-sync-silent-death-6c81` (PR #42)  
**Overall rating:** **AMBER**  
**Commercial release for data protection?** **YES — with listed residuals** (ship 1.9.92; do not market as absolute zero-risk)

---

## Executive verdict

Critical silent-loss routes exercised in the deterministic harness are closed or fail-closed (retain local / refuse wipe / refuse false “Saved”). Account-level central SoT is **proved** in-repo (licence-scoped mock API + push payload contract). Full packaged dual-OS E2E against live production S3/PITR was **not** run from this agent (no production wipe; website repo private) — hence overall **AMBER**, not GREEN.

| Gate | Result |
|------|--------|
| `npm run test:data-safety` | **181 pass / 0 fail** (repeated 3× at 180; final +1 wiring assert → 181) |
| CI workflow includes gate | `.github/workflows/test.yml` → Data-safety gate |
| Bugs autofixed this pass | Flush timeout dirty restore; post-flush CNDB magic gate; wrong written-ID ack rejection |
| Never-event invariant (canaries) | Pass (chaos seed `20260910`; scale **1000** canaries) |

---

## Persistence architecture map (real stack)

```
Renderer (app.js) ──IPC──► Main (main.js)
                              │
                              ▼
                    sql.js in-memory DB
                              │ flushDbSync / atomic write
                              ▼
              userData/attendances.db  (encrypted CNDB)
                 Win: %APPDATA%/custody-note/
                 Mac: ~/Library/Application Support/custody-note/
                              │ enqueue mutation_id
                              ▼
                    sync_queue outbox (persistent)
                              │ syncWorker pushRecordBatch
                              ▼
         custodynote.com POST /api/sync/push|pull
         Auth: normalised licence key → server licence.hash
         machineId = metadata only (NOT SoT namespace)
                              │
              ┌───────────────┼────────────────┐
              ▼               ▼                ▼
     Live SoT (per syncId)  Managed AWS     Server sot-pitr/{userId}/
     licence-hash scoped    backup prefix   (website; independent PITR)
              │
              ▼
     Client PITR: userData/Backups/* + optional OneDrive/offsite folder
```

**Ideal vs real:** Ideal chain matches. Real differences: (1) live SoT S3 key strings live in private website `aws.ts` — client only sends `{ key, machineId, records }`; (2) managed AWS backup ≠ sync SoT; (3) `sot-pitr` is website-owned and was not live-probed here.

**ONE account-level central SoT?** **YES (proved in harness).** Mock server stores by uppercased licence key; Mac `machineId` push is visible to Windows `machineId` pull; other licence rejected. Client never namespaces records by device.

---

## Bugs found and fixed (this verification)

| Defect | Impact | Fix |
|--------|--------|-----|
| `flushDbAsyncBounded` cleared `_dbDirty` then timed out without restoring dirty | Quit/force-lock could treat unconfirmed flush as durable | `lib/flushDirtyPolicy.js` + restore dirty on timeout/fail in `main.js` |
| Force Save `noteDurable` used `existsSync` only | Corrupt/non-CNDB file could still look “Safe locally” | Post-flush `verifyEncryptedBackupFile` + `evaluatePostFlushDurability` |
| `assertPushAccepted` accepted written ID arrays by **length** only | Padded/wrong syncId lists could clear unrelated outbox rows | `normalizeWrittenAck` + expectedSyncIds; worker clears only matching IDs |

---

## Test evidence

```text
Command: npm run test:data-safety
Files: dataSafety.* + attendance/saveNow durability, emptySyncRecovery,
       backupPathAndGenerational, footerStatusChips, silentSyncDeath,
       syncStress, crossDeviceSync, p0SecurityDurabilityFixes
Runs: 3 consecutive
Result each run: tests 180 / pass 180 / fail 0 (final gate after wiring assert: **181 / 181**)
Chaos seed: 20260910
Canary scale: 1000 records pushed via syncWorker → mock SoT
```

---

## A–N answers (required)

| # | Question | Answer | Evidence |
|---|----------|--------|----------|
| **A** | Local save durable before UI safe? | **YES** | `flushDbSync` + attendance-save durability tests; Force Save magic verify |
| **B** | Force Save distinguishes local vs central? | **YES** | `lib/forceSaveStatus.js` states; UI matrix tests; no bare “Saved” |
| **C** | Offline: local retained, outbox survives? | **YES** | Force Save `waiting_for_internet`; restart/outbox tests |
| **D** | Restart / force-quit simulation keeps dirty+queue? | **YES** | sql.js export/reopen + ambiguous ack retains dirty |
| **E** | Lost/ambiguous ack does not clear outbox? | **YES** | `isAmbiguousPushAck` / `mayClearOutboxEntry` / worker |
| **F** | Mutation idempotency (stable mutation_id)? | **YES** | `buildMutationId` + enqueue tests |
| **G** | Stale device absence cannot delete newer records? | **YES** | `staleDeviceAbsenceMayEraseCentral()===false`; pull guards |
| **H** | Empty/failed response ≠ empty authoritative dataset? | **YES** | `emptyCloudPullPolicy`; emptySyncRecovery; auto-heal (1.9.91) |
| **I** | Tombstones require matching sync_id? | **YES** | `tombstoneRules` / architecture suite |
| **J** | Restore refuses empty-over-live? | **YES** | `mayRestoreBackupOverLive` |
| **K** | PITR independent of live SoT? | **YES (client proved; server documented)** | Generational Backups + integrity gate; website `sot-pitr` docs (not live-probed) |
| **L** | Disk-full / write-fail must not show Saved? | **YES** | Dirty restore policy + `attention_required` |
| **M** | No silent DB reset / Mac↔Win same SoT? | **YES** | Preserve guards; licence-scoped SoT Mac/Win pull test |
| **N** | Auth expiry / 429 never drop mutations? | **YES** | Rate-limit gate + outbox retain; Force Save sync_problem_local_safe |

---

## Remaining gaps (why not GREEN)

1. **Live production S3 / website sot-pitr** not exercised (private website; preserve-first — no real user DB wipe).  
2. **Packaged Electron kill -9 / dual physical OS** E2E not in this CI agent.  
3. **Force Save drain** still capped (`maxCycles: 3`) — large backlogs stay honestly pending.  
4. **Original Costachi never-flushed bytes** not recoverable.  
5. **Operator console** for monitors still AMBER.

---

## Mac impact / Windows impact

Identical custody data-safety behaviour and licence-scoped SoT. Platform differences remain OS paths / safeStorage / updater only.

---

## Commercial readiness

Ship **1.9.92** as data-protection **AMBER→commercially acceptable YES** with residuals above. Do not claim GREEN absolute until live server PITR + dual-OS packaged chaos are evidenced in a controlled non-production licence.
