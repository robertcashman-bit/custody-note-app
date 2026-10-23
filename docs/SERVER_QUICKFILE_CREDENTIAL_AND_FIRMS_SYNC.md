# custodynote.com — server/API work (QuickFile credentials + firms)

Deploy from **custody-note-website** (Vercel). Client changes in this app repo ship first; server endpoints must exist before credential sync works in production.

## 1. Per-account wrap key

**Route:** `POST /api/account/quickfile-wrap-key`

**Auth:** Same as record sync — validate licence key, Bearer token when present, `machineId`, and **active device** on the account (5-computer limit). Return `403` + `code: DEVICE_REVOKED` or `DEVICE_NOT_ACTIVATED` when appropriate (revoked devices must not receive the key).

**Body:** `{ key, machineId, accountId? }`

**Response (success):** `{ ok: true, wrapKeyHex: "<64 hex chars>" }` — 32-byte random key, stable per account (create on first authorised request).

**Storage:** One `wrapKeyHex` (or raw 32 bytes) per `accountId` in your account store — never derived from licence key, never logged.

## 2. Credential ciphertext blob

**Route:** `POST /api/settings/quickfile-credentials`

**Auth:** Same device gate as wrap key for both read and write.

**Push body:** `{ key, machineId, accountId?, blob }` → `{ ok: true, updatedAt }`

**Pull body:** `{ key, machineId, accountId? }` → `{ ok: true, blob, updatedAt }` or `{ ok: false, error }` when empty.

**Storage:** One opaque `blob` per `accountId` (replace on push). Server never decrypts.

## 3. Firms sync

**Routes:**

- `POST /api/sync/firms/push` — `{ key, machineId, accountId?, firms: [{ syncId, envelope, encrypted, updatedAt, version }] }` → `{ ok: true, written }`
- `POST /api/sync/firms/pull` — `{ key, machineId, accountId?, since }` → `{ ok: true, firms: [...], serverTime }`

**Auth / quota:** Same as `/api/sync/push` and `/api/sync/pull` (account-scoped timeline, device limit).

**Storage:** Per-account firm record store keyed by `syncId` (parallel to attendance sync, separate collection/table).

## 4. OpenAI API key blob

**Route:** `POST /api/settings/openai-api-key`

**Auth:** Same device gate as QuickFile credentials (wrap key + active device).

**Push body:** `{ key, machineId, accountId?, blob, clear?: boolean }` → `{ ok: true, updatedAt }`

When `clear` is true or the decrypted client payload is empty, delete the stored blob.

**Pull body:** `{ key, machineId, accountId? }` → `{ ok: true, blob, updatedAt }` or `{ ok: false, error }` when empty.

**Storage:** One opaque `blob` per `accountId`. Server never decrypts. Uses the same per-account `wrapKeyHex` as QuickFile credentials (`/api/account/quickfile-wrap-key`).

## 5. Preferences blob (unchanged)

`POST /api/settings/quickfile` remains **licence-key-scoped preferences only** (no API secrets). Optionally also index by `accountId` when Bearer auth is present so Store vs direct licence strings on one account see the same preferences — client still decrypts with licence key.

## Migration plan

1. **Deploy server** wrap-key + credentials + firms routes (feature-flag optional).
2. **Release desktop** build with client encrypt/push using wrap key.
3. **Existing users:** No credential blob yet — first machine with credentials saved after upgrade pushes ciphertext; other machines pull on next sign-in/startup.
4. **Legacy mistake blobs:** If any production preferences blob ever contained credentials encrypted with licence key, treat as one-time: do not merge into new credential store; users re-save once or enter on each device.
5. **Revoked devices:** Stop issuing wrap key immediately; optional admin job to rotate wrap key if compromise suspected (forces re-push from an active device).

## Verification

- Active device A saves QuickFile → active device B (different licence key, same account) pulls credentials.
- Revoked device gets 403 on wrap key and cannot pull blob.
- Licence key + blob ciphertext without wrap key does not decrypt in client tests.
