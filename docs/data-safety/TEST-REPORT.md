# TEST-REPORT — Data safety

**Command:** `npm run test:data-safety`  
**Also covered by:** `npm run test:unit` (includes `tests/dataSafety.architecture.test.js`)  
**CI:** `.github/workflows/test.yml` → “Data-safety gate” step (blocks PR/release path on failure)

## Suites included in the gate

1. `tests/dataSafety.architecture.test.js` — Force Save states, mutation IDs, outbox restart semantics, absence≠delete, tombstones, monitors, backup gate, revisions, 429/ack properties, migration v4  
2. `tests/attendanceDurability.test.js` — durable flush, empty-cloud preserve, soft-delete  
3. `tests/saveNowDurability.test.js` — Save now IPC + UX wiring  
4. `tests/emptySyncRecovery.test.js` — empty-cloud / re-upload / inventory honesty  
5. `tests/backupPathAndGenerational.test.js` — cross-platform path reset + generational backups  

## Acceptance mapping

| Criterion | Coverage |
|-----------|----------|
| Durable local before “safe” | Force Save + attendanceDurability flushDbSync |
| Outbox survives restart | sync_queue + flushDb on enqueue + mutation_id test |
| One central account SoT | Architecture docs + per-record push (no whole-DB LWW) |
| Stale device cannot erase | `staleDeviceAbsenceMayEraseCentral()===false` + preserve guards |
| Absence ≠ delete | tombstoneRules + empty cloud policy |
| Tombstones | evaluateTombstoneApply + soft-delete path |
| Force Save local vs central | forceSaveStatus + persist-and-backup drain |
| Independent historical backup | backupIntegrityGate + generational tests |
| Empty/failed cloud non-destructive | emptyCloudPullPolicy + emptySyncRecovery |
| CI data-safety gate | workflow step + package script |

## Latest local run (this PR)

```
npm run test:data-safety
# tests 98 | pass 98 | fail 0

npm run test:unit
# tests 2063 | pass 2061 | fail 0 | skipped 2
```

