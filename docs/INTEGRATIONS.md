# Integrations

## QuickFile

**Preferences** (fee earner defaults, billing rates, UI options, etc.) sync through `POST /api/settings/quickfile`. The blob is encrypted with the **licence key** and must never contain API secrets.

**QuickFile credentials** (account number, API key, application ID) sync separately:

1. The server holds a random **per-account wrap key** (`/api/account/quickfile-wrap-key`), released only after licence validation/sign-in and **active device registration** (same 5-computer rules as record sync). Revoked devices must not receive the wrap key.
2. The client encrypts credentials with that wrap key and stores ciphertext at `POST /api/settings/quickfile-credentials` (account-scoped, not licence-key scoped).
3. Knowing a licence key string alone cannot decrypt credentials — the wrap key is not derivable from the licence key.

Enter credentials once in **Settings → Integrations → QuickFile** on any activated computer; they are pulled automatically on startup, when you open Settings, and before billing.

**Firms** imported from QuickFile (and firms you add manually) sync via `/api/sync/firms/push` and `/api/sync/firms/pull` with automatic merge on the same account.

**OpenAI API key** (Law / Elements fill) uses the same per-account wrap key and device gate:

1. Encrypted locally with OS storage (`safeStorage`) under user data (Store and direct builds share the same path when not virtualised).
2. Ciphertext syncs at `POST /api/settings/openai-api-key` — never in `/api/settings/quickfile`.

Enter the key once on any activated computer; it is pulled on startup and when you open Settings.

Diagnostic logs (counts and error classes only, no secrets): `logs/quickfile.log` in app user data.
