# Website SoT PITR — companion contract (app → website)

The desktop app cannot clone `robertcashman-bit/custody-note-website` from this
agent token (GitHub 404). Server `sot-pitr/{userId}/` remains website-owned.

## Client contracts proved in this repo

Run:

```bash
npm run test:data-safety
```

Relevant assertions live in:

- `lib/serverPitrContract.js` — empty/failed response ≠ wipe; prefix independence; restore scoring
- `lib/backupIntegrityGate.js` — refuse empty-over-live
- `tests/dataSafety.greenCloseout.test.js` — PITR contract suite
- `tests/dataSafety.faultInjection.test.js` — account-level SoT Mac↔Win

## Exact website commands (run when repo is available)

```bash
git clone git@github.com:robertcashman-bit/custody-note-website.git
cd custody-note-website
npm ci
npm test
# Prefer data-safety / PITR filters when present:
npm run test:data-safety || true
npx --yes node --test $(find tests -name '*pitr*' -o -name '*sot*' -o -name '*data-safety*' | tr '\n' ' ')
```

Expected website invariants (must stay true):

1. Live KV SoT key prefix ≠ `sot-pitr/` snapshot prefix  
2. Empty/failed pull must not zero inventory for wipe purposes without from-epoch proof  
3. Restore of empty/corrupt snapshot over live>0 refused  
4. Snapshots are push-debounced + hourly; retention independent of live deletes  

Document pass counts from the website run into
`docs/data-safety/VERIFICATION-REPORT.md` when available.
