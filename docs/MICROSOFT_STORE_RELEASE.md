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

## Identity (do not confuse these)

| Identity | Value | Effect |
|----------|-------|--------|
| Electron `appId` | `com.custodynote.app` | **Do not change** without a migration plan. Affects updater / historical assumptions. |
| package.json `name` | `custody-note` | Drives classic userData folder name |
| Classic userData (NSIS + Store) | `%APPDATA%\custody-note` | Shared DB / licence / backups — **required for coexistence** |
| Store `identityName` | `DefenceLegalServices.CustodyNote` | Partner Center package identity (may need adjustment to match reservation) |
| Store `applicationId` | `CustodyNote` | AppX Application Id |
| Store `publisher` | `CN=DEFENCELEGALSERVICES LIMITED` | **PLACEHOLDER** — replace with the exact Publisher CN from Partner Center before certification |

### Publisher CN placeholder

Config location: `package.json` → `build.appx.publisher`

```text
CN=DEFENCELEGALSERVICES LIMITED
```

In Partner Center → your account → **Publisher display name** / package identity, copy the **Publisher** value (often a GUID-style CN such as `CN=XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX`). It must match the certificate Partner Center uses to sign. Until that CN is pasted into `build.appx.publisher`, treat Store submission as blocked even if CI builds an `.msix`.

`publisherDisplayName` stays human-readable: `DEFENCELEGALSERVICES LIMITED`.

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

If a Store package-local profile ever appears with data while classic is empty, the app **copies** into classic with hash verification and **never deletes** the source. If classic already has a same-or-larger `attendances.db`, it is **never overwritten**.

---

## Updates

- **NSIS:** unchanged — `electron-updater` + GitHub `latest.yml`.
- **Store / MSIX:** `initUpdater` receives `isMsixStoreBuild: true` and returns a no-op controller (`status: store`). No GitHub update checks, no `quitAndInstall`.

Detection: `process.windowsStore`, WindowsApps execPath heuristics, or `CUSTODYNOTE_CHANNEL=msix` for tests.

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

Sideload (dev/test certificate or unlocked device):

```powershell
Add-AppxPackage -Path .\dist\Custody-Note-1.9.100.msix
```

Confirm after launch:

1. `%APPDATA%\custody-note\attendances.db` is the live DB (not under `Packages\...\LocalCache` alone).
2. Settings → update check reports Store-managed message.
3. Creating a note on NSIS then opening Store build (or vice versa) shows the **same** records.

---

## CI

- `release-windows` — `electron-builder --win nsis --publish always` (Azure soft gate unchanged).
- `release-windows-msix` — `validate:msix` → build assets → `electron-builder --win appx --publish never` → `gh release upload` unsigned `.msix`. **`continue-on-error: true`** so NSIS/Mac can still publish.
- `publish-release` required assets **do not** include `.msix`.
- PR `test.yml` runs `npm run validate:msix`.

---

## Partner Center manual steps

1. Enroll / open Partner Center for **DEFENCELEGALSERVICES LIMITED**.
2. Reserve name **Custody Note** (or match `displayName`).
3. Copy **Publisher CN** → set `build.appx.publisher` exactly → commit.
4. Align `identityName` with the Store reservation if Partner Center assigns a different identity.
5. Download the unsigned `.msix` from the GitHub Release (or build locally).
6. Create a submission → upload package → complete Store listing / age ratings / privacy URL (`https://custodynote.com` privacy page).
7. Submit for certification. Fix capability / manifest feedback if any.
8. After Store publish, verify a clean VM install uses `%APPDATA%\custody-note` and that NSIS users who later install from Store keep records.

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
- `docs/data-safety/ARCHITECTURE.md`
