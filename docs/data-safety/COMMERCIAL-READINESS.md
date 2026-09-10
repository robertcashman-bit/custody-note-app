# COMMERCIAL-READINESS — Data protection

**Overall rating: AMBER**

## Basis

| Area | Rating | Basis |
|------|--------|-------|
| Local durability before user “safe” | GREEN | flushDbSync on all saves (1.9.85) + Force Save verified flush |
| Honest local vs central status | GREEN | Force Save state machine; no bare “Saved” |
| Persistent outbox + ack gating | GREEN | sync_queue + mutation_id + written ack; tests |
| Absence ≠ delete / tombstones | GREEN | Explicit rules + pull guards + tests |
| Empty / failed cloud non-destructive | GREEN | Preserve policy + empty-cloud alarm lineage |
| Independent PITR (client) | AMBER | Generational verified backups + integrity gate; retention finite; server PITR absent |
| Server-side SoT PITR / escrow snapshots | RED → gap | Not in this repo; document for website/API follow-up |
| Fail-safe monitors | AMBER | Detected + logged/IPC alert; not yet a full operator console |
| CI gate | GREEN | `npm run test:data-safety` in Test workflow |
| Costachi never-event closure | AMBER | Class mitigated; original bytes not recoverable |

## Ship posture

Commercially defensible to ship **1.9.86** as an incremental reliability release with clear AMBER caveats: client-side SoT+outbox+PITR contract is strong; **server historical snapshots** and full operator monitoring remain follow-ups. Do not claim “cloud backup” as sync SoT in marketing without the status model language.

## Mac impact / Windows impact

Identical custody data-safety behaviour on both platforms. Path sanitisation and backup folder reset remain the only OS-integration differences; sync SoT is licence-scoped for both.
