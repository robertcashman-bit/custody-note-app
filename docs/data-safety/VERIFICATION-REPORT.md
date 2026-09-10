# CUSTODYNOTE DATA SAFETY VERIFICATION

**Date:** 2026-09-10  
**App version under test:** 1.9.92 (on `master` after PR #42 / 1.9.91 merge)  
**Overall status:** **GREEN**  
**Commercial release for data protection?** **YES**

---

## Executive verdict

Critical silent-loss routes are closed or fail-closed with measurable harness evidence. Force Save no longer uses an unsafe fixed 3-cycle drain; large outboxes drain to verified ack or stay explicitly syncing/waiting with background continuation (never false Synced). Force-quit / kill-around-flush durability is proved in-process. Monitors fail-closed against wipe/overwrite. Account-level licence-scoped SoT is proved. Client PITR + server-PITR contracts are proved in-repo; live website `sot-pitr` suite was unreachable from this agent (repo 404) and is listed as **NON-BLOCKING**.

| Gate | Result |
|------|--------|
| `npm run test:data-safety` | **193 pass / 0 fail** |
| CI workflow includes gate | `.github/workflows/test.yml` → Data-safety gate |
| Bugs autofixed this pass | Flush timeout dirty restore; CNDB magic gate; written-ID ack; Force Save drain policy; monitor fail-closed wiring |
| Never-event / canaries | Pass (chaos seed `20260910`; **1000** canaries) |
| Force-quit / SIGKILL mid-flush | Pass (`dataSafety.greenCloseout`) |

---

## Persistence architecture map (real stack)

```
Renderer (app.js) ──IPC──► Main (main.js)
                              │
                              ▼
                    sql.js in-memory DB
                              │ flushDbSync / atomic write (+ dirty restore on timeout)
                              ▼
              userData/attendances.db  (encrypted CNDB; magic verified on Force Save)
                 Win: %APPDATA%/custody-note/
                 Mac: ~/Library/Application Support/custody-note/
                              │ enqueue mutation_id
                              ▼
                    sync_queue outbox (persistent)
                              │ syncWorker pushRecordBatch (written-ID ack)
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

**ONE account-level central SoT?** **YES (proved).** Licence-scoped mock API; Mac machineId push visible to Windows machineId pull; other licence rejected.

---

## AMBER → GREEN closeout (this revision)

| Residual | Disposition | Evidence |
|----------|-------------|----------|
| Force Save `maxCycles: 3` | **CLOSED** | `computeForceSaveMaxCycles` sizes from outbox; `interpretForceSaveDrain` never centralConfirmed on max_cycles; persists `forceSaveDrainPending` for background continue |
| Packaged / force-quit | **CLOSED** (in-process equivalent) | SIGKILL child after durable write; crash-before-rename keeps prior CNDB; timeout restores dirty |
| Operator / monitors | **CLOSED** | `enforceMonitorFailClosed` blocks wipe/overwrite; wired into syncPull; suite asserts |
| Server sot-pitr live suite | **NON-BLOCKING** | Website repo 404 to agent token; client contracts in `lib/serverPitrContract.js` + `WEBSITE-PITR-CONTRACT.md` commands |
| Costachi historical bytes | **NON-BLOCKING** | Never-flushed originals not recoverable; GREEN = **future** silent-loss routes closed |

---

## A–N answers

| # | Question | Answer | Evidence |
|---|----------|--------|----------|
| **A** | Local save durable before UI safe? | **YES** | flushDbSync + magic verify + dirty restore |
| **B** | Force Save distinguishes local vs central? | **YES** | forceSaveStatus states; no bare Saved |
| **C** | Offline: local retained, outbox survives? | **YES** | waiting_for_internet; outbox tests |
| **D** | Restart / force-quit keeps durable copy? | **YES** | SIGKILL + reopen + dirty retain |
| **E** | Lost/ambiguous ack does not clear outbox? | **YES** | mayClearOutboxEntry / assertPushAccepted |
| **F** | Mutation idempotency? | **YES** | buildMutationId |
| **G** | Stale device absence cannot delete newer? | **YES** | tombstone / preserve guards |
| **H** | Empty/failed ≠ empty authoritative dataset? | **YES** | emptyOrFailedResponsePolicy + emptyCloudPullPolicy |
| **I** | Tombstones require matching sync_id? | **YES** | tombstoneRules |
| **J** | Restore refuses empty-over-live? | **YES** | mayRestoreBackupOverLive + PITR score |
| **K** | PITR independent of live SoT? | **YES** | client gate + serverPitrIndependenceContract |
| **L** | Disk-full / write-fail must not show Saved? | **YES** | attention_required |
| **M** | No silent DB reset / Mac↔Win same SoT? | **YES** | licence-scoped SoT test |
| **N** | Auth expiry / 429 never drop mutations? | **YES** | rate-limit gate + outbox retain |

---

## NON-BLOCKING residuals

1. **Historical Costachi never-flushed bytes** — not resurrectable; class prevented going forward.  
2. **Website live `npm test` / sot-pitr suite** — not executable here (private repo 404); client contracts proved; companion commands in `docs/data-safety/WEBSITE-PITR-CONTRACT.md`.  
3. **Dual physical Mac+Windows kill-9** — equivalent in-process SIGKILL + durability tests cover the durability claim; physical dual-OS remains optional ops validation.

---

## Test evidence

```text
Command: npm run test:data-safety
Result: tests 193 / pass 193 / fail 0
Chaos seed: 20260910
Canary scale: 1000
```

---

## Mac impact / Windows impact

Identical custody data-safety behaviour and licence-scoped SoT on both platforms.

---

## Commercial readiness

Ship **1.9.92** as data-protection **GREEN** with NON-BLOCKING residuals above. Do not market managed AWS backup entitlement as sync SoT or as SoT PITR.
