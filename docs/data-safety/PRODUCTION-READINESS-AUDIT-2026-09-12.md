# PRODUCTION READINESS AUDIT — CustodyNote.app

**Date:** 2026-09-12  
**App version under audit:** 1.9.97 (`master` @ `d015b50` + this audit PR)  
**Auditor role:** combined senior QA / principal eng / AppSec / reliability / UX / a11y / cross-platform / data-integrity  
**Method:** execute suites + fault injection + deliberate break-of-test-double + safe autofix + retest (not source review alone)

**Evidence root:** `/opt/cursor/artifacts/audit-2026-09-12/` (also referenced from the PR)

---

## A. Architecture map (concise)

```
Renderer (app.js + renderer/views/*)
   │ IPC via preload.js (narrow contextBridge)
   ▼
Main (main.js) — sql.js working set, IPC, OS, updater, Outlook launch
   │ flushDbSync / flushDbAsyncBounded (+ dirty restore on timeout)
   ▼
Local durable encrypted CNDB  (userData/attendances.db)
   + sync_queue outbox (mutation_id)
   + record_revisions (hash/metadata)
   │ push per sync_id (ack written count / IDs)
   ▼
Central account SoT — custodynote.com /api/sync/* (licence-hash scoped)
   │                    │
   │                    └─ Independent server sot-pitr/{userId}/ (website)
   ▼
Client PITR — generational Backups/*.db (magic-verified) ± offsite ± managed AWS backup
```

| Concern | Authority / notes |
|---------|-------------------|
| Autosave / draft | Renderer → attendance-save IPC → sql.js; durable only after flush |
| Force save | Disk flush + CNDB magic verify + verified backup + drain outbox; status via `lib/forceSaveStatus.js` — never bare “Saved” |
| Sync / conflict | Per-record upsert; empty/failed cloud ≠ wipe; dirty cleared only on push ack; conflicts parked |
| Encryption | `lib/dbCrypto.js` CNDB magic; master key / escrow |
| Licence / auth | Licence key → server hash; machineId metadata only |
| Email | Officer email → main `prepareOutlookComposeForOpen` (OWA URL or .eml). `mailto:` blocked in `open-external` |
| QuickFile / PDF | Billing workflow + LAA CRM1/PDF builders in main/lib |
| Win vs Mac | Custody behaviour identical; allowlisted OS integration only (paths, menu, updater teardown, Outlook AppX bypass) |

---

## B. Inventory — routes / views / CI

**Views (`index.html`):** home, list, quickcapture, firms, form, reports, station-mileage, matter-billing, authorities, officer-emails, settings, help.

**Renderer modules:** `renderer/views/{list,settings,reports,authorities,billing,billing-screen,documents-screen,completion-screen,workflow-stepper,officerEmails*,station-mileage-admin}.js`.

**Dead / parallel UI:** legacy overlay `openWorkflow` retained as fallback; primary Finish-matter path is full-page `#view-matter-billing` + `mountWorkflowInline` (confirmed).

**CI (`.github/workflows/test.yml`):** Windows — `npm run test:unit` → `npm run test:data-safety` → `npm run test:e2e`.

**Test inventory:** 160 unit files; data-safety gate 13 files / **193** tests; Playwright **56** tests / 14 specs.

---

## C. Formal test matrix (IDs)

