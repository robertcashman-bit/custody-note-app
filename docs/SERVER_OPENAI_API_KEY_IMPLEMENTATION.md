# custody-note-website — OpenAI API key route (add to PR #71)

Mirror `POST /api/settings/quickfile-credentials` with a separate store field per account.

## Route

`POST /api/settings/openai-api-key`

**Auth:** Identical to `/api/settings/quickfile-credentials` (licence key + Bearer when present + `machineId` + active device on account).

**Push:** `{ key, machineId, accountId?, blob, clear?: boolean }`

- Persist opaque `blob` on the account record.
- When `clear === true` or `blob` is omitted after validation, set stored blob to `null`.
- Response: `{ ok: true, updatedAt: ISO }`

**Pull:** `{ key, machineId, accountId? }` (no `blob`)

- Response when present: `{ ok: true, blob, updatedAt }`
- Response when cleared / never saved: `{ ok: true, empty: true, updatedAt }` (include `updatedAt` from last push/clear so clients can drop stale local copies)

**Wrap key:** Reuse existing `/api/account/quickfile-wrap-key` — same `wrapKeyHex` per account (client encrypts `{ openaiApiKey: "..." }` with `lib/quickfileWrapKeyCrypto.js`).

Do not log `blob` contents or decrypted payloads.
