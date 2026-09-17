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
| Partner Center Product identity wired into `build.appx` | **Done** (see Identity table below) |
| Real Windows install: NSIS ↔ Store coexistence + SQLite round-trip | **Robert — smoke-test on a Windows PC** |
| Mac packaging | Untouched |

**Verdict for Store submission:** treat as **AMBER** until (a) Windows CI has produced a `.msix` with the Partner Center identity above, and (b) you complete the Windows smoke checklist below. Identity placeholders are gone — do **not** invent a different Publisher CN.

---

## Store listing names (reservation = DisplayName)

| Field | Value | Notes |
|-------|-------|-------|
| **Reserved Store name** (Partner Center reservation) | `Custody Note for Windows` | Must match the reserved product name in Partner Center |
| **Package DisplayName** (`Package/Properties/DisplayName`) | `Custody Note for Windows` | Repo `build.appx.displayName` — **must equal the reserved name exactly** or Partner Center rejects the MSIX |
| **NSIS / desktop productName** | `Custody Note` | Repo `build.productName` — Setup.exe / shortcuts; not the Store DisplayName |
| **Publisher display name** | `Police Station Agent` | Shown as the publisher on the Store page |

Partner Center validates `Package/Properties/DisplayName` against the reserved app name. Do **not** use a shorter title in the MSIX manifest. Do **not** rename the reservation without updating Partner Center and `build.appx.displayName` together.

---

## Partner Center Product identity (wired in repo)

Copied **exactly** from Partner Center — do not invent or “fix” these strings:

| Field | Value |
|-------|-------|
| Reserved Store name | `Custody Note for Windows` |
| Publisher display name | `Police Station Agent` |
| Package / Identity name | `PoliceStationAgent.CustodyNoteforWindows` |
| Publisher | `CN=E2B27EAF-500B-4615-A55C-DB01E913CBC7` |
| Package family name | `PoliceStationAgent.CustodyNoteforWindows_pmk3my2z6b2bj` |
| Store ID | `9NFSRVT3T45V` |

Mapped into electron-builder:

| Partner Center field | Repo location | Value in repo |
|----------------------|---------------|---------------|
| Package / Identity name | `package.json` → `build.appx.identityName` | `PoliceStationAgent.CustodyNoteforWindows` |
| Publisher (`CN=…`) | `package.json` → `build.appx.publisher` | `CN=E2B27EAF-500B-4615-A55C-DB01E913CBC7` |
| Publisher display name | `package.json` → `build.appx.publisherDisplayName` | `Police Station Agent` |
| Package/Properties/DisplayName (reserved name) | `package.json` → `build.appx.displayName` | `Custody Note for Windows` |
| Application Id | `package.json` → `build.appx.applicationId` | `CustodyNote` |

### OS targeting (TargetDeviceFamily)

Partner Center rejects MSIX packages whose `TargetDeviceFamily` **MinVersion ≤ 10.0.17134.0**.

| Field | Repo location | Value | Notes |
|-------|---------------|-------|-------|
| MinVersion | `package.json` → `build.appx.minVersion` | `10.0.17763.0` | Windows 10 **1809** — MSIX floor + current Store desktop guidance; matches product support (Windows 10 64-bit / Windows 11) |
| MaxVersionTested | `package.json` → `build.appx.maxVersionTested` | `10.0.22621.0` | Windows 11 22H2 quirk baseline |

electron-builder’s x64 default (`10.0.14316.0`) is **too low** for Store upload — always set `minVersion` explicitly. `npm run validate:msix` enforces MinVersion ≥ `10.0.17763.0`.

Package family name and Store ID are Partner Center–derived metadata (documented here for upload / support). electron-builder does not take them as config fields; they must continue to match the identity + publisher above.

---

## Robert — numbered Partner Center upload checklist

### A. Account (already done for this identity)

1. Partner Center developer account owns publisher **Police Station Agent**.
2. App reserved as **Custody Note for Windows** (Store ID `9NFSRVT3T45V`).

### B. Identity in repo (done)

3. `build.appx.identityName` / `publisher` / `publisherDisplayName` / `displayName` match Partner Center (see table above). `displayName` must be exactly **Custody Note for Windows**.
4. After any identity change: `npm run validate:msix` must pass (CI also runs it).

### C. Build / obtain the MSIX

5. Prefer a tagged release so `release-windows-msix` uploads `Custody-Note-{version}.msix` to the GitHub Release (unsigned).  
   Or build on a Windows machine: `npm run build:msix:assets && npx electron-builder --win appx --publish never`.  
   Or download the artefact from the PR/CI `msix-package` job when present.
