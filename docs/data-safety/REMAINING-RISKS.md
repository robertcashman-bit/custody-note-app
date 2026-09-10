# REMAINING-RISKS

Honest residual risks after v1.9.86 data-safety hardening.

1. **Original Costachi bytes** — Not recoverable if never flushed; this release prevents the class of loss going forward, it does not resurrect absent originals.  
2. **Server PITR** — Independent historical recovery on the server (point-in-time snapshots of the account SoT) is **not** implemented in this app repo. Client generational backups + offsite + managed AWS backup are the PITR lanes today.  
3. **Large outbox Force Save** — Save Now drains a bounded number of sync cycles; very large dirty sets may remain pending with honest “Syncing / Sync problem — local copy safe” status.  
4. **429 budget** — Shared push/pull rate limit can still delay central confirmation; local + outbox remain authoritative until ack.  
5. **Key/escrow** — Cross-platform safeStorage / master.fallback issues can block decrypt of envelopes; fail-safe keeps local but sync stalls until recovery password/key path works.  
6. **Revision history** — Metadata/hash only; undo of overwrite still primarily via generational CNDB restore, not in-app field-level rollback UI.  
7. **Operator error** — Manual restore of a chosen backup can still replace live data if the user explicitly confirms a valid non-empty candidate; empty-over-live is refused.  
8. **Website/API drift** — If production API weakens `written` semantics, client guards fail closed (dirty retained) but central SoT may lag until fixed server-side.
