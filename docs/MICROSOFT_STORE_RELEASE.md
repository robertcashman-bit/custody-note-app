# Microsoft Store release (Windows AppX / MSIX)

Custody Note ships **two Windows channels** from the same source:

| Channel | Artefact | Updates | Signing |
|---------|----------|---------|---------|
| NSIS (current production) | `Custody-Note-Setup-{version}.exe` | `electron-updater` via GitHub Releases | Azure Artifact Signing when configured (see `SIGNING.md`) |
| Microsoft Store | `Custody-Note-{version}.msix` | **Store only** (in-app updater disabled) | Upload **unsigned** from CI; **Partner Center** signs for Store |

macOS (DMG/ZIP + notarisation) is unchanged.

> electron-builder **26.x** (this repo) exposes the Store package target as **`appx`**.
> There is no separate `msix` target in 26.16.x. We set `artifactName` to `*.msix`
> so the produced package uses the modern extension Store accepts.

---

## Production readiness (honest)

| Gate | Status |
|------|--------|
| Config + assets + docs in repo | Done |
| Unit/source tests (channel, updater off, shared path, migration hash) | Done on CI/Linux |
| PR `validate:msix` | Done |
| Actual `.msix` produced on Windows CI | Required (see Test workflow `msix-package` job) |
| Partner Center Publisher CN pasted (not placeholder) | **Robert — blocking for Store submit** |
| Real Windows install: NSIS ↔ Store coexistence + SQLite round-trip | **Robert — smoke-test on a Windows PC** |
| Mac packaging | Untouched |

**Verdict for Store submission:** treat as **AMBER** until (a) Windows CI has produced a `.msix`, (b) Partner Center identity fields are pasted from your account (not invented), and (c) you complete the Windows smoke checklist below. Do **not** submit to certification on placeholder publisher CN alone.

---

## Robert — numbered Partner Center release checklist

Do these in order. **Do not invent** Package Identity / Publisher CN values — copy them from Partner Center into the repo placeholders.

### A. Account & reservation