6. Confirm the file exists and version matches `package.json` (Store needs four-part `X.Y.Z.0` via `setBuildNumber`).
7. Optional sanity check after build: package identity in the MSIX should be  
   `PoliceStationAgent.CustodyNoteforWindows` with publisher `CN=E2B27EAF-500B-4615-A55C-DB01E913CBC7`.

### D. Upload package in Partner Center (brief field notes)

8. Open [Partner Center](https://partner.microsoft.com/dashboard) → app **Custody Note for Windows** (`9NFSRVT3T45V`) → **Start submission** (or next submission).
9. **Packages:** upload the unsigned `Custody-Note-{version}.msix` from CI/GitHub Release. Partner Center signs for Store distribution.
   - If Partner Center rejects identity mismatch, re-check `identityName` + `publisher` against Product identity — do not invent a new CN.
10. **Store listings (en-GB at minimum):**
    - Product/reservation name remains **Custody Note for Windows**.
    - MSIX `Package/Properties/DisplayName` must also be **Custody Note for Windows** (`build.appx.displayName`) — Partner Center rejects any other value.
    - Description, feature bullets, screenshots / Store logos, search terms.
11. **Age ratings:** complete the questionnaire (business / productivity; no child-directed content).
12. **Privacy policy URL:** `https://custodynote.com/privacy` (confirm it still resolves before submit).
13. **Support contact:** email/URL users can reach (e.g. support or contact page on custodynote.com).
14. **Properties / category:** Business or Productivity; Windows 10/11 desktop.
15. Review **capabilities** (`runFullTrust`, `internetClient`) against your declaration — full-trust desktop bridge is expected for Electron.
    - **Robert — `runFullTrust` approval (expected warning, do not remove):** Partner Center flags `runFullTrust` as a **restricted capability**. On **Submission options**, provide an explanation such as: *“Custody Note is an Electron desktop (Desktop Bridge) app packaged as full-trust MSIX. `runFullTrust` is required so the packaged Win32/Chromium process can run at medium IL and use normal desktop APIs (filesystem under AppData, Outlook Web via browser, printing/exports).”* Approval is requested in Partner Center; keep the capability in `build.appx.capabilities`.
16. Confirm package **MinVersion** is `10.0.17763.0` (or newer) before upload — older packages are rejected.
17. **Submit** for certification only after Windows smoke tests below. Fix any certification feedback (identity mismatch, missing screenshots, policy URL, MinVersion, etc.) and resubmit.

### E. After approval — what users get

18. **Store installs** update only through the Microsoft Store (in-app GitHub/`electron-updater` is disabled on this channel).
19. **NSIS / website downloads** continue to update via GitHub Releases + `electron-updater` as today — unchanged.
20. Same machine may have used NSIS first: data must remain under `%APPDATA%\custody-note` (see smoke tests). Do not tell users to “reinstall fresh” as a fix for missing notes.
21. For each new Store version: bump `package.json` / changelog, produce a new `.msix`, upload a new submission (Store rejects reuse of the same version).

---

## Identity (do not confuse these)

| Identity | Value | Effect |
|----------|-------|--------|
| Electron `appId` | `com.custodynote.app` | **Do not change** without a migration plan. Affects updater / historical assumptions. |
| package.json `name` | `custody-note` | Drives classic userData folder name |
| Classic userData (NSIS + Store) | `%APPDATA%\custody-note` | Shared DB / licence / backups — **required for coexistence** |
| Store `identityName` | `PoliceStationAgent.CustodyNoteforWindows` | Package identity (Partner Center) |
| Store `applicationId` | `CustodyNote` | AppX Application Id |
| Store `publisher` | `CN=E2B27EAF-500B-4615-A55C-DB01E913CBC7` | Must match Store signing identity |
| Package family name | `PoliceStationAgent.CustodyNoteforWindows_pmk3my2z6b2bj` | Derived; document only |
| Store ID | `9NFSRVT3T45V` | Partner Center product id |

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

After a rejected upload, **always bump** before re-upload (e.g. `1.9.103` → `1.9.104`) — Partner Center typically will not accept the same package version again.

---

## Related files

- `package.json` → `build.win` / `build.appx` (`minVersion`, `maxVersionTested`, capabilities) / `build.nsis`
- `lib/windowsPackageChannel.js`
- `updater.js` (Store no-op)
- `scripts/validate-msix-config.mjs`
- `scripts/build-msix-assets.mjs`
- `.github/workflows/release-publish.yml` (`release-windows-msix`)
- `.github/workflows/test.yml` (`msix-package`)
- `docs/data-safety/ARCHITECTURE.md`
