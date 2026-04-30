/**
 * User-style walkthrough of "Quick email to officer" with PNG screenshots.
 * Saves files under test-results/quick-email-screenshots/ (gitignored via test-results).
 *
 * Simulates an entitled user (Officer Email Templates add-on + toggle on) via in-page flags
 * so the quick-email controls are visible without a live licence server.
 */
import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { dismissFirstLaunchModalIfPresent, enableQuickOfficerEmailUi } from './e2e-helpers';

let electronApp: ElectronApplication;
let page: Page;
let testUserData: string;

const shotDir = path.join(__dirname, '..', '..', 'test-results', 'quick-email-screenshots');

async function shot(name: string): Promise<string> {
  fs.mkdirSync(shotDir, { recursive: true });
  const filePath = path.join(shotDir, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

test.beforeAll(async () => {
  testUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-quick-email-shot-'));
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
        new Promise<void>(resolve => setTimeout(resolve, 12_000)),
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

test('quick email to officer — user flow screenshots', async () => {
  await page.locator('#view-home.active, #view-home').first().waitFor({ state: 'visible', timeout: 15000 });
  await shot('01-home-before-quick-email-controls');

  await enableQuickOfficerEmailUi(page);

  await expect(page.locator('#home-card-quick-email')).toBeVisible();
  await shot('02-home-with-quick-email-to-officer-card');

  await page.locator('.bottom-nav-btn[data-nav="list"]').click();
  await page.locator('#view-list.active').waitFor({ state: 'visible', timeout: 15000 });
  /* Navigation can refresh licence/add-on UI and re-hide the toolbar control */
  await enableQuickOfficerEmailUi(page);
  await expect(page.locator('#list-quick-email-btn')).toBeVisible();
  await shot('03-records-toolbar-quick-email-to-officer');

  await page.locator('#list-quick-email-btn').click();
  await page.locator('#email-oic-modal').waitFor({ state: 'visible', timeout: 15000 });
  await expect(page.locator('#email-oic-modal .email-oic-title')).toContainText(/Email OIC/i);

  await page.locator('#email-oic-to').fill('oic.example@police.uk');
  await shot('04-email-oic-modal-filled-ready-for-outlook-web');

  await page.locator('.email-oic-close').first().click();
  await page.locator('#email-oic-modal').waitFor({ state: 'detached', timeout: 10000 }).catch(async () => {
    await expect(page.locator('#email-oic-modal')).toHaveCount(0);
  });

  /* Officer Emails full-page path (separate from Email OIC modal) */
  await page.locator('.bottom-nav-btn[data-nav="home"]').click();
  await page.locator('#view-home.active').waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('#openOfficerEmailsBtn').click();
  await page.locator('#view-officer-emails').waitFor({ state: 'visible', timeout: 15000 });
  await shot('05-officer-emails-full-page');

  console.log('[quick-email screenshots] Wrote PNGs under:', shotDir);
});
