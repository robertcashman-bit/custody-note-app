/**
 * In-app PDF viewer — BrowserView must render Chromium PDF (isolated partition).
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
} from './pdf-viewer-helpers';

let electronApp: ElectronApplication;
let page: Page;
let testUserData: string;

test.beforeAll(async () => {
  testUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-pdf-viewer-e2e-'));
  electronApp = await _electron.launch({
    args: [path.join(__dirname, '..', '..', 'main.js')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CUSTODYNOTE_TEST_USERDATA: testUserData,
    },
  });
  page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => typeof (window as unknown as { api?: unknown }).api !== 'undefined', {
    timeout: 30000,
  });
});

test.afterAll(async () => {
  if (electronApp) {
    try {
      await Promise.race([
        electronApp.close(),
        new Promise<void>((resolve) => setTimeout(resolve, 12000)),
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

test('previewPdfFromHtml renders PDF in BrowserView (not blank)', async () => {
  const viewerPromise = waitForPdfViewerShellWindow(electronApp);

  const preview = await page.evaluate(async (html) => {
    const w = window as unknown as {
      api: {
        previewPdfFromHtml: (p: { html: string; filename: string }) => Promise<{ ok?: boolean; path?: string; error?: string }>;
      };
    };
    return w.api.previewPdfFromHtml({ html, filename: 'synthetic-viewer-test.pdf' });
  }, SYNTHETIC_ATTENDANCE_PDF_HTML);

  expect(preview.ok, preview.error || 'preview failed').toBe(true);
  expect(preview.path).toBeTruthy();
  expect(fs.existsSync(preview.path!)).toBe(true);

  const viewer = await viewerPromise;
  await viewer.waitForLoadState('domcontentloaded');
  await expect(viewer.locator('#btn-print')).toBeVisible({ timeout: 15000 });

  await assertBrowserViewPdfRendered(viewer, electronApp, {
    saveAs: artifactPath('viewer-render.png'),
    shellScreenshotAs: artifactPath('pdf-viewer-window.png'),
  });

  const tempPath = preview.path!;
  await viewer.locator('#btn-close').click();
  await viewer.waitForEvent('close', { timeout: 10000 }).catch(() => undefined);
  await expect.poll(() => !fs.existsSync(tempPath), { timeout: 10000 }).toBe(true);
});

test('previewPdfBase64 uses in-app viewer (returns viewerOpened)', async () => {
  const minimalPdfBase64 = Buffer.from(
    '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF',
    'utf8'
  ).toString('base64');

  const viewerPromise = waitForPdfViewerShellWindow(electronApp);

  const res = await page.evaluate(async (b64) => {
    const w = window as unknown as {
      api: {
        previewPdfBase64: (p: { base64: string; filename: string }) => Promise<{ ok?: boolean; viewerOpened?: boolean; path?: string }>;
      };
    };
    return w.api.previewPdfBase64({ base64: b64, filename: 'minimal-synthetic.pdf' });
  }, minimalPdfBase64);

  expect(res.ok).toBe(true);
  expect(res.viewerOpened).toBe(true);
  expect(res.path).toMatch(/cn-pdf-preview-/);

  const viewer = await viewerPromise;
  await viewer.locator('#btn-close').click();
});

test('mail-attachment PDF survives after viewer closes', async () => {
  const minimalPdfBase64 = Buffer.from(
    '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF',
    'utf8'
  ).toString('base64');

  const viewerPromise = waitForPdfViewerShellWindow(electronApp);

  const saved = await page.evaluate(async (b64) => {
    const w = window as unknown as {
      api: {
        savePdfBase64: (p: {
          base64: string;
          filename: string;
          target: string;
          openViewer: boolean;
        }) => Promise<{ ok?: boolean; path?: string }>;
      };
    };
    return w.api.savePdfBase64({
      base64: b64,
      filename: 'synthetic-mail-attach.pdf',
      target: 'mail-attachment',
      openViewer: true,
    });
  }, minimalPdfBase64);

  expect(saved.ok).toBe(true);
  expect(saved.path).toMatch(/cn-pdf-mail-attachments/);

  const viewer = await viewerPromise;
  await viewer.locator('#btn-close').click();
  await expect.poll(() => fs.existsSync(saved.path!), { timeout: 10000 }).toBe(true);
});

test('viewer Email action records Outlook launch in test userdata', async () => {
  const minimalPdfBase64 = Buffer.from(
    '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF',
    'utf8'
  ).toString('base64');

  const viewerPromise = waitForPdfViewerShellWindow(electronApp);

  await page.evaluate(async (b64) => {
    const w = window as unknown as {
      api: {
        savePdfBase64: (p: { base64: string; filename: string; target: string; openViewer: boolean; emailCompose: object }) => Promise<unknown>;
      };
    };
    await w.api.savePdfBase64({
      base64: b64,
      filename: 'synthetic-email-btn.pdf',
      target: 'mail-attachment',
      openViewer: true,
      emailCompose: { subject: 'Synthetic subject', body: 'Synthetic body', to: '' },
    });
  }, minimalPdfBase64);

  const viewer = await viewerPromise;
  await viewer.locator('#btn-email').click();
  await expect.poll(() => fs.existsSync(path.join(testUserData, 'last-pdf-email-launch.json')), {
    timeout: 10000,
  }).toBe(true);
  if (!viewer.isClosed()) {
    await viewer.locator('#btn-close').click().catch(() => undefined);
  }
});
