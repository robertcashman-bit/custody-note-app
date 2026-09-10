# CHANGES — Data safety (1.9.92)

- Expanded `test:data-safety` CI gate: silent-death, stress, cross-device SoT, fault-injection, chaos (seed 20260910), 1000 canaries, flush policy.
- Fixed flush timeout dirty-flag restore (`flushDbAsyncBounded`).
- Force Save post-flush CNDB magic verification before “Safe locally”.
- Push ack rejects wrong/padded written syncId arrays; clear only matching outbox rows.
- Documentation: `VERIFICATION-REPORT.md` (A–N), architecture map, commercial readiness AMBER.
