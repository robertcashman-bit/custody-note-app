/**
 * Electron + Playwright: drive Officer Emails standalone UI and assert the
 * Open-Outlook launch payload contains the CURRENT email-box text.
 *
 * Real Outlook GUI is not opened (CI has no Outlook). When
 * CUSTODYNOTE_TEST_USERDATA is set, main writes last-outlook-launch.json
 * with the exact URL / .eml payload that would be launched.
 */
import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { dismissFirstLaunchModalIfPresent, clickConfirmOverlayPrimary } from './e2e-helpers';

let electronApp: ElectronApplication;
let page: Page;
let testUserData: string;

const SPECIAL_BODY = [
  'Dear Officer,',
  '',
  'Re: Smith & Jones — CR/12345/26',
  '',
  "The client's position is that he didn't attend the address.",
  '',
  'Please confirm whether CCTV, BWV and/or telephone evidence has been obtained.',
  '',
  'Kind regards,',
  'Robert Cashman',
].join('\n');

type LaunchCapture = {
  method: string;
  to: string;
  subject: string;
  body: string;
  url: string;
  bodyUsedInUrl: string;
  emlContent: string;
  bodyPlacedInCompose: boolean;
  capturedAt?: string;
};

const CAPTURE_WAIT_MS = 45_000;
const CAPTURE_POLL_MS = 150;
const OPEN_ATTEMPTS = 3;

