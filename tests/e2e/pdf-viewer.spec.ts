/**
 * In-app PDF viewer — opens generated PDFs inside Electron, not the OS handler.
 */
import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';

let electronApp: ElectronApplication;
let page: Page;
let testUserData: string;

const SYNTHETIC_HTML =
  '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Synthetic</title></head>' +
  '<body><h1>Synthetic custody note PDF test</h1><p>No real client data.</p></body></html>';

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

async function waitForPdfViewerShellWindow(app: ElectronApplication) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    for (const w of app.windows()) {
      const url = w.url();
      if (url.includes('pdf-viewer-shell.html')) return w;
    }
    try {
      const w = await app.waitForEvent('window', { timeout: 2000 });
      if (w.url().includes('pdf-viewer-shell.html')) return w;
    } catch {
      /* keep polling */
    }
  }
  throw new Error('PDF viewer shell window did not appear');
}

test('previewPdfFromHtml opens viewer window with toolbar actions', async () => {
  const viewerPromise = waitForPdfViewerShellWindow(electronApp);

  const preview = await page.evaluate(async (html) => {
    const w = window as unknown as {
      api: {
        previewPdfFromHtml: (p: { html: string; filename: string }) => Promise<{ ok?: boolean; path?: string; error?: string }>;
      };
    };
    return w.api.previewPdfFromHtml({ html, filename: 'synthetic-viewer-test.pdf' });
  }, SYNTHETIC_HTML);

  expect(preview.ok, preview.error || 'preview failed').toBe(true);
  expect(preview.path).toBeTruthy();
  expect(fs.existsSync(preview.path!)).toBe(true);

  const viewer = await viewerPromise;
  await viewer.waitForLoadState('domcontentloaded');
  await expect(viewer.locator('#btn-print')).toBeVisible({ timeout: 15000 });
  await expect(viewer.locator('#btn-save')).toBeVisible();
  await expect(viewer.locator('#btn-external')).toBeVisible();
  await expect(viewer.locator('#btn-close')).toBeVisible();
  await expect(viewer.locator('#doc-title')).toContainText('synthetic-viewer-test.pdf');
  await viewer.screenshot({ path: '/opt/cursor/artifacts/pdf-viewer-window.png' });

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
  await viewer.waitForLoadState('domcontentloaded');
  await viewer.locator('#btn-close').click();
});
