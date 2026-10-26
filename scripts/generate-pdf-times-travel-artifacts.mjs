#!/usr/bin/env node
/**
 * Build custody attendance-note PDF from the shared synthetic record and save PDF + page-1 PNG.
 * Usage: node scripts/generate-pdf-times-travel-artifacts.mjs --label before|after
 */
import { _electron } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const require = createRequire(import.meta.url);
const { buildSyntheticAttendanceForPdfTimes } = require('../tests/fixtures/syntheticAttendancePdfTimes.js');

const labelArg = process.argv.find((a) => a.startsWith('--label='))
  || (process.argv.includes('--label') ? `--label=${process.argv[process.argv.indexOf('--label') + 1]}` : null);
const label = labelArg ? labelArg.split('=')[1] : 'after';
const outDir = process.env.CN_ARTIFACT_DIR || '/opt/cursor/artifacts';
fs.mkdirSync(outDir, { recursive: true });

const pdfPath = path.join(outDir, `attendance-note-times-travel-${label}.pdf`);
const pngPath = path.join(outDir, `attendance-note-times-travel-${label}-page1.png`);

async function buildHtmlViaElectron() {
  const testUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-pdf-artifact-'));
  const electronApp = await _electron.launch({
    args: [path.join(ROOT, 'main.js')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CUSTODYNOTE_TEST_USERDATA: testUserData,
    },
  });
  try {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(
      () => typeof window.buildPdfHtml === 'function',
      { timeout: 60000 },
    );
    const record = buildSyntheticAttendanceForPdfTimes();
    const html = await page.evaluate((rec) => {
      const enriched = window.enrichDataForPdf(rec, 'finalised');
      return window.buildPdfHtml(enriched, { brandName: 'Synthetic Firm', dsccPin: 'SYN-PIN' });
    }, record);
    return html;
  } finally {
    await electronApp.close().catch(() => {});
    try {
      fs.rmSync(testUserData, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

async function htmlToPdfAndPage1Png(html, pdfFile, pngFile) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    const pdfBuf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    fs.writeFileSync(pdfFile, pdfBuf);
    await page.setViewportSize({ width: 794, height: 1123 });
    await page.screenshot({ path: pngFile, fullPage: false });
    return pdfBuf;
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log(`[pdf-artifacts] Building HTML (${label})…`);
  const html = await buildHtmlViaElectron();
  console.log(`[pdf-artifacts] Rendering PDF (${label})…`);
  await htmlToPdfAndPage1Png(html, pdfPath, pngPath);
  console.log(`[pdf-artifacts] Wrote ${pdfPath}`);
  console.log(`[pdf-artifacts] Wrote ${pngPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
