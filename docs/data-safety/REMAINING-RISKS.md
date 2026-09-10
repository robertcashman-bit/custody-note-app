# REMAINING-RISKS

Honest residual risks after v1.9.86 data-safety hardening (client) + website server SoT PITR.

## Closed / reduced

| Risk | Status |
|------|--------|
| **Server SoT PITR absent** | **Closed / reduced.** Website implements independent S3 snapshots under `sot-pitr/{userId}/` with list/create/restore APIs, push-debounced snapshots, hourly cron, retention (48h hourly + 30d daily), and fail-safe restore. See website `docs/data-safety/SERVER-PITR.md` and [custody-note-website PR #10](https://github.com/robertcashman-bit/custody-note-website/pull/10). This lane is **not** live KV SoT and **not** managed AWS cloud-backup entitlement. |

## True residuals

1. **Original Costachi bytes** — Not recoverable if never flushed; this release prevents the class of loss going forward, it does not resurrect absent originals.  
2. **Large outbox Force Save** — Save Now drains a bounded number of sync cycles; very large dirty sets may remain pending with honest “Syncing / Sync problem — local copy safe” status.  
3. **429 budget** — Shared push/pull rate limit can still delay central confirmation; local + outbox remain authoritative until ack.  
4. **Key/escrow** — Cross-platform safeStorage / master.fallback issues can block decrypt of envelopes; fail-safe keeps local but sync stalls until recovery password/key path works.  
5. **Client revision history** — Metadata/hash only; in-app field-level undo is not shipped — recovery uses generational CNDB and/or server `sot-pitr` restore.  
6. **Operator error** — Explicit restore of a chosen (non-empty) backup or SoT PITR snapshot can still replace live data after confirmation; empty-over-live remains refused on the client gate.  
7. **Website/API drift** — If production API weakens `written` semantics, client guards fail closed (dirty retained) but central SoT may lag until fixed server-side.  
8. **Operator console** — Fail-safe monitors alert via log/IPC; there is not yet a full admin operator console for cross-device incident triage.