| ID | Area | Sev | Result | Evidence |
|----|------|-----|--------|----------|
| T-DS-193 | Data-safety fault/chaos/canary (incl. 1000 canaries) | S0 | PASS 193/193 | `data-safety-suite.log`, `data-safety-final.log` |
| T-UNIT | Full unit/integration | S1 | PASS 2222/2222 (+2 skip smoke-API) | `unit-suite.log`, `unit-final.log` |
| T-E2E-CRIT | Critical persist + search | S0 | PASS | `e2e-critical.log`, `e2e-final-critical.log` |
| T-E2E-XDEV | Cross-device sync A→B | S0 | PASS | `e2e-critical.log` |
| T-E2E-STRESS | Solicitor lifecycle soft-report + hard gate | S1 | PASS 30 PASS / 0 FAIL | `e2e-stress-retest3.log` |
| T-E2E-FULL | Nav/forms/LAA/officer-email/contrast/billing/QF | S2 | PASS 37+7 | `e2e-remaining.log`, `e2e-billing.log` |
| T-E2E-CLOSE | Billing Close no remount | S2 | PASS | `billing-close-no-remount.spec.ts` |
| T-SEC-AUDIT | Prod npm audit + secrets + static hardening | S1 | PASS (0 prod vulns after fix) | `security-audit-after.log` |
| T-BREAK | Deliberate mock `written:0` | S0 | FAIL 2 (proved) then restore PASS | `deliberate-break-proof.log`, `deliberate-break-restore.log` |
| T-FAULT | 429/offline/false-ack/disk-full class | S0 | Covered in T-DS-193 | faultInjection suite |
| T-XSS | Note/list HTML escaping patterns | S2 | PASS (static + escapeHtml usage); residual large `innerHTML` surface | code scan |
| T-IDOR | Licence-scoped mock SoT rejects other key | S1 | PASS (unit/mock) | crossDeviceSync; no live staging credentials in this env |
| T-MAIL | mailto blocked; OWA path for officer email | S2 | PASS | emailPolicy + officer-email e2e |

---

## D. Executed suite results (this run)

| Gate | Before autofix | After autofix |
|------|----------------|---------------|
| `npm run test:data-safety` | 193/193 | 193/193 |
| `npm run test:unit` | 2221/2221 | 2222/2222 |
| Playwright critical/stress/xdev/legal | 11/11 (soft K.1 FAIL swallowed) | stress 30 PASS / 0 FAIL + hard expect |
| Playwright remaining + billing | 37+7 PASS | PASS |
| `npm run security:audit` | FAIL (4 high prod) | PASS (0 high/crit prod) |
| Syntax `node -c` main/preload/updater | OK | OK |

Skipped (intentional): 2 QuickFile deployed smoke tests without `SMOKE_API_BASE`.

---

## E. User simulation (solicitor at station)

Automated Electron/Playwright journeys (synthetic data only):

- Create incomplete draft → edit unicode/newlines → finalise → lock rejection → Finish matter → billing recalc → archive → search/archive filter (`stress-journey`)
- Surname persist + search (`critical-journey`)
- Custody + voluntary finalise button visibility
- Cross-device create/edit sync
- Officer email Open Outlook body placement
- LAA home forms + declaration PDF wording
- Billing Close dismisses without remount (new)

Not automatable here: live Outlook GUI paste, dual physical Mac+Windows kill-9, production licence Email-my-key against live escrow (companion fix noted in flight).

---

## F. Fault injection

Covered by `tests/dataSafety.faultInjection.test.js` + stress sync suites:

- Disk-full / timeout → dirty restore; no false Saved  
- Post-flush requires CNDB magic  
- 429 / offline / offline → local retained; Sync problem / waiting states  
- Push `ok:true written:0` / wrong IDs → outbox retained  
- Empty / failed cloud → preserve local  
- Offline create/edit → outbox survives  
- Conflict / stale device absence ≠ erase  

**Deliberate break:** mock push forced `{ ok:true, written:0 }` → **2 failures** (account SoT + 1000 canaries). Restored → green. Proves critical tests are not rubber stamps.

---

## G. Security

| Check | Finding |
|-------|---------|
| Secrets in repo | No live keys (scan OK) |
| Prod npm audit | Was 4 high (electron-updater redirect token leak, js-yaml, nanoid). **Fixed:** `electron-updater@6.8.9` + overrides `js-yaml@4.3.2`, `nanoid@5.1.16` → **0** prod vulns |
| XSS | `escapeHtml` used on list/admin paths; large `innerHTML` surface remains — treat as ongoing hardening, not S0 with current esc patterns |
| mailto | Builders exist; `open-external` blocks mailto; officer path is OWA/.eml |
| Authz / IDOR | Licence-scoped mock SoT rejects other licence; live staging IDOR not probed (no synthetic staging users in env) |
| Window hardening | Static checks OK |

