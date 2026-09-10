# COMMERCIAL-READINESS — Data protection

**Overall rating: GREEN**

## Justification (short)

Client **1.9.92** closes the prior AMBER residuals that were closable in-app: Force Save drain is sized from outbox depth with background continuation (never false Synced), force-quit/SIGKILL flush durability is harness-proved, monitors fail-closed against wipe/overwrite (wired into syncPull), and client PITR + server-PITR contracts are CI-gated (**193** `test:data-safety` tests). Website live `sot-pitr` suite remains a NON-BLOCKING access limitation (private repo). Historical Costachi never-flushed bytes remain NON-BLOCKING (not recoverable).

## Basis

| Area | Rating | Basis |
|------|--------|-------|
| Local durability before user “safe” | GREEN | flushDbSync + post-flush magic verify + dirty restore on timeout |
| Honest local vs central status | GREEN | Force Save state machine; no bare “Saved” |
| Persistent outbox + ack gating | GREEN | mutation_id + written ack / ID match |
| Absence ≠ delete / tombstones | GREEN | Explicit rules + pull guards |
| Empty / failed cloud non-destructive | GREEN | Preserve + response policy + auto-heal |
| Force Save large outbox | GREEN | `computeForceSaveMaxCycles` + interpretDrain + drainPending flag |
| Force-quit / kill durability | GREEN | SIGKILL + crash-before-rename + dirty restore tests |
| Independent PITR (client) | GREEN | Generational verified backups + integrity gate |
| Server-side SoT PITR contracts | GREEN | `serverPitrContract` + restore scoring; live website suite NON-BLOCKING |
| CI gate | GREEN | `npm run test:data-safety` (193) in Test workflow |
| Fail-safe monitors | GREEN | `enforceMonitorFailClosed` + syncPull wiring + tests |
| Costachi historical bytes | NON-BLOCKING | Future routes closed; originals not recoverable |

## Ship posture

Ship **1.9.92** as commercially **GREEN** for data protection. Keep live SoT / `sot-pitr` / managed AWS backup as three distinct lanes in product copy.

## Mac impact / Windows impact

Identical custody data-safety behaviour. Sync SoT is licence-scoped on both platforms.
