# CHANGES — Data-safety architecture (v1.9.86)

## Why

Commercially defensible data protection after the Costachi never-event: separate central SoT from independent PITR; Force Save must prove local durability and attempt central ack with honest status; absence≠delete; CI gate.

## Files changed

### New modules
| File | Purpose |
|------|---------|
| `lib/forceSaveStatus.js` | Force Save state machine + non-ambiguous UX copy |
| `lib/syncMutationId.js` | Idempotent mutation IDs; ack-before-clear |
| `lib/tombstoneRules.js` | Explicit tombstone vs absence rules |
| `lib/dataSafetyMonitors.js` | Fail-safe monitors (count drop, empty cloud, etc.) |
| `lib/recordRevisions.js` | Pragmatic local revision metadata/hash history |
| `lib/backupIntegrityGate.js` | Independent PITR integrity / refuse empty restore |
| `scripts/run-data-safety-tests.js` | `npm run test:data-safety` runner |
| `tests/dataSafety.architecture.test.js` | Acceptance suite |
| `docs/data-safety/*` | Incident, architecture, tests, risks, readiness |

### Hardened
| File | Change |
|------|--------|
| `lib/saveNowResult.js` | Delegates to Force Save status (Safe locally / central confirmed) |
| `lib/syncLocalPreserve.js` | Tombstone rules wired into destructive-pull detection |
| `main/syncWorker.js` | mutation_id on enqueue; ambiguous ack → retry; markSynced gated |
| `main/dbMigrations.js` | v4: mutation_id, record_revisions, safety baseline setting |
| `main.js` | Force Save: flush → backup → drain sync → status; revision append; pull gates |
| `app.js` | UI: Safe locally / central confirmed; no bare “✓ Saved” |
| `package.json` | `test:data-safety`; version 1.9.86 |
| `.github/workflows/test.yml` | Data-safety gate before e2e |
| `tests/saveNowDurability.test.js` | Expect Safe locally wording |
| `tests/attendanceDurability.test.js` | Expect Safe locally wording |
| `tests/dbMigrations.test.js` | Assert v4 tables/columns |

## Smallest robust fix rationale

Builds on 1.9.85 durability work without rewriting the sync engine. Adds explicit status, mutation IDs, monitors, revision metadata, backup gate, and a blocking CI suite proving the invariants.