---

## H. Autofixes in this PR

1. **Billing Close auto-remount (S2 UX / reliability)** — Close called `loadMatterBillingScreen()` which always auto-mounted for finalised notes → Close appeared broken. Fix: `_matterBillingAutoStartPending` + `loadMatterBillingScreen({ autoStart })`; `showView` passes `autoStart:true`; onClose passes `false`.  
2. **Stress journey CI gate** — soft FAILs previously did not fail Playwright. Now `expect(fails).toBe(0)`; Stage K updated for inline workflow + correct Close control after J.2.  
3. **Permanent E2E** — `tests/e2e/billing-close-no-remount.spec.ts`.  
4. **Source regression** — `workflowUtils.test.js` asserts autoStart:false wiring.  
5. **Dependency hardening** — electron-updater + overrides (see G).

---

## I. Deliberate break (test the tests)

| Step | Result |
|------|--------|
| Break mock push → always `written: 0` | `crossDeviceSync` + canary scale **fail** (2) |
| Restore fixture | `crossDeviceSync` **4/4 pass** |

Evidence: `deliberate-break-proof.log`, `deliberate-break-restore.log`.

---

## J. CI / release gate recommendations

Already enforced on PR: `test:unit`, `test:data-safety`, `test:e2e`.

Implemented this audit:

- Stress soft-FAIL → hard fail (closes CI blind spot)
- Billing Close remount regression E2E + source assert

Recommended next (not blocking):

- Add `npm run security:audit` to CI (now green for prod)
- Optional metal checklist for dual Mac/Windows kill-9
- Staging IDOR pair with synthetic licences when credentials available

---

## K. Mac impact / Windows impact

| Change | Mac | Windows |
|--------|-----|---------|
| Billing Close autoStart | Identical renderer behaviour | Identical |
| Stress / E2E gates | Identical | Identical |
| electron-updater bump | Same dependency; updater UX unchanged | Same; install teardown allowlist unchanged |
| Custody/sync logic | No platform branch added | No platform branch added |

---

## L. Website coordination

No website API/PITR defect found that requires a separate website PR from this audit. Prior website SoT/PITR GREEN (PR #13) remains the reference; not re-executed in the website repo in this environment.

---

## M. Residual risks (non-blocking)

1. Historical never-flushed Costachi bytes — not recoverable (documented).  
2. Metal dual-device kill-9 — harness covers; ops validation optional.  
3. Shared 429 budget can delay central confirm — local+outbox remain SoT until ack.  
4. Key/escrow / safeStorage edge cases — fail-safe keeps local.  
5. Large renderer `innerHTML` surface — continue escape discipline.  
6. DevDependency Electron/npm tree still reports vulns outside `--omit=dev` — packaging surface, not app runtime prod deps.

---

## COMMERCIAL RELEASE RECOMMENDATION: CONDITIONALLY READY

**DATA LOSS RISK:** LOW for future silent-loss routes (193/193 data-safety + deliberate-break proof). Historical never-flushed bytes remain non-recoverable / non-blocking.

**SECURITY RISK:** LOW (prod npm 0 high/crit after fix; no secrets; mailto blocked; licence-scoped sync). Residual: XSS surface hygiene + staging IDOR not live-probed.

**UNRESOLVED RELEASE BLOCKERS:** 0 (S0/S1)

**CRITICAL USER JOURNEYS TESTED:** 30/30 stress PASS; critical persist; cross-device; billing close; officer email; LAA — passed / tested

**SAFE TO SELL TO OTHER SOLICITORS TODAY:** YES

**REASON:** Executed evidence shows durable local save, honest Force Save states, outbox ack gating, empty-cloud non-wipe, and cross-device SoT behaviour hold under fault injection; CI soft-FAIL blind spot and Billing Close remount defect were found and fixed with regression coverage. Condition = ship 1.9.97+ with this PR merged and CI green; keep monitoring 429/escrow and complete optional metal dual-device check when convenient.
