# Custody Note — Product / Code Improvement Review

**Date:** 2026-08-19  
**Scope:** `robertcashman-bit/custody-note-app` default branch (`master` @ v1.9.68) + live marketing site `https://custodynote.com`  
**Mode:** Review only — no product/code fixes in this pass  
**Product stance:** Keep free during beta; no billing / Pro / Lemon Squeezy productization unless a genuine copy/code bug

---

## Already in flight — do not duplicate

**OPEN DRAFT PR #4** (`cursor/sync-retry-backoff-6e15`): *fix: sync retry/backoff + harden Anywhere↔Desktop file bridge (keep free)*

| Covered by PR #4 | Notes |
|---|---|
| Sync in-cycle HTTP retry / backoff (push batch + pull) | `main/syncWorker.js` — up to 3 attempts, ~2s/4s/8s + jitter |
| Anywhere↔Desktop JSON bridge hardening | Size/count limits, `safeJsonParse` / validate, idempotent import by `_importedFromAnywhereId`, transaction + `flushDb` + enqueue sync |
| Desktop→Anywhere export IPC + Settings UI | Bidirectional file exchange only |
| Remove Free/Pro upsell from Anywhere settings | Free-tier copy |
| Explicitly skipped | Email-PDF-to-me (no safe SMTP); full encrypted Anywhere cloud sync; billing/Pro/Lemon |

**Residual gaps after PR #4** are called out below (local durability, backup folder creation, batch partial failure, marketing/docs drift, etc.).

---

## P0 — Fix before more beta solicitors rely on this

### Marketing & commercial honesty

| ID | What | Why it matters | Where |
|---|---|---|---|
| **P0-1** | Live site tells three incompatible stories: “free during beta”, “core features free forever”, and “Subscribe for £9.99/month” / “start a Custody Note trial”. Pricing page says Pro is *planned* after beta; `/trial` still pushes subscribe now. | Prospects and firms cannot decide whether this is a beta gift, a forever-free core, or a paid product. Undermines trust for a criminal-defence tool. | `https://custodynote.com`, `/trial`, `/pricing` (website repo); template CTA “Upgrade to Custody Note” / “start a … trial” |
| **P0-2** | In-app Help / licence paste / share card still say **“free forever”** and sell **Pro (£9.99/mo)** while licence banner / tips / PDF footer already say free during beta. Changelog 1.9.61 claimed Free forever was replaced. | Same solicitor sees contradictory offers inside one Settings → Help session. Support load + credibility hit. | `index.html` (~899, ~1501, ~1670–1675, home cloud-backup strip ~241); contrast `renderer/licence.js`, `data/product-tips.json` |
| **P0-3** | Pricing still markets **“Pro AI summaries” / “Available now for Pro”** and “nothing leaves your device”. Changelog **1.9.65 removed** Pro AI summaries in favour of Ask AI / Law fill with the user’s own OpenAI key (data *does* leave the device when used). | Misleading for DPIA / firm IT sign-off; oversells a removed feature; understates US processor exposure. | `https://custodynote.com/pricing` “Shipping now”; `changelog.json` 1.9.65 |
| **P0-4** | Sync marketing is inconsistent: home “Windows; Mac where enabled”, schema “where licensed”, pricing Pro “Sync across your devices (Windows and Mac)” with no caveat. App sync is entitlement-gated, not platform-gated. | Mac solicitors may buy/expect sync that their Free-beta licence does not include — or think Mac is second-class when it isn’t. | Site home / pricing / schema; app cloud-backup entitlement in `main.js` (no darwin gate) |

### Security / privilege / GDPR honesty

