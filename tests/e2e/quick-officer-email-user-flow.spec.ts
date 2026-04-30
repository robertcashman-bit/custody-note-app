/**
 * User-style automation: Records toolbar → Quick email to officer → fill fields →
 * "Open in Outlook Web" (same path as a real user; composes via main-process OWA URL).
 *
 * Native Outlook privacy dialog cannot be driven by Playwright — main honours
 * CUSTODYNOTE_E2E_SKIP_OUTLOOK_CONFIRM=1 for this suite only.
 *
 * With CUSTODYNOTE_E2E_CAPTURE_LAUNCH_URL=1, main writes the exact compose URL to
 * userData/e2e-last-compose-url.txt; Playwright Chromium then opens it to verify
 * the external browser reaches Microsoft (OWA or sign-in redirect).
 *
 * Long-body test: forces OWA URL over the soft limit → main copies the (modal-truncated)
 * body to the system clipboard → we read the clipboard and Ctrl+V into a textarea to prove
 * the same paste path as “paste into Outlook Web” (OWA itself is login/DOM-heavy).
 */
import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import os from 'os';
import {
  dismissFirstLaunchModalIfPresent,
  dismissEmailOicModalIfPresent,
  enableQuickOfficerEmailUi,
  officerBodyForcingLongComposeUrl,
  systemClipboardReadable,
  readSystemClipboardText,
  assertClipboardPastesIntoBrowserTextarea,
} from './e2e-helpers';

let electronApp: ElectronApplication;
let page: Page;
let testUserData: string;