test.beforeAll(async () => {
  testUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-officer-email-e2e-'));
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
  const splash = page.locator('#splash');
  await splash.waitFor({ state: 'hidden', timeout: 60000 }).catch(async () => {
    await page.waitForSelector('.app-header, #header-app-title', { timeout: 30000 });
  });
  await page.waitForFunction(() => typeof (window as unknown as { api?: unknown }).api !== 'undefined', {
    timeout: 30000,
  });
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
    } catch {
      /* ignore */
    }
    try {
      const proc = electronApp.process();
      if (proc && !proc.killed) proc.kill();
    } catch {
      /* ignore */
    }
  }
  try {
    fs.rmSync(testUserData, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function capturePath(): string {
  return path.join(testUserData, 'last-outlook-launch.json');
}

function readCapture(): LaunchCapture {
  const raw = fs.readFileSync(capturePath(), 'utf8');
  return JSON.parse(raw) as LaunchCapture;
}

function tryReadCapture(): LaunchCapture | null {
  try {
    return readCapture();
  } catch {
    return null;
  }
}

function captureFingerprint(): string {
  const cap = tryReadCapture();
  if (!cap) return '';
  /* Prefer capturedAt (stable across coarse FS mtime); fall back to body+url. */
  if (cap.capturedAt) return `at:${cap.capturedAt}`;
  return `body:${cap.body}\nurl:${cap.url}\nmethod:${cap.method}`;
}

function fingerprintOf(cap: LaunchCapture): string {
  if (cap.capturedAt) return `at:${cap.capturedAt}`;
  return `body:${cap.body}\nurl:${cap.url}\nmethod:${cap.method}`;
}

/** Dismiss credential-free session blanker if a CI OS lock event raised it. */
async function ensureBlankerNotBlocking(): Promise<void> {
  const blanker = page.locator('#cn-credentialfree-blanker');
  if (!(await blanker.isVisible({ timeout: 400 }).catch(() => false))) return;

  const dismiss = page.locator('#cn-credentialfree-dismiss');
  if (await dismiss.isVisible({ timeout: 500 }).catch(() => false)) {
    await dismiss.click();
    await blanker.waitFor({ state: 'hidden', timeout: 10000 });
    return;
  }

  const unlock = page.locator('#cn-credentialfree-unlock-session');
  if (await unlock.isVisible({ timeout: 500 }).catch(() => false)) {
    await unlock.click();
    const confirmYes = page.locator('#cn-credentialfree-confirm-yes');
    await confirmYes.waitFor({ state: 'visible', timeout: 5000 });
    await confirmYes.click();
    await blanker.waitFor({ state: 'hidden', timeout: 10000 });
    return;
  }

  /* Last resort: remove overlay so the Open Outlook click can fire. */
  await page.evaluate(() => {
    const el = document.getElementById('cn-credentialfree-blanker');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  });
}

async function dismissStuckConfirmOverlay(): Promise<void> {
  const overlay = page.locator('.cn-confirm-overlay');
  if (!(await overlay.count().catch(() => 0))) return;
  const cancel = overlay.locator('[data-cn-choice-id="abort"], button:has-text("Cancel")').first();
  if (await cancel.count().catch(() => 0)) {
    await cancel.evaluate((el: HTMLElement) => el.click()).catch(() => undefined);
  } else {
    await page.keyboard.press('Escape').catch(() => undefined);
  }
  await overlay.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined);
}

async function openOfficerEmailsView(): Promise<void> {
  await ensureBlankerNotBlocking();
  const card = page.locator('#home-card-officer-emails');
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await expect(page.locator('#view-officer-emails')).toHaveClass(/active/, { timeout: 15000 });
  await expect(page.locator('#oes-body')).toBeVisible({ timeout: 15000 });
}

async function setOfficerComposeFields(opts: {
  to?: string;
  subject?: string;
  body?: string;
}): Promise<void> {
  const to = opts.to;
  const subject = opts.subject;
  const body = opts.body;
  if (to != null) {
    await page.locator('#oes-to').fill(to);
    await page.locator('#oes-to').dispatchEvent('input');
    await expect(page.locator('#oes-to')).toHaveValue(to, { timeout: 5000 });
  }
  if (subject != null) {
    await page.locator('#oes-subject').fill(subject);
    await page.locator('#oes-subject').dispatchEvent('input');
    await expect(page.locator('#oes-subject')).toHaveValue(subject, { timeout: 5000 });
  }
  if (body != null) {
    await page.locator('#oes-body').fill(body);
    await page.locator('#oes-body').dispatchEvent('input');
    await expect(page.locator('#oes-body')).toHaveValue(body, { timeout: 5000 });
  }
}

/**
 * Click Open in Outlook Web and wait until a NEW last-outlook-launch.json appears.
 * Combines confirm-overlay handling with capture polling so a late overlay
 * (after generateFromTemplate) is still clicked — the old 15s overlay wait then
 * 60s capture wait left confirmOverlay=0 and never called go().
 */
async function clickOpenOutlookOnce(): Promise<LaunchCapture> {
  await ensureBlankerNotBlocking();
  await expect(page.locator('#cn-credentialfree-blanker')).toHaveCount(0);

  /* Re-assert recipient before every Open — Windows CI has flaked with a
   * toast "recipient email does not look valid" when #oes-to was empty/partial. */
  const toVal = await page.locator('#oes-to').inputValue();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(toVal || '').trim())) {
    await setOfficerComposeFields({ to: 'officer@kent.police.uk' });
  }

  const before = captureFingerprint();

  /* Auto-confirm native window.confirm fallback if showChoice is absent. */
  page.once('dialog', async (dialog) => {
    try {
      await dialog.accept();
    } catch {
      /* ignore */
    }
  });

  /* Blur textarea/inputs so leftover key events cannot hit Cancel. */
  await page.evaluate(() => {
    const ae = document.activeElement as HTMLElement | null;
    if (ae && typeof ae.blur === 'function') ae.blur();
  });

  const openBtn = page.locator('#oes-open');
  await expect(openBtn).toBeVisible({ timeout: 15000 });
  await expect(openBtn).toBeEnabled();
  await openBtn.scrollIntoViewIfNeeded();
  /* DOM click avoids intermittent Electron hit-test misses under toast chrome. */
  await openBtn.evaluate((el: HTMLElement) => el.click());

  const deadline = Date.now() + CAPTURE_WAIT_MS;
  let clickedPrimary = false;
  let lastOpenClickAt = Date.now();
  let reclicks = 0;

  while (Date.now() < deadline) {
    const cap = tryReadCapture();
    if (cap) {
      const fp = fingerprintOf(cap);
      if (fp && fp !== before) return cap;
    }

    const overlayVisible = await page
      .locator('.cn-confirm-overlay')
      .isVisible()
      .catch(() => false);

    if (overlayVisible && !clickedPrimary) {
      await ensureBlankerNotBlocking();
      const ok = await clickConfirmOverlayPrimary(page, {
        choiceId: 'open',
        name: 'Open Outlook Web',
        timeoutMs: 5_000,
      });
      clickedPrimary = ok || clickedPrimary;
      lastOpenClickAt = Date.now();
    } else if (!overlayVisible && !clickedPrimary && reclicks < 2 && Date.now() - lastOpenClickAt > 2500) {
      /* Overlay never appeared — re-fire Open (first click may have raced generate). */
      lastOpenClickAt = Date.now();
      reclicks += 1;
      await ensureBlankerNotBlocking();
      const again = await page.locator('#oes-to').inputValue().catch(() => '');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(again || '').trim())) {
        await setOfficerComposeFields({ to: 'officer@kent.police.uk' });
      }
      await openBtn.evaluate((el: HTMLElement) => el.click()).catch(() => undefined);
    }

    await page.waitForTimeout(CAPTURE_POLL_MS);
  }

  const blanker = await page.locator('#cn-credentialfree-blanker').count().catch(() => -1);
  const overlay = await page.locator('.cn-confirm-overlay').count().catch(() => -1);
  const toastText = await page.locator('#cn-toast').textContent().catch(() => '');
  const toAtFail = await page.locator('#oes-to').inputValue().catch(() => '');
  const exists = fs.existsSync(capturePath());
  throw new Error(
    `timed out waiting for last-outlook-launch.json` +
      ` (waited ${CAPTURE_WAIT_MS}ms, exists=${exists}, blanker=${blanker}, confirmOverlay=${overlay}` +
      `, clickedPrimary=${clickedPrimary}, reclicks=${reclicks}` +
      `, oesTo=${JSON.stringify(String(toAtFail).slice(0, 80))}` +
      (toastText ? `, toast=${JSON.stringify(String(toastText).slice(0, 160))}` : '') +
      `)`
  );
}

