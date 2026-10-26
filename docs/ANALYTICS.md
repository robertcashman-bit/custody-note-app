# Analytics (privacy-safe)

Custody Note collects **no case content, client names, or note bodies** in product analytics.

## Desktop events (opt-in / aggregated)

| Event | When | Payload (allowed) |
| --- | --- | --- |
| `app_activated` | First Free licence created | `platform`, `appVersion`, `tier=free` |
| `usage_heartbeat` | Packaged launch (every launch attempts flush) + once per UTC day while running | `machineId` (SHA-256 hash, 32 hex), `platform`, `appVersion`, `tier`, `installSource`, `usageDate` (UTC `YYYY-MM-DD`) |
| `first_attendance_created` | First saved attendance | `platform`, `appVersion` only |
| `attendance_finalised` | Finalise action | count only / boolean |
| `pdf_exported` | PDF export | boolean |
| `pro_upgrade_click` | Pricing / upgrade CTA | `source` (settings\|banner\|share) |
| `referral_share` | Share invite text | `channel` (clipboard\|email) |

Implementation notes:

- Existing packaged ping: `POST /api/stats/trial-started` (now may include `tier: free`). One-shot when Free / legacy trial licence is first created.
- Daily usage ping: `POST /api/stats/heartbeat` with `{ machineId, platform, appVersion, tier, installSource, usageDate }`. `installSource` is one of `store` (Windows Microsoft Store / MSIX), `direct` (Windows NSIS), `dmg` (macOS direct download), `mas` (Mac App Store, if ever used), or `unknown`. `usageDate` is the UTC calendar day being reported (`YYYY-MM-DD`), deduped locally and server-side. Packaged builds only; starts a few seconds after launch (also after the main window finishes loading when a window exists); fire-and-forget with 8s timeout and in-session backoff retries. Failed days stay in a local queue in `cn-usage-heartbeat.json` (`pending` by `usageDate`, capped at 14 days) and retry on the next launch, every 4 hours while the app stays open, and when Electron reports the network is back online. Stats POSTs use **Electron `net.fetch`** (Chromium network stack) so **system / PAC proxy** settings apply — not Node `https`. Successful 2xx/204 responses mark that `usageDate` acked; they never block or surface errors to the user. Used by admin stats for unique machines seen in the last 7 / 30 days. Do **not** reuse `trial-started` for this (would inflate unique Free/trial starts). There is **no in-app opt-out** for this anonymous launch ping (separate from opt-in Sentry crash reporting via `CUSTODYNOTE_SENTRY_DSN`).
- Trial-started: same transport and retry rules; `licence.dat` carries `trialStartedPending: true` until the server returns 2xx (writing the licence file is not treated as sent).
- `machineId` is a SHA-256 hash (32 hex chars) of hostname|platform|arch|cpu|totalmem — never a raw hostname or hardware serial.
- `tier` is the current licence tier (`free` / `pro` / `trial`), not always free.
- Do not attach UFN, custody number, officer names, note text, emails, or licence keys.
- Sentry remains separate and opt-in.

## Website (GA4 / Clarity)

Use existing [`lib/cta-analytics.ts`](../custody-note-website/lib/cta-analytics.ts) for Free download and Pro pricing CTAs. Funnel labels:

- `cta_download_free`
- `cta_upgrade_pro`
- `cta_firm_contact`

## Admin

Website admin stats may show Free installs vs Pro conversions from Lemon + trial-started pings. Treat historical “trial” counters as Free activations after freemium launch. Unique active machines (7 / 30 day) come from heartbeat pings, not from trial-started.