test.beforeAll(async () => {
  testUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-quick-officer-e2e-'));
  electronApp = await _electron.launch({
    args: [path.join(__dirname, '..', '..', 'main.js')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CUSTODYNOTE_TEST_USERDATA: testUserData,
      CUSTODYNOTE_E2E_SKIP_LICENCE_GATE: '1',
      CUSTODYNOTE_E2E_SKIP_OUTLOOK_CONFIRM: '1',
      CUSTODYNOTE_E2E_CAPTURE_LAUNCH_URL: '1',
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
    /* ignore cleanup on Windows file locks */
  }
});

test.describe('Quick email to officer (toolbar)', () => {
  test('fills test data, opens Outlook path, and Chromium loads the compose URL', async () => {
    test.setTimeout(180_000);

    await test.step('Electron: quick officer modal → Open in Outlook Web', async () => {
      await page.locator('#view-home.active, #view-home').first().waitFor({ state: 'visible', timeout: 15000 });
      await enableQuickOfficerEmailUi(page);

      await page.locator('.bottom-nav-btn[data-nav="list"]').click();
      await page.locator('#view-list.active').waitFor({ state: 'visible', timeout: 15000 });
      await enableQuickOfficerEmailUi(page);

      await expect(page.locator('#list-quick-email-btn')).toBeVisible({ timeout: 10000 });
      await page.locator('#list-quick-email-btn').click();

      await page.locator('#email-oic-modal').waitFor({ state: 'visible', timeout: 15000 });
      await expect(page.locator('#email-oic-modal .email-oic-title')).toContainText(/Email OIC/i);

      const marker = `E2E-QuickOfficer-${Date.now()}`;
      await page.locator('#email-oic-to').fill('oic.automation@police.example.uk');
      await page.locator('#email-oic-subject').fill(`Subject ${marker}`);
      await page.locator('#email-oic-body').fill(
        `Automated quick-officer body.\nMarker: ${marker}\nSecond line for newline encoding.`
      );

      await page.locator('#email-oic-open-app').click();

      const toast = page.locator('#cn-toast.cn-toast-visible');
      await expect(toast).toBeVisible({ timeout: 25000 });
      await expect(toast).toContainText(/Opening Outlook/i);

      const logPath = path.join(testUserData, 'email-launch.log');
      await expect
        .poll(
          () => {
            try {
              const text = fs.readFileSync(logPath, 'utf8');
              return text.includes('url_launched') && text.includes('outlook.office.com');
            } catch {
              return false;
            }
          },
          { timeout: 8000, message: 'main process should append url_launched to email-launch.log' }
        )
        .toBe(true);

      const urlFile = path.join(testUserData, 'e2e-last-compose-url.txt');
      await expect
        .poll(
          () => {
            try {
              const u = fs.readFileSync(urlFile, 'utf8').trim();
              return u.startsWith('https://outlook.office.com/');
            } catch {
              return false;
            }
          },
          { timeout: 5000, message: 'main should write e2e-last-compose-url.txt when CUSTODYNOTE_E2E_CAPTURE_LAUNCH_URL=1' }
        )
        .toBe(true);

      await page.locator('#email-oic-cancel').click();
      await expect(page.locator('#email-oic-modal')).toHaveCount(0, { timeout: 5000 });
    });

    await test.step('External Chromium: same compose URL reaches Microsoft', async () => {
      const urlFile = path.join(testUserData, 'e2e-last-compose-url.txt');
      const composeUrl = fs.readFileSync(urlFile, 'utf8').trim();
      expect(composeUrl.startsWith('https://'), 'captured launch URL must be HTTPS').toBe(true);

      const browser = await chromium.launch({
        headless: true,
        args: ['--disable-dev-shm-usage'],
      });
      try {
        const ctx = await browser.newContext({
          ignoreHTTPSErrors: true,
        });
        const extPage = await ctx.newPage();
        await extPage.goto(composeUrl, {
          timeout: 90_000,
          waitUntil: 'domcontentloaded',
        });

        await expect
          .poll(
            () => {
              const u = extPage.url();
              return (
                /outlook\.office\.com/i.test(u) ||
                /microsoftonline\.com/i.test(u) ||
                /office\.com/i.test(u) ||
                /live\.com/i.test(u)
              );
            },
            {
              timeout: 90_000,
              message:
                'After navigation (including redirects), URL should be Outlook or Microsoft sign-in / Office host',
            }
          )
          .toBe(true);
      } finally {
        await browser.close();
      }
    });
  });

  test('warns when To is empty — does not invoke compose', async () => {
    await page.locator('.bottom-nav-btn[data-nav="list"]').click();
    await page.locator('#view-list.active').waitFor({ state: 'visible', timeout: 15000 });
    await enableQuickOfficerEmailUi(page);

    await page.locator('#list-quick-email-btn').click();
    await page.locator('#email-oic-modal').waitFor({ state: 'visible', timeout: 15000 });

    await page.locator('#email-oic-to').fill('');
    await page.locator('#email-oic-open-app').click();

    const toast = page.locator('#cn-toast.cn-toast-visible');
    await expect(toast).toBeVisible({ timeout: 10000 });
    await expect(toast).toContainText(/officer email address/i);
  });

  test('full user journey: long message → clipboard + OWA URL + browser paste (like Outlook Web)', async ({
    },
    testInfo) => {
    test.setTimeout(300_000);
    if (!systemClipboardReadable()) {
      testInfo.skip(true, 'OS clipboard read requires Windows, macOS, or Linux with xclip');
    }

    const marker = `OWA_USER_PASTE_${Date.now()}`;
    const longBody = officerBodyForcingLongComposeUrl(marker);

    await test.step('Electron: fill quick officer email (long body → URL truncation + clipboard)', async () => {
      await dismissEmailOicModalIfPresent(page);

      await page.locator('.bottom-nav-btn[data-nav="list"]').click();
      await page.locator('#view-list.active').waitFor({ state: 'visible', timeout: 15000 });
      await enableQuickOfficerEmailUi(page);

      await page.locator('#list-quick-email-btn').click();
      await page.locator('#email-oic-modal').waitFor({ state: 'visible', timeout: 15000 });

      await page.locator('#email-oic-to').fill('oic.fulljourney@police.example.uk');
      await page.locator('#email-oic-subject').fill(`Full journey ${marker}`);
      await page.locator('#email-oic-body').evaluate((el, text: string) => {
        const ta = el as HTMLTextAreaElement;
        ta.value = text;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }, longBody);

      await page.locator('#email-oic-open-app').click();

      await expect(page.locator('#cn-toast.cn-toast-visible')).toContainText(/Opening Outlook/i, {
        timeout: 25000,
      });

      const logPath = path.join(testUserData, 'email-launch.log');
      await expect
        .poll(
          () => {
            try {
              const text = fs.readFileSync(logPath, 'utf8');
              return (
                text.includes('"event":"url_built"') &&
                (text.includes('"truncated":true') || text.includes('"truncated": true'))
              );
            } catch {
              return false;
            }
          },
          { timeout: 12000, message: 'url_built trace should show truncated:true when OWA URL was shortened' }
        )
        .toBe(true);

      await expect
        .poll(
          () => {
            try {
              const clip = readSystemClipboardText();
              return clip.includes(marker);
            } catch {
              return false;
            }
          },
          {
            timeout: 8000,
            message:
              'Main process copies modal-sized body to clipboard when URL is truncated — marker must be present',
          }
        )
        .toBe(true);

      await expect
        .poll(
          () => {
            try {
              const text = fs.readFileSync(logPath, 'utf8');
              return text.includes('url_launched') && text.includes('outlook.office.com');
            } catch {
              return false;
            }
          },
          { timeout: 8000 }
        )
        .toBe(true);

      const urlFile = path.join(testUserData, 'e2e-last-compose-url.txt');
      await expect
        .poll(
          () => {
            try {
              const u = fs.readFileSync(urlFile, 'utf8').trim();
              return u.startsWith('https://outlook.office.com/');
            } catch {
              return false;
            }
          },
          { timeout: 5000 }
        )
        .toBe(true);

      await page.locator('#email-oic-cancel').click();
      await expect(page.locator('#email-oic-modal')).toHaveCount(0, { timeout: 5000 });
    });

    await test.step('Chromium: open compose URL (same as default browser)', async () => {
      const composeUrl = fs.readFileSync(path.join(testUserData, 'e2e-last-compose-url.txt'), 'utf8').trim();

      const browser = await chromium.launch({
        headless: true,
        args: ['--disable-dev-shm-usage'],
      });
      try {
        const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
        const extPage = await ctx.newPage();
        await extPage.goto(composeUrl, { timeout: 90_000, waitUntil: 'domcontentloaded' });

        await expect
          .poll(
            () => {
              const u = extPage.url();
              return (
                /outlook\.office\.com/i.test(u) ||
                /microsoftonline\.com/i.test(u) ||
                /office\.com/i.test(u) ||
                /live\.com/i.test(u)
              );
            },
            { timeout: 90_000, message: 'Compose navigation should land on Microsoft / Outlook hosts' }
          )
          .toBe(true);

        await test.step('Paste clipboard into page — same operation as pasting into OWA compose', async () => {
          await assertClipboardPastesIntoBrowserTextarea(extPage, marker);
        });
      } finally {
        await browser.close();
      }
    });
  });
});