async function clickOpenOutlook(): Promise<LaunchCapture> {
  const errors: string[] = [];
  for (let attempt = 1; attempt <= OPEN_ATTEMPTS; attempt++) {
    try {
      return await clickOpenOutlookOnce();
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
      await dismissStuckConfirmOverlay();
      await ensureBlankerNotBlocking();
      await page.waitForTimeout(300);
    }
  }
  throw new Error(
    `Open Outlook capture failed after ${OPEN_ATTEMPTS} attempts. ` + errors.map((e, i) => `#${i + 1}: ${e}`).join(' | ')
  );
}

test('A/B/C/D/E/F officer-email Open Outlook uses live box text in launch payload', async () => {
  test.setTimeout(300_000);
  await openOfficerEmailsView();

  /* C) completely typed replacement — use kent.police.uk (allowlisted root) */
  const RECIPIENT = 'officer@kent.police.uk';
  const typed = 'Completely typed replacement body.\n\nSecond paragraph.';
  await setOfficerComposeFields({
    to: RECIPIENT,
    subject: 'Typed subject',
    body: typed,
  });
  let cap = await clickOpenOutlook();
  expect(cap.body).toBe(typed);
  expect(cap.bodyPlacedInCompose).toBe(true);
  expect(cap.method).toBe('outlook-web');
  expect(cap.to).toBe(RECIPIENT);
  expect(new URL(cap.url).searchParams.get('body')?.replace(/\r\n/g, '\n')).toBe(typed);

  /* A/B) generate then amend */
  await page.locator('#oes-client').fill('Joe Bloggs');
  await page.locator('#oes-station').fill('Tonbridge');
  await page.locator('#oes-date').fill('15.05.26');
  await page.locator('#oes-offence').fill('Theft');
  await page.locator('#oes-gen').click();
  await page.waitForTimeout(800);
  const generated = await page.locator('#oes-body').inputValue();
  expect(generated.length).toBeGreaterThan(20);
  await expect(page.locator('#oes-to')).toHaveValue(RECIPIENT);

  /* A) unedited generated */
  cap = await clickOpenOutlook();
  expect(cap.body).toBe(generated);
  expect(cap.body).toContain('Joe Bloggs');

  /* B) amended */
  const amended = generated + '\n\nAMENDED LIVE MARKER';
  await setOfficerComposeFields({ body: amended });
  cap = await clickOpenOutlook();
  expect(cap.body).toBe(amended);
  expect(cap.body).toContain('AMENDED LIVE MARKER');
  expect(new URL(cap.url).searchParams.get('body')?.replace(/\r\n/g, '\n')).toBe(amended);

  /* D + E special multiline */
  await setOfficerComposeFields({ subject: 'Re: Smith & Jones', body: SPECIAL_BODY });
  cap = await clickOpenOutlook();
  expect(cap.body).toBe(SPECIAL_BODY);
  const decoded = new URL(cap.url).searchParams.get('body') || '';
  expect(decoded.replace(/\r\n/g, '\n')).toBe(SPECIAL_BODY);
  expect(decoded).toContain("didn't");
  expect(decoded).toContain('Smith & Jones');

  /* F) second click newest */
  await setOfficerComposeFields({ body: 'second click newest body' });
  cap = await clickOpenOutlook();
  expect(cap.body).toBe('second click newest body');

  /* Long body → .eml path with full body */
  const longBody = 'LIVE_LONG_MARKER\n\n' + 'x'.repeat(5000);
  await setOfficerComposeFields({ body: longBody });
  cap = await clickOpenOutlook();
  expect(cap.body).toBe(longBody);
  expect(cap.method).toBe('outlook-desktop-eml');
  expect(cap.url).not.toContain('body=');
  expect(cap.emlContent).toContain('X-Unsent: 1');
  expect(cap.emlContent).toContain('LIVE_LONG_MARKER');
});