| ID | What | Why it matters | Where |
|---|---|---|---|
| **P0-5** | Master-key **cloud escrow is wrapped with the licence key**, not the recovery password. Upload posts `key` + `blob` to `/api/recovery`. UI: “Recover … using your licence key”. | `SECURITY.md` / `PRIVACY_AND_CONFIDENTIALITY.md` claim recovery-password wrap and that the server never sees a usable key. Anyone who can use the licence key (licence DB, support, breach) can unwrap the master key → decrypt sync envelopes / client-encrypted backups. Breaks the zero-knowledge story sold to firms and undercuts LPP / Art 32 narratives. | `lib/keyEscrow.js`; `main.js` `uploadKeyEscrow`; `index.html` Recover from Cloud; docs § escrow |
| **P0-6** | Help / cloud-backup guide claim “We cannot read your backups”, “developers cannot decrypt”, “we never see or store your encryption key”. | Same as P0-5 for firm due diligence. Fix copy to match crypto *or* change wrap to recovery-password (product decision). | `index.html` ~1962; `infrastructure/CLOUD-BACKUP-GUIDE.md`; `SECURITY.md` §80 |
| **P0-7** | Licence settings sync encrypts with the same licence-key model and syncs `openaiApiKey`, QuickFile secrets, `dsccPin`, `feeEarnerSigMaster`, **`scratchpadText`**, templates/workspace. | Server with licence key can recover third-party AI keys, billing credentials, DSCC PIN, and free-text that may be privileged. | `lib/quickfileSettingsSync.js`; `main.js` settings cloud push |
| **P0-8** | Without recovery/admin password, OS lock/suspend shows a **dismissible blanker** labelled “Dismiss (no real client data)” — even when real client data is on screen. | Unattended laptop in a custody suite / chambers: passer-by dismisses overlay and sees privileged notes. Firms may believe OS lock protects the app. | `app.js` `_showCredentialFreeBlanker` (~20120); `onSessionForceLock` path |

### Data durability at the custody desk

| ID | What | Why it matters | Where |
|---|---|---|---|
| **P0-9** | SQLite disk write is debounced **30 seconds** (`DB_SAVE_DEBOUNCE_MS`). `powerMonitor` suspend/lock only force UI lock — **no `flushDbSync()`**. Finalise/complete calls async `flushDb()`, not sync. | Hard kill, BSOD, power cut, or sleep mid-note can lose up to ~30s of typing the UI already showed. Finalise crash window can leave on-disk status as draft. | `main.js` `markDbDirtyForSave` / `flushDb` / `flushDbSync` / `DB_SAVE_DEBOUNCE_MS`; attendance-save ~5582–5584; powerMonitor ~6489–6516 |
| **P0-10** | Default backup folder (`userData/Backups`) is written into settings but **not created** on init. Scheduled quick/hourly backups silently `{ skipped: 'backup-folder-missing' }`. Only **Backup now** `mkdir`s. | Fresh install can look configured while **no** `attendance-latest.db` / hourly archives exist until someone manually backs up. | `main.js` `_defaultBackupFolder`, `initDb` settings insert, `isBackupFolderReady`, `_runQuickBackupAsync`, `backup-now` |

### Desk UX / parity blockers

| ID | What | Why it matters | Where |
|---|---|---|---|
| **P0-11** | Form keyboard shortcuts only check `e.ctrlKey` (Save, ←/→ sections, Ctrl+Enter). Help labels say Ctrl. On Mac, Cmd sets `metaKey` — advertised shortcuts fail. | Mac solicitors (product ships signed Mac builds) cannot use desk-speed shortcuts the Help panel advertises. Parity break. | `app.js` `initKeyboardShortcuts` ~15731–15851; `index.html` kb-help / bottom-bar titles |
| **P0-12** | Ctrl/Cmd+S is labelled **“Save & exit”** / “Save and exit” but only calls `quietSave()` — no exit. | Under time pressure, solicitor believes the note is closed/safe when it is still open and may still be in the 30s flush window. | `index.html` ~630, ~710; `app.js` ~15839–15841 |

### Release / Windows trust

| ID | What | Why it matters | Where |
|---|---|---|---|
| **P0-13** | Windows NSIS installer is **unsigned** in CI (no `CSC_LINK`). Mac is signed + notarised. Download page tells users to click SmartScreen “More info → Run anyway”. | Criminal-defence firms’ IT often blocks unsigned `.exe`. Asymmetric trust vs Mac; friction kills adoption on the dominant OS. | `.github/workflows/release-publish.yml` `release-windows`; `SIGNING.md`; `/trial` SmartScreen copy |

---

## P1 — High impact next

### Reliability (post–PR #4 residuals)

