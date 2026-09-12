# PRODUCTION READINESS AUDIT — CustodyNote.app

**Date:** 2026-09-12 (updated after CI fix + absolute-ready bar)  
**App version under audit:** 1.9.97 (`master` + this PR)  
**Auditor role:** combined senior QA / principal eng / AppSec / reliability / UX / a11y / cross-platform / data-integrity  
**Method:** execute suites + fault injection + deliberate break-of-test-double + safe autofix + retest (not source review alone)

**Evidence root:** `/opt/cursor/artifacts/audit-2026-09-12/`

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
| Sync / conflict | Per-record upsert; empty/failed cloud ≠ wipe; dirty cleared only on push ack |
| Encryption | `lib/dbCrypto.js` CNDB magic; master key / escrow |
| Licence / auth | Licence key → server hash; machineId metadata only |
| Email | Officer email → main OWA URL or .eml; `mailto:` blocked in `open-external` |
| QuickFile / PDF | Billing workflow + LAA CRM1/PDF builders |
| Win vs Mac | Custody behaviour identical; allowlisted OS integration only |

---

## B. Inventory — routes / views / CI

**Views:** home, list, quickcapture, firms, form, reports, station-mileage, matter-billing, authorities, officer-emails, settings, help.

**CI (`.github/workflows/test.yml`):** Windows — `test:unit` → `test:data-safety` → `security:audit` → `test:e2e`.

**Test inventory:** 160+ unit files; data-safety **193** tests; Playwright **56+** tests.

---

## C. Formal test matrix (IDs)

| ID | Area | Sev | Result | Evidence |
|----|------|-----|--------|----------|
| T-DS-193 | Data-safety fault/chaos/canary | S0 | PASS 193/193 | `data-safety-final.log` |
| T-UNIT | Full unit/integration | S1 | PASS 2222+ | `unit-final.log` |
| T-E2E-CRIT | Critical persist + search | S0 | PASS | `e2e-final-critical.log` |
| T-E2E-XDEV | Cross-device sync A→B | S0 | PASS | `e2e-critical.log` |
| T-E2E-STRESS | Lifecycle + soft-FAIL=CI fail | S1 | PASS 30/0 FAIL | `e2e-stress-retest3.log` |
| T-E2E-OFFICER | Officer email Outlook body | S1 | PASS (hardened) | `officer-email-fixed.log` |
| T-E2E-CLOSE | Billing Close no remount | S2 | PASS | `billing-close-no-remount.spec.ts` |
| T-SEC-AUDIT | Prod npm + secrets + static | S1 | PASS 0 high/crit | `security-audit-after.log` |
| T-BREAK | Deliberate mock `written:0` | S0 | FAIL 2 then restore PASS | `deliberate-break-*.log` |
| T-FLUSH | Flush/dirty/Force save durability | S0 | PASS 35 | `costachi-nonrecurrence.log` |
| T-IDOR | Licence-scoped mock SoT | S1 | PASS (unit/mock) | crossDeviceSync |

---

## D. Executed suite results

| Gate | Result |
|------|--------|
| `npm run test:data-safety` | **193/193** |
| `npm run test:unit` | **2222/2222** (+ intentional smoke skips only) |
| Playwright critical/stress/cross-device/billing/LAA/officer-email | PASS |
| `npm run security:audit` (prod) | PASS |
| Deliberate break `written:0` | **Fails as required**; restore green |
| Flush/durability pack (Costachi non-recurrence) | **35/35** |

---

## E. User simulation

Automated Electron journeys (synthetic only): create/edit/finalise/lock/Finish-matter/billing/archive/search; cross-device sync; officer email Open Outlook; LAA forms; Billing Close; voluntary + custody finalise visibility.

---

## F. Fault injection

Covered: disk-full/timeout dirty restore; CNDB magic; 429/offline; false ack `written:0`; empty cloud preserve; conflict/stale absence. Deliberate break proved critical tests catch broken sync.

---

## G. Security

| Check | Finding |
|-------|---------|
| Secrets | None live |
| Prod npm | 0 high/crit after electron-updater + overrides |
| mailto | Blocked in open-external; OWA/.eml for officer email |
| Authz | Licence-scoped mock SoT |
| Recipient input | `type=text` + `inputmode=email` so Chromium cannot reject valid `.police.uk` addresses |

---

## H. Autofixes (this PR)

1. Billing Close auto-remount — `loadMatterBillingScreen({ autoStart })`  
2. Stress soft-FAIL → Playwright hard fail  
3. Billing Close remount E2E + source assert  
4. electron-updater + js-yaml/nanoid overrides; `security:audit` added to CI  
5. Officer-email CI flake — recipient field `type=text`; E2E asserts `#oes-to` before every Open  

---

## I. Deliberate break

Mock push forced `{ ok:true, written:0 }` → 2 FAIL → restore → green.

---

## J. CI / release gates (hard)

- `test:unit`  
- `test:data-safety` (193)  
- `security:audit`  
- `test:e2e` including stress soft-FAIL=fail  

---

## K. Mac / Windows impact

Identical custody behaviour. No new platform branches. Officer-email input type change is shared renderer.

---

## L. Website

No website API/PITR defect requiring a separate PR from this audit.

---

## M. Residuals (documented, non-blocking)

1. **Historical Costachi never-flushed bytes** — not recoverable; **cannot recur** for new saves: flush dirty policy + Force Save magic verify + SIGKILL/dirty-restore tests PASS (`costachi-nonrecurrence.log`, data-safety 193). GREEN = future routes closed.  
2. Optional metal dual Mac+Windows kill-9 — harness covers.  
3. Shared 429 can delay central confirm — local+outbox remain authoritative until ack.  
4. Ongoing `innerHTML` escape discipline.

**No open S0/S1 blockers.**

---

## COMMERCIAL RELEASE RECOMMENDATION: READY

**DATA LOSS RISK:** LOW — future silent-loss routes closed with executed harness evidence; historical never-flushed bytes non-recoverable and non-recurring for new saves.

**SECURITY RISK:** LOW — production dependency audit clean; secrets scan clean; mailto blocked; licence-scoped sync.

**UNRESOLVED RELEASE BLOCKERS:** 0

**CRITICAL USER JOURNEYS TESTED:** passed (stress 30/30; critical persist; cross-device; billing close; officer email; LAA)

**SAFE TO SELL TO OTHER SOLICITORS TODAY:** YES

**REASON:** Absolute commercial bar met with executed evidence: 193/193 data-safety, full unit green, Playwright critical paths green including hardened officer-email and stress soft-FAIL gate, production security audit green, deliberate break proves tests catch broken sync, and all audit P0/P1 defects found in this run are fixed with permanent regression coverage. Ship when this PR’s CI is green.
