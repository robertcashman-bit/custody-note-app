# COMMERCIAL-READINESS — Data protection

**Overall rating: AMBER** (commercially shippable **YES** with residuals)

## Justification (short)

Client **1.9.92** delivers durable local flush with post-flush CNDB verify, Force Save local-vs-central status, persistent outbox with mutation IDs / written-ack gating (including written-ID array match), absence≠delete tombstones, fail-safe monitors, generational verified backups, empty-cloud auto-heal + silent-cycle heartbeat (1.9.91), and an expanded blocking `test:data-safety` CI gate (**181** tests: chaos, never-event, 1000 canaries, Mac/Win SoT). Website server SoT PITR remains documented in the website repo but was **not live-probed** in this verification agent — overall stays **AMBER**, not GREEN.

## Basis

| Area | Rating | Basis |
|------|--------|-------|
| Local durability before user “safe” | GREEN | flushDbSync + post-flush magic verify + dirty restore on timeout |
| Honest local vs central status | GREEN | Force Save state machine; no bare “Saved” |
| Persistent outbox + ack gating | GREEN | sync_queue + mutation_id + written ack / ID match |
| Absence ≠ delete / tombstones | GREEN | Explicit rules + pull guards + tests |
| Empty / failed cloud non-destructive | GREEN | Preserve + auto-heal lineage |
| Independent PITR (client) | GREEN | Generational verified backups + integrity gate |
| Server-side SoT PITR | AMBER | Documented on website; not live-verified here |
| CI gate | GREEN | `npm run test:data-safety` (181) in Test workflow |
| Fail-safe monitors (operator UX) | AMBER | Detected + logged/IPC; no full operator console |
| Costachi never-event (original bytes) | AMBER | Class mitigated going forward; originals not recoverable |

## Ship posture

Ship **1.9.92**. Keep live SoT / `sot-pitr` / managed AWS backup as three distinct lanes in product copy.

## Mac impact / Windows impact

Identical custody data-safety behaviour. Sync SoT is licence-scoped on both platforms.