| ID | What | Why | Where |
|---|---|---|---|
| **P1-1** | Push batch is all-or-nothing (≤20). One poison/4xx record fails the whole batch. PR #4 retries transient errors; does **not** add per-`syncId` partial ack. | One bad note delays 19 others on a busy multi-device desk. | `main/syncWorker.js` `pushRecordBatch` / `processBatch`; `docs/SYNC_ARCHITECTURE.md` |
| **P1-2** | `recoverStuckItems` resets `failed`/`blocked` but not stale `syncing`. Mid-session crash can leave orphan syncing until restart + `migrateSyncDirtyToQueue`. | “Pending forever” until reboot — looks broken offline. | `main/syncWorker.js` |
| **P1-3** | `backup-now` returns success after **local** write; managed cloud / URL / offsite uploads are fire-and-forget (URL path has no retry). | Solicitor believes the note is off-machine; only local folder (or nothing — P0-10) has it. | `main.js` `backup-now`, `uploadToCloudIfConfigured`, `uploadToManagedCloudIfEnabled` |
| **P1-4** | Email PDF to me remains save + Outlook Web compose (no attachment via URL). README/Help still imply “email PDF to yourself” / PDFs are “sent”. PR #4 correctly skipped SMTP — **copy must match**. | False expectation of one-click send of privileged PDF. | `README.md`; `index.html` Help; email settings label |

### Security / privacy (continued)

| ID | What | Why | Where |
|---|---|---|---|
| **P1-5** | Outlook path is subject-only URL + **clipboard body** (good vs body-in-URL), but docs still describe body-in-URL + confirmation dialog. Clipboard is the new leak surface (history, other apps). Subject/`to` still in query string. | Stale docs train users wrongly; subjects often include client/offence cues. | `lib/outlookWebCompose.js`; `SECURITY.md` / `PRIVACY` § Outlook |
| **P1-6** | `mailto:` builders still encode **body**; `openEmailDraft` defaults to mailto. Main `open-external` blocks mailto, but hardening still allows validated mailto. Conflicts with Outlook-Web-only policy. | Parallel email path risk; body-in-URI worse than clipboard for proxies/history. | `lib/emailComposeDraft.js`; `preload.js`; `main/windowHardening.js` |
| **P1-7** | OpenAI Ask AI / Law fill: US processor + web search; Ask can send free-text the solicitor types. Under-documented in processors table; “data never leaves the UK” false once AI/GitHub/Outlook used. | Art 9/10 + LPP if users paste instructions; firm Art 30 gaps. | `main/openai*.js`; `PRIVACY_AND_CONFIDENTIALITY.md` §6 vs §2.2 |
| **P1-8** | Settings idle timeout UI defaults select to **`0` / Disabled** when unset (`idleTimeoutMinutes \|\| '0'`), while runtime default is 10 minutes. Saving Settings can persist Disabled. | Easy to turn off idle lock without noticing — unattended privileged screen. | `app.js` ~5867–6139; `index.html` idle select |
| **P1-9** | `master.fallback` wraps key with machine-fingerprint obfuscation (hostname/platform/arch/CPU/mem), not OS keychain strength. | Disk theft / forensic copy of `userData` can decrypt without recovery password if fallback path used. Marketing “AES-256” without this caveat oversells. | `main.js` `_getMachineObfuscationKey` / fallback path |
| **P1-10** | `decryptSyncEnvelope` still accepts legacy **raw JSON** (non-`CNSYNC`) payloads. | Misconfigured/old server data could land cleartext PII on pull. | `lib/syncRecordCrypto.js` |
| **P1-11** | Normative security docs stale: Electron ~28 vs **42.2.0**; “no AI”; PWA still described; Outlook confirmation module gone; escrow model wrong (P0-5). | DPOs relying on `SECURITY_AUDIT_REPORT.md` / `SECURITY.md` get a false picture. | Those docs; `.cursor/rules/custody-note-electron-production.mdc` |

### UX / architecture

| ID | What | Why | Where |
|---|---|---|---|
| **P1-12** | `app.js` is ~20k lines owning form render, shortcuts, finalise, licence UI, home. `renderer/form-renderer.js` is a stub. Custody/voluntary schemas duplicated. | Copy drift (free forever vs beta), shortcut/help mismatches, and section regressions are structural. Hard to review for a legal product. | `app.js`; `renderer/form-renderer.js` |
| **P1-13** | Section 6 Consultation is a mega-form on the critical path (instructions, LAA, signatures, AI, checklists). Marketing sells a tight disclosure→advice→interview→outcome flow; desk reality is 9 sections + Finish-matter. | Slow to scan/tab under custody pressure; pitch vs product gap. | `app.js` `formSections` / `id: 'attend'`; site how-it-works |
| **P1-14** | Parallel finish-matter UIs: overlay `billing.js` + inline `billing-screen.js` + `workflow-stepper.js`. | Inconsistent states/toasts after finalise — risky for LAA handover. | `renderer/views/billing*.js`, `workflow-stepper.js` |
| **P1-15** | Narrow laptop chrome: section sidebar off under ~1200px; bottom nav + form bar steal vertical space on 13″ station laptops. | Orientation cost rises exactly when Wi‑Fi is bad and time is short. | `styles.css` ~5632+ |
| **P1-16** | Dialog a11y incomplete: several overlays lack focus trap; kb-help modal missing dialog role. | Keyboard-only / accessibility failure mid-flow. | `index.html` overlays; workflow overlay |

