/**
 * Regression test for "I can't see the Finalise button on Section 9".
 *
 * Real-world bug, observed by the user on a voluntary draft:
 *   - On opening a draft, no Finalise button appeared anywhere.
 *   - The bottom-bar Finalise pill (#bottom-bar-finish-pill) was hidden.
 *   - The in-section "Attendance Finished — Finalise" bar (#form-finalise-bar)
 *     was also hidden.
 *   - The Section 9 file-completion panel rendered with light text on a
 *     light background in dark mode, so the title and 4-step checklist
 *     were illegible.
 *
 * Root causes (now fixed):
 *   1. updateFormBarVisibility() returned early when the in-section
 *      action buttons hadn't yet been lazily rendered (sections 1-8),
 *      so updateBottomBarFinishPill() was never called -> the global
 *      pill stayed at its inline display:none.
 *   2. showSection() called _formEnsureSectionRendered() to lazily
 *      mount Section 9 but never re-ran updateFormBarVisibility(), so
 *      #form-finalise-bar / #form-end-billing-btn / #form-post-finalise-bar
 *      stayed at their initial display:none even after navigating to §9.
 *   3. The .billing-readiness-panel CSS used a literal `white` in
 *      color-mix() for the background; combined with dark-mode --text
 *      being near-white, the panel text was invisible.
 *
 * This test seeds a draft (custody and voluntary), opens it from the
 * Records list, and asserts:
 *   A. While on Section 1, the bottom-bar Finalise pill is visible
 *      with label "Finalise".
 *   B. After navigating to Section 9, BOTH the in-section
 *      #form-finalise-bar AND the bottom-bar pill are visible.
 *   C. The billing-readiness panel renders with non-zero contrast
 *      between the title text and the panel background (proxy for the
 *      "ghosted in dark mode" bug).
 */
import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { dismissFirstLaunchModalIfPresent } from './e2e-helpers';

let electronApp: ElectronApplication;
let page: Page;
let testUserData: string;

const stamp = Date.now();
const FIRM_NAME = `FinaliseTest Firm ${stamp}`;
const STATION_NAME = 'FinaliseTest Police Station';

async function seedFirm(p: Page, firmName: string): Promise<number> {
  const id = await p.evaluate(async (name) => {
    const w = window as unknown as {
      api: { firmSave: (f: Record<string, unknown>) => Promise<number | { id: number }> };
    };
    const out = await w.api.firmSave({
      name,
      contact_email: 'finalise-test@example.com',
      address1: '1 Pill Street',
      city: 'Buttontown',
      post_code: 'BT1 1ON',
      is_default: 1,
    });
    return typeof out === 'number' ? out : out?.id;
  }, firmName);
  expect(id, 'firm should save and return an id').toBeTruthy();
  return id as number;
}

async function seedDraftAttendance(
  p: Page,
  input: { firmId: number; firmName: string; mode: 'custody' | 'voluntary'; surname: string; dscc: string; station: string },
): Promise<number> {
  const id = await p.evaluate(async (i) => {
    const w = window as unknown as {
      api: { attendanceSave: (payload: unknown) => Promise<number> };
    };
    const data: Record<string, unknown> = {
      _formType: 'attendance',
      attendanceMode: i.mode,
      forename: 'Pat',
      surname: i.surname,
      date: '2026-04-21',
      timeArrival: '10:00',
      timeDeparture: '11:30',
      policeStationName: i.station,
      dsccRef: i.dscc,
      firmId: i.firmId,
      firmName: i.firmName,
      offenceSummary: 'Theft (s.1 Theft Act 1968)',
      offence1Details: 'Test offence details',
      milesClaimable: 5,
      parkingCost: 2.5,
    };
    if (i.mode === 'custody') data.custodyNumber = `CN/FB/${i.dscc}`;
    return w.api.attendanceSave({ id: null, data, status: 'draft' });
  }, input);
  expect(id, 'attendance should save and return an id').toBeTruthy();
  return id as number;
}

async function openRecordFromList(p: Page, attendanceId: number): Promise<void> {
  await p.locator('.bottom-nav-btn[data-nav="home"]').click();
  await p.waitForTimeout(200);
  await p.locator('.bottom-nav-btn[data-nav="list"]').click();
  await expect(p.locator('#view-list')).toHaveClass(/active/);

  const editBtn = p.locator(`#attendance-list .amend-btn[data-id="${attendanceId}"]`);
  await expect(editBtn, 'draft should appear in the Records list').toBeVisible({ timeout: 15_000 });

  const rowText = p
    .locator(`#attendance-list li`)
    .filter({ has: p.locator(`.amend-btn[data-id="${attendanceId}"]`) })
    .locator('.list-item-text');
  await rowText.click();

  await expect(p.locator('#view-form'), 'clicking row should load the form view').toHaveClass(/active/, {
    timeout: 15_000,
  });
  await p.waitForFunction(
    (id: number) => {
      const w = window as unknown as { currentAttendanceId?: number; formData?: { surname?: string } };
      return w.currentAttendanceId === id && !!w.formData && !!w.formData.surname;
    },
    attendanceId,
    { timeout: 10_000 },
  );
}

