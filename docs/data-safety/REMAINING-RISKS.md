# REMAINING-RISKS

Honest residual risks after v1.9.86 data-safety hardening (client) + website server SoT PITR.

## Closed / reduced

| Risk | Status |
|------|--------|
| **Server SoT PITR absent** | **Closed / reduced.** Website implements independent S3 snapshots under `sot-pitr/{userId}/` with list/create/restore APIs, push-debounced snapshots, hourly cron, retention (48h hourly + 30d daily), and fail-safe restore. See website `docs/data-safety/SERVER-PITR.md` and [custody-note-website PR #10](https://github.com/robertcashman-bit/custody-note-website/pull/10). This lane is **not** live KV SoT and **not** managed AWS cloud-backup entitlement. |

## True residuals (NON-BLOCKING)

1. **Original Costachi bytes** — Not recoverable if never flushed; GREEN means future silent-loss routes closed, not resurrection.  
2. **Website live sot-pitr suite** — Private website repo not cloneable from verification agent; client contracts proved (`lib/serverPitrContract.js`); run commands in `WEBSITE-PITR-CONTRACT.md` when access exists.  
3. **Dual physical Mac+Windows kill-9** — In-process SIGKILL + durability harness covers the claim; optional ops validation on metal.  
4. **429 budget** — Shared push/pull rate limit can still delay central confirmation; local + outbox remain authoritative until ack.  
5. **Key/escrow** — Cross-platform safeStorage issues can stall decrypt; fail-safe keeps local.  
6. **Client revision history** — Metadata/hash only; recovery via generational CNDB and/or server `sot-pitr`.  
7. **Operator error** — Explicit restore of a chosen non-empty snapshot can still replace live after confirmation; empty-over-live refused.  
8. **Website/API drift** — If production weakens `written` semantics, client fails closed (dirty retained).