### CI / release / docs accuracy

| ID | What | Why | Where |
|---|---|---|---|
| **P1-17** | CI Test workflow is **Windows-only** (unit + e2e). No Mac test job; no `check:version`; no `security:audit` on PRs. | Mac Keychain/menu/updater paths untested in CI; version/README drift merges green. | `.github/workflows/test.yml` |
| **P1-18** | `main.js` has ~**51** UTF-8 mojibake lines (`â€”`, `Â£`, box-drawing garbage) including **user-facing** dialogs and billing currency. | Looks unprofessional / broken to solicitors; £ amounts mis-rendered. | `main.js` only (not `app.js`) |
| **P1-19** | README stale: claims **v1.9.67** (app is 1.9.68), “email PDF to yourself” via email client, **speech recognition** (not in code), tag push builds Windows only. | Operators and agents ship wrong mental model. | `README.md`; contrast `package.json` / release workflow |
| **P1-20** | `docs/TRIAL_DISTRIBUTION.md` still promises a **30-day trial**; `FREEMIUM_PHASES_5_8.md` still “Free forever”. | Internal + support docs fight the beta story. | `docs/*` |
| **P1-21** | `auto-tag-release.yml` header still says Mac optional; tags on version/changelog push with **no** preflight tests. | Can tag a broken commit; comments mislead maintainers. | `.github/workflows/auto-tag-release.yml` |

---

## P2 — Important but not desk-blocking

| ID | What | Why | Where |
|---|---|---|---|
| **P2-1** | Sync push path does not write durable `sync_attempts` rows (`logSyncAttempt` used on pull only). | Hard to prove a finalised note left the station PC after a complaint. | `main.js` / `main/syncWorker.js` |
| **P2-2** | Conflict / decrypt stalls are safe (local preserved; cursor not advanced) but easy to dismiss on a busy desk — devices can diverge for a whole shift. | Two-device firms (office + station laptop). | `main.js` `syncPull`; conflict toast in `app.js` |
| **P2-3** | After `markSynced` with version mismatch, correctness depends on a concurrent pending enqueue. Add a safety-net: re-enqueue any `sync_dirty=1` with no pending/syncing row; regression test. | Prevent silent “dirty forever” regressions next to PR #4. | `main/syncWorker.js` |
| **P2-4** | Escrow KDF is PBKDF2-SHA256; local recovery wrap docs say SHA512 — inconsistent. | Crypto hygiene / doc accuracy. | `lib/keyEscrow.js` vs `main.js` |
| **P2-5** | `includeBody: true` still exists on Outlook compose helper — regression surface. | Could reintroduce body-in-URL. | `lib/outlookWebCompose.js` |
| **P2-6** | Built-in admin emails still shipped (`main/licenceAdminEmails.js`). | Governance / revocation needs a release. | That module |
| **P2-7** | Help says “Windows Credential Store” only — Mac Keychain omitted. | Parity/comms. | `index.html` Help |
| **P2-8** | `getFallbackAppDataRoot` has no darwin branch (falls through to XDG). Usually unused if `app.getPath` works; wrong if fallback hits. | Mac data-path footgun. | `main.js` L31–36 |
| **P2-9** | AppUserModelId `com.policestationagent.custodynote` ≠ `appId` `com.custodynote.app`. | Windows toast/pin identity quirks. | `package.json` / `main.js` |
| **P2-10** | `package.json` `buildTime` frozen at 2026-06-08 while `lastUpdated` is 2026-08-12. | Misleading diagnostics. | `package.json` |
| **P2-11** | Parity tests only assert rule text / Outlook URL parity — do not scan for new forbidden `process.platform` in renderer business logic. | Drift risk. | `tests/crossPlatformParityRule.test.js` |
| **P2-12** | Workflow stepper: active step not `aria-current`; emoji in labels. Contrast test covers CSS tokens only, not inline banner colours. | A11y polish. | `workflow-stepper.js`; `tests/textContrast.source.test.js` |
| **P2-13** | Enter-to-next-field exists but is undocumented in kb-help. | Desk speed win unused. | `app.js` vs kb-help |
| **P2-14** | Website deploy `continue-on-error` if `GH_PAT` missing — site can lag GitHub Releases. | Marketing version drift (less acute at 1.9.68). | `release-publish.yml` |
| **P2-15** | CLI `--dump-record` prints full attendance JSON. | Privileged dump if misused on shared machine. | `main.js` CLI |
| **P2-16** | CSP `style-src 'unsafe-inline'`. | XSS impact amplification if HTML injection returns. | `main/windowHardening.js` |

