# Data-safety architecture — Custody Note

**Audience:** engineering + reliability  
**Invariant:** Once a record is successfully committed, no sync/restart/upgrade/network/stale-device/conflict may make the last recoverable copy disappear.  
**Absence is not deletion.** Deletion requires an explicit tombstone for a matching `sync_id`.

---

## Layers (must stay separate)

```
┌─────────────────────────────────────────────────────────────┐
│ Renderer (app.js) — UI state only                           │
└───────────────────────────┬─────────────────────────────────┘
                            │ IPC (preload)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Local durable DB (encrypted CNDB / sql.js → attendances.db) │
│  + record_revisions (metadata/hash history)                 │
│  + sync_queue outbox (mutation_id, survives restart)        │
└───────────────────────────┬─────────────────────────────────┘
                            │ push per sync_id (not whole DB)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ CENTRAL ACCOUNT SoT — custodynote.com /api/sync/*           │
│ Licence-key scoped (NOT device-scoped “Mac vs Windows”)     │
└───────────────────────────┬─────────────────────────────────┘
                            │ independent of live SoT
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Independent PITR / historical recovery                      │
│  - Generational local Backups (quick/hourly CNDB verify)    │
│  - Optional offsite folder copy                             │
│  - Managed AWS cloud backup (entitlement) ≠ sync SoT        │
└─────────────────────────────────────────────────────────────┘
```

**Critical separation:** Central sync SoT ≠ folder offsite backups ≠ managed AWS backup entitlement. Folder backups must **not** instantly mirror accidental central damage; they are point-in-time encrypted snapshots.

---

## Where a record can exist

| Location | Role | Authority |
|----------|------|-----------|
| Renderer form memory | Ephemeral UI | Not durable |
| sql.js in-memory DB | Working set | Not durable until flush |
| `userData/attendances.db` (CNDB) | Local durable working copy | Required before “Safe locally” |
| `sync_queue` + `sync_dirty` | Persistent outbox | Survives restart; clear only after ack |
| `record_revisions` | Local overwrite/conflict hints | Metadata + content hash |
| Central `/api/sync` (S3 per syncId) | **Account-level Source of Truth** | Licence hash scoped |
| `userData/Backups/attendance-quick-*.db` | Independent PITR | Generational; verified magic |
| `attendance-backup-*.db` hourly | Independent PITR | Retention window |
| Offsite backup folder | Independent PITR copy | User-configured |
| Managed AWS cloud backup | Disaster recovery product | **Not** sync SoT |
| `sync_conflicts` | Parked remote when local dirty/protected | User resolves |

---

## Force Save / Save Now (required steps)

1. Flush UI → attendance-save (when on form)  
2. Durable local commit + `flushDbSync` verified (`noteDurable`)  
3. Enqueue mutation to persistent outbox (`mutation_id` = sync_id+version+op)  
4. Verified generational backup  
5. Attempt immediate central sync (`drainPendingSyncUploads`)  
6. Require server ack with `written` count (idempotent mutation IDs; ambiguous ack → safe retry)  
7. Update backup integrity snapshot  
8. Show precise status — **never** bare “Saved”:

| State | Meaning |
|-------|---------|
| Attention required | Local durable write failed |
| Safe locally | Disk (+ ideally backup) OK; central not confirmed |
| Waiting for internet | Local safe; offline |
| Syncing | Local safe; push in flight |
| Sync problem — local copy safe | 429/auth/error; local retained |
| Safe locally + central copy confirmed | Local + ack |

Surfaces: last local save, last central sync, pending count, device id.

---

## Sync rules

- **Per-record** upsert by `sync_id` / `sync_version` — **whole-dataset LWW prohibited**  
- Pull is merge-only; empty cloud **preserves** local  
- Soft-delete only via explicit `deleted_at` tombstone for **matching** `sync_id`  
- Stale device absence must not erase newer central or local records  
- Failed cloud reads must **never** be interpreted as empty authoritative dataset for wipe purposes  
- Push clears dirty only when `assertPushAccepted` / `mayClearOutboxEntry` confirms written ≥ sent  

---

## Fail-safe monitors (`lib/dataSafetyMonitors.js`)

Detect and **retain local / do not overwrite known-good** on:

- Sudden local count drop  
- Remote disappear without tombstone  
- Revision going backwards  
- Empty cloud with local data  
- Migration shrink  
- 429 / auth / master key missing / decrypt failure  

---

## Server gaps (honest)

This **app repo** owns the client contract. Server-side PITR snapshots on custodynote.com (if any) are outside this tree unless wired via API. Client implements the strongest local+API contract available:

- Confirmed push ack  
- Empty-cloud alarms  
- Generational verified backups  
- Integrity report IPC (`autoDelete: false`)  

If server snapshot/PITR APIs are added later, they must remain **independent** of live SoT mutation paths.

---

## Mac vs Windows

Custody workflow behaviour is identical. Allowed platform differences are OS integration only (paths, menus, updater teardown). Sync SoT is licence-scoped on both platforms — there is no “Mac backup vs Windows backup” as sync authority.
