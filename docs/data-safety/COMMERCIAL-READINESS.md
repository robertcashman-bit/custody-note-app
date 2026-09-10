# COMMERCIAL-READINESS — Data protection

**Overall rating: GREEN**

## Justification (short)

Client **1.9.86** delivers durable local flush, Force Save local-vs-central status, persistent outbox with mutation IDs / written-ack gating, absence≠delete tombstones, fail-safe monitors, generational verified backups, and a blocking `test:data-safety` CI gate. Website **server-side SoT PITR** (independent S3 snapshots under `sot-pitr/{userId}/`, list/create/restore APIs, push-debounced + hourly cron, retention 48h hourly + 30d daily, fail-safe restore) is documented in the website repo as `docs/data-safety/SERVER-PITR.md` and tracked in [custody-note-website PR #10](https://github.com/robertcashman-bit/custody-note-website/pull/10). Together, live SoT and independent historical recovery are commercially defensible. SoT ≠ backup language remains mandatory in product copy.

## Basis

| Area | Rating | Basis |
|------|--------|-------|
| Local durability before user “safe” | GREEN | flushDbSync on all saves (1.9.85) + Force Save verified flush |
| Honest local vs central status | GREEN | Force Save state machine; no bare “Saved” |
| Persistent outbox + ack gating | GREEN | sync_queue + mutation_id + written ack; tests |
| Absence ≠ delete / tombstones | GREEN | Explicit rules + pull guards + tests |
| Empty / failed cloud non-destructive | GREEN | Preserve policy + empty-cloud alarm lineage |
| Independent PITR (client) | GREEN | Generational verified backups + integrity gate (refuse empty-over-live) |
| Server-side SoT PITR | GREEN | Website `sot-pitr/` lane — independent of live KV SoT; see SERVER-PITR.md / website PR #10 |
| CI gate | GREEN | `npm run test:data-safety` in Test workflow |
| Fail-safe monitors (operator UX) | AMBER | Detected + logged/IPC alert; not yet a full operator console |
| Costachi never-event (original bytes) | AMBER | Loss class mitigated going forward; original never-flushed bytes not recoverable |

## Ship posture

Ship **1.9.86** as commercially **GREEN** for data protection: client SoT+outbox+PITR contract plus website server SoT PITR. Minor AMBER sub-rows do not overturn overall GREEN. Do not market “cloud backup” entitlement as sync SoT or as SoT PITR — keep the three lanes distinct (live SoT / `sot-pitr` / managed AWS backup).

## Mac impact / Windows impact

Identical custody data-safety behaviour on both platforms. Path sanitisation and backup folder reset remain the only OS-integration differences; sync SoT is licence-scoped for both.
