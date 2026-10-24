/**
 * Packaged Windows build — PDF viewer must render inside BrowserView.
 * Run only when CUSTODYNOTE_PACKAGED_EXE points at Custody Note.exe (CI job).
 */
import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';
import {
  SYNTHETIC_ATTENDANCE_PDF_HTML,
  artifactPath,
  waitForPdfViewerShellWindow,
  assertBrowserViewPdfRendered,
  sha256File,
  extractPdfAttachmentSha256FromEml,
} from './pdf-viewer-helpers';
import { dismissFirstLaunchModalIfPresent } from './e2e-helpers';

const packagedExe = process.env.CUSTODYNOTE_PACKAGED_EXE;

async function launchPackagedApp(exePath: string, testUserData: string): Promise<ElectronApplication> {
  const exeDir = path.dirname(exePath);
  const launchEnv = {
    ...process.env,
    NODE_ENV: 'test',
    CUSTODYNOTE_TEST_USERDATA: testUserData,
    CUSTODYNOTE_E2E_SKIP_LICENCE_GATE: '1',
    CUSTODYNOTE_PDF_VIEWER_STUB_PRINT: '1',
    CUSTODYNOTE_PDF_VIEWER_STUB_EMAIL: '1',
  };
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await _electron.launch({
        executablePath: exePath,
        cwd: exeDir,
        timeout: 120_000,
        args: ['--enable-logging=stderr'],
        env: launchEnv,
      });
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`[pdf-viewer-packaged] electron launch attempt ${attempt} failed: ${msg.slice(0, 160)}`);
      await new Promise((r) => setTimeout(r, 2500 * attempt));
    }
  }
  throw lastErr;
}

test.describe('Packaged PDF viewer (Windows)', () => {
  test.describe.configure({ timeout: 300_000 });

  test.skip(!packagedExe || !fs.existsSync(packagedExe!), 'Requires CUSTODYNOTE_PACKAGED_EXE');

  let electronApp: ElectronApplication;
  let page: Page;
  let testUserData: string;

  test.beforeAll(async () => {
    test.setTimeout(300_000);
    testUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-pdf-packaged-'));
    const exePath = path.resolve(packagedExe!);
    electronApp = await launchPackagedApp(exePath, testUserData);
    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    const splash = page.locator('#splash');
    await splash.waitFor({ state: 'hidden', timeout: 90_000 }).catch(async () => {
      await page.waitForSelector('.app-header, #header-app-title', { timeout: 30_000 });
    });
    await page.waitForFunction(() => typeof (window as unknown as { api?: unknown }).api !== 'undefined', {
      timeout: 120_000,
    });
    await dismissFirstLaunchModalIfPresent(page);
  });

  test.afterAll(async () => {
    if (electronApp) {
      try {
        await Promise.race([
          electronApp.close(),
          new Promise<void>((resolve) => setTimeout(resolve, 20_000)),
        ]);
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

  test('render, print stub, and email attachment on packaged build', async () => {
    const viewerPromise = waitForPdfViewerShellWindow(electronApp, 90_000);

    const preview = await page.evaluate(async (html) => {
      const w = window as unknown as {
        api: {
          previewPdfFromHtml: (p: { html: string; filename: string }) => Promise<{ ok?: boolean; path?: string; error?: string }>;
        };
      };
      return w.api.previewPdfFromHtml({
        html,
        filename: 'Synthetic_Testclient_attendance_note.pdf',
      });
    }, SYNTHETIC_ATTENDANCE_PDF_HTML);

    expect(preview.ok, preview.error || 'preview failed').toBe(true);
    expect(preview.path).toBeTruthy();
    const sourceSha = sha256File(preview.path!);

    const viewer = await viewerPromise;
    await assertBrowserViewPdfRendered(viewer, electronApp, {
      timeoutMs: 45_000,
      saveAs: artifactPath('viewer-render.png'),
      shellScreenshotAs: artifactPath('pdf-viewer-full-window.png'),
    });

    const beforePrint = await viewer.evaluate(async () => {
      const api = (window as unknown as { pdfViewerApi: { testMetrics: () => Promise<{ printIsFunction?: boolean; printCallCount?: number; panePrintType?: string }> } }).pdfViewerApi;
      return api.testMetrics();
    });
    expect(beforePrint.printIsFunction).toBe(true);
    expect(beforePrint.panePrintType).toBe('function');

    await viewer.locator('#btn-print').click();
    const afterPrint = await viewer.evaluate(async () => {
      const api = (window as unknown as { pdfViewerApi: { testMetrics: () => Promise<{ printCallCount?: number }> } }).pdfViewerApi;
      return api.testMetrics();
    });
    expect(afterPrint.printCallCount).toBe((beforePrint.printCallCount || 0) + 1);

    await viewer.locator('#btn-email').click();

    const draftsDir = path.join(testUserData, 'outlook-drafts');
    await expect.poll(() => {
      if (!fs.existsSync(draftsDir)) return false;
      return fs.readdirSync(draftsDir).some((f) => f.startsWith('pdf-draft-') && f.endsWith('.eml'));
    }, { timeout: 15_000 }).toBe(true);

    const emlName = fs.readdirSync(draftsDir).find((f) => f.startsWith('pdf-draft-') && f.endsWith('.eml'));
    expect(emlName).toBeTruthy();
    const emlContent = fs.readFileSync(path.join(draftsDir, emlName!), 'utf8');
    expect(emlContent).toMatch(/multipart\/mixed/i);
    expect(emlContent).toMatch(/application\/pdf/i);
    const attachSha = extractPdfAttachmentSha256FromEml(emlContent);
    expect(attachSha).toBe(sourceSha);
  });
});