1. Sign in at [Partner Center](https://partner.microsoft.com/dashboard) with the Microsoft account that will own the company publisher.
2. Create or join a **developer account** as organisation **DEFENCELEGALSERVICES LIMITED** (UK company legal name).
3. Pay the one-time Microsoft developer registration fee if Partner Center requires it for a new account.
4. Complete any organisation identity / tax / payout profile steps Partner Center shows (needed before Store publish).
5. **Create a new app** → reserve the name **Custody Note** (must match what you want users to see; keep it consistent with `build.appx.displayName`).

### B. Copy identity into this repo (placeholders only until you paste)

6. Open the app’s **Product identity** / package identity page in Partner Center.
7. Copy these **exactly** (character-for-character):
   - **Package/Identity Name** → paste into `package.json` → `build.appx.identityName`  
     (repo placeholder today: `DefenceLegalServices.CustodyNote`)
   - **Publisher** (CN=…) → paste into `package.json` → `build.appx.publisher`  
     (repo placeholder today: `CN=DEFENCELEGALSERVICES LIMITED` — often Partner Center shows a GUID-style CN instead; **use theirs**)
   - **Publisher display name** → paste into `package.json` → `build.appx.publisherDisplayName`  
     (repo placeholder today: `DEFENCELEGALSERVICES LIMITED`)
8. Commit and push those three strings on a release branch. Re-run `npm run validate:msix`.  
   **Do not** guess GUIDs. If Partner Center has not issued them yet, leave the placeholders and stop before certification upload.

### C. Build / obtain the MSIX

9. Prefer a tagged release so `release-windows-msix` uploads `Custody-Note-{version}.msix` to the GitHub Release (unsigned).  
   Or build on a Windows machine: `npm run build:msix:assets && npx electron-builder --win appx --publish never`.  
   Or download the artefact from the PR/CI `msix-package` job when present.
10. Confirm the file exists and version matches `package.json` (Store needs four-part `X.Y.Z.0` via `setBuildNumber`).

### D. Store listing & submission

11. In Partner Center → your Custody Note app → **Start submission** (or next submission).
12. **Packages:** upload the `.msix`. Partner Center signs for Store distribution.
13. **Store listings (en-GB at minimum):** description, feature bullets, screenshots / Store logos, search terms.
14. **Age ratings:** complete the questionnaire (business / productivity; no child-directed content).
15. **Privacy policy URL:** use the live site policy, e.g. `https://custodynote.com/privacy` (confirm the path still resolves before submit).
16. **Support contact:** email/URL users can reach (e.g. support@ or contact page on custodynote.com).
17. **Properties / category:** Business or Productivity as appropriate; Windows 10/11 desktop.
18. Review **capabilities** (`runFullTrust`, `internetClient`) against your declaration — full-trust desktop bridge is expected for Electron.
19. **Submit** for certification. Fix any certification feedback (identity mismatch, missing screenshots, policy URL, etc.) and resubmit.

### E. After approval — what users get

20. **Store installs** update only through the Microsoft Store (in-app GitHub/`electron-updater` is disabled on this channel).
21. **NSIS / website downloads** continue to update via GitHub Releases + `electron-updater` as today — unchanged.
22. Same machine may have used NSIS first: data must remain under `%APPDATA%\custody-note` (see smoke tests). Do not tell users to “reinstall fresh” as a fix for missing notes.
23. For each new Store version: bump `package.json` / changelog, produce a new `.msix`, upload a new submission (Store rejects reuse of the same version).

---

## Identity (do not confuse these)

| Identity | Value | Effect |
|----------|-------|--------|
| Electron `appId` | `com.custodynote.app` | **Do not change** without a migration plan. Affects updater / historical assumptions. |
| package.json `name` | `custody-note` | Drives classic userData folder name |
| Classic userData (NSIS + Store) | `%APPDATA%\custody-note` | Shared DB / licence / backups — **required for coexistence** |
| Store `identityName` | Placeholder `DefenceLegalServices.CustodyNote` until you paste Partner Center | Package identity |
| Store `applicationId` | `CustodyNote` | AppX Application Id |
| Store `publisher` | Placeholder `CN=DEFENCELEGALSERVICES LIMITED` until you paste Partner Center CN | Must match Store signing identity |

### Where to paste Partner Center values

| Partner Center field | Repo location |
|----------------------|---------------|
| Package / Identity name | `package.json` → `build.appx.identityName` |
| Publisher (`CN=…`) | `package.json` → `build.appx.publisher` |
| Publisher display name | `package.json` → `build.appx.publisherDisplayName` |

---

## Persistent data (NSIS vs MSIX)

Both channels resolve to the **same** classic profile via `lib/windowsPackageChannel.js`:

`%APPDATA%\custody-note\`

| Data | File / folder | Survives update | Survives uninstall (NSIS) | Migration |
|------|---------------|-----------------|---------------------------|-----------|
| Attendances SQLite (CNDB) | `attendances.db` | Yes | Yes (`deleteAppDataOnUninstall: false`) | Shared path — no split |
| Master / recovery | `encryption.key`, `recovery.dat`, `master.fallback` | Yes | Yes | Shared |
| Licence | `licence.dat`, `licence-config.json` | Yes | Yes | Shared |
| Admin licence store | `licences.db.enc` | Yes | Yes | Shared |
| Generational backups | `Backups\` | Yes | Yes | Shared |
| Photos | `photos\` | Yes | Yes | Shared |
| Sync / LAA state | `cn-laa-forms-state.json`, sync queue inside DB | Yes | Yes | Shared |
| Updater state / logs | `cn-auto-update-state.json`, `cn-auto-update.log` | Yes | Yes | Irrelevant on Store (updater disabled) |
| Security log | `security.log` | Yes | Yes | Shared |

Code evidence: `lib/windowsPackageChannel.js` (`resolveSharedWindowsUserData`, `migrateUserDataCopy`), wired from `main.js` before DB open; updater no-op in `updater.js` when `isMsixStoreBuild`.

If a Store package-local profile ever appears with data while classic is empty, the app **copies** into classic with hash verification and **never deletes** the source. If classic already has a same-or-larger `attendances.db`, it is **never overwritten**.

---

## Updates

- **NSIS:** unchanged — `electron-updater` + GitHub `latest.yml`.
- **Store / MSIX:** `initUpdater` receives `isMsixStoreBuild: true` and returns a no-op controller (`status: store`). No GitHub update checks, no `quitAndInstall`.

Detection: `process.windowsStore`, WindowsApps execPath heuristics, or `CUSTODYNOTE_CHANNEL=msix` for tests.

---

## Robert — Windows PC smoke tests (required before Store submit)

The Linux cloud agent **cannot** produce or sideload an `.msix` (`AppX is supported only on Windows`). After Windows CI (or your PC) builds one:

1. **NSIS still works:** install `Custody-Note-Setup-*.exe` → create a test attendance → confirm `%APPDATA%\custody-note\attendances.db` grows → restart → record still listed.
2. **MSIX sideload / Store preview:** install the `.msix` on the **same Windows user profile**.
3. **Coexistence:** open Store/MSIX build → the NSIS test attendance must still appear (same DB). Never accept an empty Home as “fresh install” if the classic folder has a multi‑KB DB.
4. **Write from Store channel:** edit/save a note → confirm `attendances.db` mtime/size change under `%APPDATA%\custody-note` (not only under `Packages\...\LocalCache`).
5. **Updater messaging:** in-app update check on MSIX must say Store manages updates (not GitHub download).
6. **Licence:** activated licence on NSIS still recognised on MSIX (same `licence.dat`).
7. **Backup:** Settings shows backup folder under the shared profile; quick backup file appears in `Backups\`.
8. Optional: uninstall NSIS only → Store build still opens records (`deleteAppDataOnUninstall` is false; do not manually delete AppData).

---

## Local build / sideload test

```bash
npm ci
npm run build:msix:assets
npm run validate:msix
# Windows only:
npx electron-builder --win appx --publish never
# Output: dist/Custody-Note-{version}.msix
```

```powershell
Add-AppxPackage -Path .\dist\Custody-Note-1.9.100.msix
```

---

## CI

- `release-windows` — `electron-builder --win nsis --publish always` (Azure soft gate unchanged).
- `release-windows-msix` — `validate:msix` → build assets → `electron-builder --win appx --publish never` → `gh release upload` unsigned `.msix`. **`continue-on-error: true`** so NSIS/Mac can still publish.
- `publish-release` required assets **do not** include `.msix`.
- PR `test.yml` runs `npm run validate:msix` and a Windows **`msix-package`** job that must produce `Custody-Note-*.msix` as a workflow artefact.
- Mac job unchanged.

---

## Rollback

- Store: halt rollout / unpublish submission in Partner Center; users remain on last Store version.
- NSIS: unchanged GitHub Releases rollback / do not promote a bad tag.
- Data: never “fix” by deleting `%APPDATA%\custody-note`. Restore from `Backups\` or cloud sync.

---

## Compatibility notes (audit)

| Area | Status |
|------|--------|
| SQLite via sql.js in userData | OK — not beside exe |
| Native modules | sql.js WASM — OK for full-trust desktop |
| Outlook Web compose / `shell.openExternal` | OK with `runFullTrust` |
| File dialogs / exports to Desktop | OK |
| Backups to userData + optional offsite folder | OK — avoid writing under install dir |
| Auto-launch / protocol handlers | Not declared yet — add only if Product needs them |
| Elevation | NSIS may elevate; Store package should not require admin for normal use |
| electron-updater | Disabled on Store channel |

---

## Versioning

Semver `X.Y.Z` in `package.json` → Store four-part `X.Y.Z.0` via `appx.setBuildNumber: true`. Each Store upload must increase the version.

---

## Related files

- `package.json` → `build.win` / `build.appx` / `build.nsis`
- `lib/windowsPackageChannel.js`
- `updater.js` (Store no-op)
- `scripts/validate-msix-config.mjs`
- `scripts/build-msix-assets.mjs`
- `.github/workflows/release-publish.yml` (`release-windows-msix`)
- `.github/workflows/test.yml` (`msix-package`)
- `docs/data-safety/ARCHITECTURE.md`
