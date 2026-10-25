# custody-note-website PR #71 — review notes (agent, 2026-10-25)

This agent **could not clone or call GitHub APIs** for `robertcashman-bit/custody-note-website` (404 from this environment). Review is from the **app contract** in this repo (`docs/SERVER_QUICKFILE_CREDENTIAL_AND_FIRMS_SYNC.md`, `docs/SERVER_OPENAI_API_KEY_IMPLEMENTATION.md`) and merged client code on `cursor/attendance-type-dropdown-5764`.

## Ready checklist for website #71

| Route | Purpose | Backward compatible with app 1.9.120? |
| --- | --- | --- |
| `POST /api/account/quickfile-wrap-key` | Per-account 32-byte wrap key; device gate | **Yes** — unreleased app ignores it; no change to existing routes |
| `POST /api/settings/quickfile-credentials` | Opaque credential blob push/pull | **Yes** — same |
| `POST /api/settings/openai-api-key` | Opaque OpenAI key blob; `empty: true` on pull when cleared | **Yes** — same |
| `POST /api/sync/firms/push` / `pull` | Encrypted firm rows | **Yes** — same |

## Must-haves before production key sync works

1. **Wrap key** stable per `accountId`, never derived from licence key, never logged.
2. **Device gate** identical to record sync (active device, 5-machine limit, `DEVICE_REVOKED` / `DEVICE_NOT_ACTIVATED`).
3. **OpenAI pull when cleared:** `{ ok: true, empty: true, updatedAt }` (not `{ ok: false }`) so clients propagate clears.
4. **Licence validate** returns `accountId` when Bearer/sign-in is used (app persists it for wrap-key requests).
5. **`POST /api/settings/quickfile`** remains preferences-only (no API secrets in licence-key blob).

## Conflict with website `main`

Unknown without repo access. Expect touch points: account store schema, Vercel API routes under `pages/api` or `app/api`, and any existing `/api/settings/quickfile` handler. Merge website PR **before** or **with** the first desktop build that depends on account sync.

## Client graceful degradation (app side, merged)

If wrap-key or OpenAI routes return 404 / HTML error pages, the desktop app:

- Keeps local sealed OpenAI key and QuickFile settings unchanged.
- Shows a clear Settings hint (`openaiApiKeySyncError`) that server sync is not live yet.
- Does not wipe keys or firms.

## Recommended website branch fixes (if not already in #71)

- Integration test or handler test for `openai-api-key` empty pull response shape.
- Ensure route path is **`/api/settings/openai-api-key`** (matches `lib/openaiApiKeySync.js` `BLOB_PATH`).
- Do not require OpenAI blob on credential-only accounts.

Apply fixes on **`cursor/account-qf-firms-sync-013a-e5e1`** (per app PR #119); do not merge/deploy from this agent run.
