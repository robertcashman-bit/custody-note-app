# Cross-platform test matrix — Custody Note

**Candidate build:** v1.9.115 · commit `2c43fa8` · audit date 2026-10-19  
**Supported channels:** Windows NSIS (direct), Windows MSIX (Microsoft Store), macOS DMG/ZIP (direct). Linux is dev/CI-only (not shipped).

Legend: **Auto** = covered in CI or `npm run test:*` on this repo · **Manual** = requires a real Windows or Mac machine (owner QA).

| Area | Windows NSIS | Windows Store (MSIX) | macOS DMG/ZIP |
|------|--------------|----------------------|---------------|
| Clean install | Manual | Manual | Manual |
| Upgrade from prior release | Manual | Manual (Store pipeline) | Manual |
| Launch / splash / unlock | Auto (Playwright e2e) | Manual (Store sandbox) | Manual |
| Trial / licensing first run | Auto (unit + e2e partial) | Manual (Store licence UX) | Auto (unit) |
| Create / edit / save attendance | Auto (e2e stress-journey, unit durability) | Manual | Auto (shared renderer) |
| Close / reopen record | Auto (e2e) | Manual | Auto (shared renderer) |
| Save & Sync / outbox / empty cloud | Auto (data-safety + unit) | Manual | Auto |
| Local generational backup | Auto (backupPath + field parity) | Manual | Auto |
| Restore local backup | Auto (field parity + gates) | Manual | Auto |
| Managed cloud backup (AWS entitlement) | Manual (needs Pro + credentials) | Manual | Manual |
| Central sync SoT (custodynote.com) | Auto (mock server integration) | Manual | Auto |
| Export / PDF | Auto (unit + e2e partial) | Manual | Auto |
| Outlook Web email compose | Auto (unit parity) | Manual | Auto |
| Auto-update (electron-updater) | Manual (NSIS only) | N/A (Store updates) | Manual |
| Store vs direct detection | Auto (`windowsPackageChannel`, `usageHeartbeat`) | Auto | N/A |
| Shared userData NSIS↔MSIX | Auto (unit migration tests) | Manual (dual install) | N/A |
| Installer permissions (per-user AppData) | Auto (static NSIS config tests) | Auto (validate:msix) | Manual |
| Paths with spaces / non-admin user | Manual | Manual | Manual |
| SmartScreen / signing | Manual | Manual (Partner Center) | Manual (notary) |
| Restart after restore / upgrade | Auto (simulated DB export restart) | Manual | Manual |
| Uninstall / reinstall data retained | Manual (`deleteAppDataOnUninstall: false` static) | Manual | Manual |

## CI automation (GitHub Actions)

| Job | Runner | Scope |
|-----|--------|--------|
| `test` | `windows-latest` | `test:unit`, `validate:msix`, `test:data-safety`, `security:audit`, Playwright e2e |
| `msix-package` | `windows-latest` | Unsigned MSIX build + artefact upload |
| Release workflows | Windows + macOS | Signed installers (on tag / release PR) |

macOS **unit** tests are not duplicated on `macos-latest` in PR CI (minute cost); Mac **signed builds** run in release workflow. Cloud Agent evidence: full unit + data-safety + e2e on Linux VM 2026-10-19 (see `docs/PRODUCTION_READINESS.md`).

## Mac impact / Windows impact

Custody workflow code is shared (`app.js`, `main/` libs, sync). Platform-specific allowlist: Windows Store userData resolution, MSIX updater disable, macOS menu, Windows Outlook AppX bypass — all covered by dedicated unit tests.