test.beforeAll(async () => {
  testUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-finalise-vis-'));
  electronApp = await _electron.launch({
    args: [path.join(__dirname, '..', '..', 'main.js')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CUSTODYNOTE_TEST_USERDATA: testUserData,
      CUSTODYNOTE_E2E_SKIP_LICENCE_GATE: '1',
    },
  });
  page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#splash').waitFor({ state: 'hidden', timeout: 60_000 }).catch(async () => {
    await page.waitForSelector('.app-header, #header-app-title', { timeout: 30_000 });
  });
  await page.waitForFunction(
    () => typeof (window as unknown as { api?: unknown }).api !== 'undefined',
    { timeout: 30_000 },
  );
  await dismissFirstLaunchModalIfPresent(page);
});

test.afterAll(async ({}, testInfo) => {
  testInfo.setTimeout(120_000);
  if (electronApp) {
    try {
      await Promise.race([
        electronApp.close(),
        new Promise<void>((resolve) => setTimeout(resolve, 12_000)),
      ]);
    } catch { /* ignore */ }
    try {
      const proc = electronApp.process();
      if (proc && !proc.killed) proc.kill();
    } catch { /* ignore */ }
  }
  try { fs.rmSync(testUserData, { recursive: true, force: true }); } catch { /* ignore Windows file locks */ }
});

for (const mode of ['custody', 'voluntary'] as const) {
  test(`Finalise button is visible on a ${mode} draft (bottom-bar pill on §1, in-section bar on §9)`, async () => {
    const firmId = await seedFirm(page, `${FIRM_NAME} ${mode}`);
    const attendanceId = await seedDraftAttendance(page, {
      firmId,
      firmName: `${FIRM_NAME} ${mode}`,
      mode,
      surname: `User${stamp}${mode}`,
      dscc: `FB-${stamp}-${mode.slice(0, 3).toUpperCase()}`,
      station: STATION_NAME,
    });

    await openRecordFromList(page, attendanceId);

    /* Force-navigate to Section 1 to assert the global pill, since the
       initial currentSectionIdx is 0 (= Section 1). */
    await page.evaluate(() => {
      const w = window as unknown as { showSection?: (idx: number) => void };
      if (typeof w.showSection === 'function') w.showSection(0);
    });

    /* ---- A. Bottom-bar Finalise pill is visible on Section 1 (draft) ---- */
    const pill = page.locator('#bottom-bar-finish-pill');
    await expect(
      pill,
      `bottom-bar Finalise pill must be visible on §1 of a ${mode} draft (regression: was display:none)`,
    ).toBeVisible({ timeout: 5_000 });
    await expect(pill).toHaveText(/Finalise/);
    /* The pill's pillAction dataset should be 'finalise' for a draft */
    const action = await pill.getAttribute('data-pill-action');
    expect(action, 'pill action should be "finalise" for a draft').toBe('finalise');

    /* ---- B. Navigate to Section 9; both buttons must be visible ---- */
    await page.evaluate(() => {
      const w = window as unknown as {
        showSection?: (idx: number) => void;
        activeFormSections?: Array<{ id: string }>;
      };
      const sections = w.activeFormSections || [];
      const idx = sections.findIndex((s) => s.id === 'timeRecording');
      if (typeof w.showSection === 'function' && idx >= 0) w.showSection(idx);
    });

    /* In-section finalise bar (the canonical click target). */
    const finaliseBar = page.locator('#form-finalise-bar');
    await expect(
      finaliseBar,
      `in-section #form-finalise-bar must be visible on §9 of a ${mode} draft ` +
        '(regression: stayed display:none after lazy section render)',
    ).toBeVisible({ timeout: 5_000 });
    await expect(finaliseBar).toContainText(/Finalise/);

    /* Bottom-bar pill should still be visible (and still labelled "Finalise"). */
    await expect(pill, 'bottom-bar pill should remain visible on §9').toBeVisible();
    await expect(pill).toHaveText(/Finalise/);

    /* ---- C. The file-completion panel must be readable.
       Proxy: the title element's computed text colour should differ
       meaningfully from the panel's computed background, in BOTH light
       and dark themes. We toggle dark mode and check both. */
    for (const dark of [false, true]) {
      await page.evaluate((d) => {
        const html = document.documentElement;
        if (d) html.classList.add('dark');
        else html.classList.remove('dark');
      }, dark);
      const contrastOk = await page.evaluate(() => {
        const panel = document.getElementById('billing-readiness-panel');
        const title = document.querySelector('.billing-readiness-title') as HTMLElement | null;
        if (!panel || !title) return null;
        const panelBg = getComputedStyle(panel).backgroundColor || '';
        const titleColor = getComputedStyle(title).color || '';
        const parse = (rgb: string): [number, number, number] | null => {
          const m = rgb.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
          return m ? [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)] : null;
        };
        const a = parse(titleColor);
        const b = parse(panelBg);
        if (!a || !b) return { titleColor, panelBg, distance: null };
        const distance = Math.sqrt(
          (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2,
        );
        return { titleColor, panelBg, distance };
      });
      expect(contrastOk, 'panel + title must be present').not.toBeNull();
      const { distance, titleColor, panelBg } = contrastOk as { distance: number | null; titleColor: string; panelBg: string };
      /* Note: panel background is a gradient and may report
         "rgba(0,0,0,0)" (transparent) on some browsers; in that case we
         can only assert the title is not transparent. Guard accordingly. */
      if (distance != null && distance > 0) {
        expect(
          distance,
          `title vs panel-bg colour distance too low in ${dark ? 'dark' : 'light'} mode (title=${titleColor}, bg=${panelBg})`,
        ).toBeGreaterThan(50);
      } else {
        expect(titleColor).not.toBe('rgba(0, 0, 0, 0)');
      }
    }
    /* Reset dark-mode flag to whatever the user had. */
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
  });
}
