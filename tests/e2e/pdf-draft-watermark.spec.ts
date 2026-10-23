/**
 * E2E: finalised record status must suppress the PDF draft watermark even when
 * feeEarnerCertification is still Draft (user report v1.9.118).
 */
import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { dismissFirstLaunchModalIfPresent } from './e2e-helpers';

let electronApp: ElectronApplication;
let page: Page;
let testUserData: string;

test.beforeAll(async () => {
  testUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-pdf-wm-e2e-'));
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
  await splash.waitFor({ state: 'hidden', timeout: 60_000 }).catch(async () => {
    await page.waitForSelector('.app-header, #header-app-title', { timeout: 30_000 });
  });
  await dismissFirstLaunchModalIfPresent(page);
  await page.waitForFunction(
    () =>
      typeof (window as unknown as { buildPdfHtml?: unknown }).buildPdfHtml === 'function'
      && typeof (window as unknown as { buildTelephonePdfHtml?: unknown }).buildTelephonePdfHtml === 'function'
      && typeof (window as unknown as { buildVoluntaryPdfHtml?: unknown }).buildVoluntaryPdfHtml === 'function'
      && typeof (window as unknown as { enrichDataForPdf?: unknown }).enrichDataForPdf === 'function',
    { timeout: 30_000 },
  );
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
  }
  try {
    fs.rmSync(testUserData, { recursive: true, force: true });
  } catch { /* ignore */ }
});

const syntheticBase = {
  forename: 'Synthetic',
  surname: 'Client',
  date: '2026-10-01',
  policeStationName: 'E2E Station',
  feeEarnerCertification: 'Draft',
};

test('finalised record status removes draft watermark from custody PDF', async () => {
  const html = await page.evaluate((base) => {
    const w = window as unknown as {
      enrichDataForPdf: (d: Record<string, unknown>, st?: string) => Record<string, unknown>;
      buildPdfHtml: (d: Record<string, unknown>, s: Record<string, unknown>) => string;
    };
    const enriched = w.enrichDataForPdf(base, 'finalised');
    return w.buildPdfHtml(enriched, {});
  }, syntheticBase);

  expect(html).not.toContain('class="watermark"');
});

test('draft record with Finalised certification still shows DRAFT watermark (inconsistent state guard)', async () => {
  const html = await page.evaluate((base) => {
    const w = window as unknown as {
      enrichDataForPdf: (d: Record<string, unknown>, st?: string) => Record<string, unknown>;
      buildPdfHtml: (d: Record<string, unknown>, s: Record<string, unknown>) => string;
    };
    const enriched = w.enrichDataForPdf(
      { ...base, feeEarnerCertification: 'Finalised' },
      'draft',
    );
    return w.buildPdfHtml(enriched, {});
  }, syntheticBase);

  expect(html).toContain('class="watermark">DRAFT</div>');
});

test('draft record still shows DRAFT watermark', async () => {
  const html = await page.evaluate((base) => {
    const w = window as unknown as {
      enrichDataForPdf: (d: Record<string, unknown>, st?: string) => Record<string, unknown>;
      buildPdfHtml: (d: Record<string, unknown>, s: Record<string, unknown>) => string;
    };
    const enriched = w.enrichDataForPdf(base, 'draft');
    return w.buildPdfHtml(enriched, {});
  }, syntheticBase);

  expect(html).toContain('class="watermark">DRAFT</div>');
});

test('telephone and voluntary builders respect finalised record status', async () => {
  const result = await page.evaluate((base) => {
    const w = window as unknown as {
      enrichDataForPdf: (d: Record<string, unknown>, st?: string) => Record<string, unknown>;
      buildTelephonePdfHtml: (d: Record<string, unknown>, s: Record<string, unknown>) => string;
      buildVoluntaryPdfHtml: (d: Record<string, unknown>, s: Record<string, unknown>) => string;
    };
    const tel = w.buildTelephonePdfHtml(
      w.enrichDataForPdf({ ...base, _formType: 'telephone' }, 'finalised'),
      {},
    );
    const vol = w.buildVoluntaryPdfHtml(
      w.enrichDataForPdf({ ...base, attendanceMode: 'voluntary' }, 'finalised'),
      {},
    );
    return { telHasWatermark: tel.includes('class="watermark"'), volHasWatermark: vol.includes('class="watermark"') };
  }, syntheticBase);

  expect(result.telHasWatermark).toBe(false);
  expect(result.volHasWatermark).toBe(false);
});
