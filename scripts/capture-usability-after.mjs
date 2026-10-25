#!/usr/bin/env node
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = '/opt/cursor/artifacts/usability-review-after';
const shots = [
  { fixture: 'visit-type-bar-preview.html', out: '01-visit-type-bar-thin.png', w: 1100, h: 420 },
  { fixture: 'new-record-chooser-preview.html', out: '05-new-record-chooser.png', w: 900, h: 700 },
];

const browser = await chromium.launch();
for (const s of shots) {
  const page = await browser.newPage({ viewport: { width: s.w, height: s.h } });
  await page.goto('file://' + path.join(__dirname, 'fixtures', s.fixture));
  await page.waitForTimeout(200);
  const dest = path.join(outDir, s.out);
  await page.screenshot({ path: dest, fullPage: true });
  console.log('Saved', dest);
  await page.close();
}
await browser.close();