---

## Explicitly out of scope (per brief)

- Billing / Pro / Lemon Squeezy **productization** (keep free during beta)
- Full encrypted Anywhere cloud sync (left out of PR #4)
- SMTP / Resend “email PDF to me” without a safe secret path (correctly skipped in PR #4 — fix **copy** only for now)
- Duplicating PR #4 sync retry or Anywhere bridge work

Genuine billing-related bugs found were **copy/entitlement messaging** only (Pro upsell while beta-free; cloud-backup Pro strips) — listed under marketing honesty, not as “build payments”.

---

## Hypotheses from the brief — verified

| Hypothesis | Verdict |
|---|---|
| Sync/offline + Anywhere↔Desktop were recent pain points | **Confirmed.** PR #4 addresses the main Wi‑Fi blip and bridge hardening. Remaining gaps are local durability (30s debounce, backup mkdir) and batch/orphan edge cases. |
| Marketing may still mention paid Pro / 30-day trial while product is free-during-beta | **Confirmed and worse:** free forever + free during beta + subscribe £9.99 + trial language coexist on site and in-app; pricing still sells removed “Pro AI summaries”. |

---

## Suggested implementation order (for coordinating agent / Robert)

1. **Align commercial copy** (site + in-app Help/share/licence paste) to one story: free during beta; Pro planned; remove free-forever / live-subscribe / Pro AI summaries claims.  
2. **Escrow / privacy honesty** — either change wrap to recovery password or rewrite SECURITY/PRIVACY/Help/cloud guide to licence-key reality; stop claiming developers cannot decrypt.  
3. **Durability** — `flushDbSync` on finalise/suspend; shorten debounce or checkpoint; `mkdir` default Backups; surface backup skip as error.  
4. **Mac shortcuts + honest Save label**; dismissible blanker / require password for real lock.  
5. **Windows Authenticode** in release CI.  
6. Merge PR #4, then P1 sync residuals + `main.js` mojibake + README/docs/CI hygiene.  
7. Architecture extract from `app.js` (navigation, freemium copy, form sections) so the above stop regressing.

---

## Platform impact

| Area | Mac | Windows |
|---|---|---|
| PR #4 sync/bridge | Same shared paths | Same shared paths |
| P0 durability / backup mkdir | Same | Same (power-loss more common on station laptops) |
| Shortcuts (P0-11) | **Broken today** (Cmd) | Works (Ctrl); label still wrong (P0-12) |
| Signing (P0-13) | Strong (signed/notarised) | **Weak** (unsigned + SmartScreen) |
| Escrow / marketing honesty | Same trust issue | Same |
| Session blanker | Same | Same (custody-suite risk) |

---

## Method (evidence base)

- Default branch `master` @ v1.9.68; live site fetch (home, `/trial`, `/pricing`)  
- PR #4 via `gh pr view` / diff file list  
- Code: `main.js`, `main/syncWorker.js`, `lib/keyEscrow.js`, `lib/syncRecordCrypto.js`, `lib/quickfileSettingsSync.js`, `app.js` shortcuts/lock, `index.html` freemium copy, workflows, `package.json`  
- Docs: `SECURITY.md`, `PRIVACY_AND_CONFIDENTIALITY.md`, `docs/SYNC_*.md`, `README.md`, `changelog.json`  
- Release assets for `v1.9.68` confirmed on GitHub (Win + Mac)
