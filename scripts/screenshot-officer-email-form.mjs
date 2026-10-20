#!/usr/bin/env node
/**
 * Renders tests/visual/officer-email-standalone-fixture.html for layout review.
 * Output: /opt/cursor/artifacts/officer-email-form-light.png and -dark.png
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(__dirname, '..', 'tests/visual/officer-email-standalone-fixture.html');
const outDir = '/opt/cursor/artifacts';

async function shot(htmlClass, filename) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 560, height: 920 } });
  await page.goto(`file://${fixture}`);
  if (htmlClass) await page.evaluate((cls) => document.documentElement.classList.add(cls), htmlClass);
  await page.locator('.officer-email-standalone-card').screenshot({ path: path.join(outDir, filename) });
  await browser.close();
}

await shot('', 'officer-email-form-light.png');
await shot('dark', 'officer-email-form-dark.png');
console.log('Wrote officer-email-form-light.png and officer-email-form-dark.png');
