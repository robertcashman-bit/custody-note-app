/**
 * Full stack: Custody Note (Electron) → capture OWA compose URL → launch **real Microsoft Edge**
 * with `--remote-debugging-port`, attach via Playwright **connectOverCDP**, then navigate to the
 * same URL `shell.openExternal` would open.
 *
 * Deliberately **not** run in default CI — brittle (needs Edge, network, optional login redirects).
 *
 * Enable only on Windows:
 *   set CUSTODYNOTE_E2E_EDGE_CDP=1
 *   npx playwright test tests/e2e/quick-officer-email-edge-cdp.spec.ts
 *
 * PowerShell:
 *   $env:CUSTODYNOTE_E2E_EDGE_CDP='1'; npx playwright test tests/e2e/quick-officer-email-edge-cdp.spec.ts
 */
import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import os from 'os';
import type { ChildProcess } from 'child_process';
import { dismissFirstLaunchModalIfPresent, enableQuickOfficerEmailUi } from './e2e-helpers';
import {
  resolveWindowsMsEdgeExecutable,
  getEphemeralPort,
  waitForCdpHttp,
  launchEdgeRemoteDebugging,
  killEdgeProcess,
} from './edge-cdp-helpers';

const edgeCdpEnabled = process.platform === 'win32' && process.env.CUSTODYNOTE_E2E_EDGE_CDP === '1';

let electronApp: ElectronApplication;
let page: Page;
let testUserData: string;

function describeEdgeCdpSuite(): void {
  test.describe('Quick officer email — Edge CDP (full)', () => {
    test.beforeAll(async () => {
      testUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-edge-cdp-e2e-'));
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
        /* ignore */
      }
    });

    test('quick officer email → Edge remote debugging → CDP navigation matches compose URL', async () => {
      test.setTimeout(300_000);

      let edgeProc: ChildProcess | null = null;
      let edgeProfile = '';

      await test.step('Electron: toolbar quick email → Open in Outlook Web → capture URL file', async () => {
        await page.locator('#view-home.active, #view-home').first().waitFor({ state: 'visible', timeout: 15000 });
        await enableQuickOfficerEmailUi(page);

        await page.locator('.bottom-nav-btn[data-nav="list"]').click();
        await page.locator('#view-list.active').waitFor({ state: 'visible', timeout: 15000 });
        await enableQuickOfficerEmailUi(page);

        await expect(page.locator('#list-quick-email-btn')).toBeVisible({ timeout: 10000 });
        await page.locator('#list-quick-email-btn').click();

        await page.locator('#email-oic-modal').waitFor({ state: 'visible', timeout: 15000 });
        await expect(page.locator('#email-oic-modal .email-oic-title')).toContainText(/Email OIC/i);

        const marker = `E2E-EdgeCDP-${Date.now()}`;
        await page.locator('#email-oic-to').fill('oic.automation@police.example.uk');
        await page.locator('#email-oic-subject').fill(`Subject ${marker}`);
        await page.locator('#email-oic-body').fill(
          `Edge CDP automation body.\nMarker: ${marker}\nVerifies external Edge + CDP.`
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
            { timeout: 5000, message: 'main should write e2e-last-compose-url.txt' }
          )
          .toBe(true);

        await page.locator('#email-oic-cancel').click();
        await expect(page.locator('#email-oic-modal')).toHaveCount(0, { timeout: 5000 });
      });

      await test.step('Edge: spawn with --remote-debugging-port, connectOverCDP, goto compose URL', async () => {
        const edgeExe = resolveWindowsMsEdgeExecutable();
        expect(edgeExe, 'Microsoft Edge (msedge.exe) must be installed under Program Files or LocalAppData').not.toBeNull();

        const composeUrl = fs.readFileSync(path.join(testUserData, 'e2e-last-compose-url.txt'), 'utf8').trim();
        expect(composeUrl.startsWith('https://'), 'captured launch URL must be HTTPS').toBe(true);

        edgeProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-edge-profile-cdp-'));
        const port = await getEphemeralPort();

        edgeProc = launchEdgeRemoteDebugging(edgeExe!, port, edgeProfile);

        try {
          await waitForCdpHttp(port, 60_000);

          const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
          try {
            await expect
              .poll(() => browser.contexts().length > 0, {
                timeout: 20_000,
                message: 'Edge should expose at least one browser context over CDP',
              })
              .toBeTruthy();

            const context = browser.contexts()[0];
            let extPage = context.pages()[0];
            if (!extPage) extPage = await context.newPage();

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
                    'Edge tab URL after redirects should be Outlook / Microsoft sign-in / Office (same as real user browser)',
                }
              )
              .toBe(true);
          } finally {
            await browser.close();
          }
        } finally {
          await killEdgeProcess(edgeProc);
          edgeProc = null;
          try {
            if (edgeProfile) fs.rmSync(edgeProfile, { recursive: true, force: true });
          } catch {
            /* ignore Windows locks */
          }
        }
      });
    });
  });
}

if (edgeCdpEnabled) {
  describeEdgeCdpSuite();
} else {
  test.describe.skip('Quick officer email — Edge CDP (full)', () => {
    test('skipped — set CUSTODYNOTE_E2E_EDGE_CDP=1 on Windows', () => {});
  });
}
