#!/usr/bin/env node
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(__dirname, '..', 'tests/visual/officer-email-redesign-fixture.html');
const outDir = '/opt/cursor/artifacts';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(`file://${fixture}`);
await page.waitForTimeout(600);

await page.locator('.officer-email-standalone .officer-email-compose-grid').screenshot({
  path: path.join(outDir, 'officer-email-standalone-redesign.png'),
});
await page.locator('#officer-emails-panel-host').screenshot({
  path: path.join(outDir, 'officer-email-in-note-redesign.png'),
});
await browser.close();
console.log('Saved officer-email-standalone-redesign.png and officer-email-in-note-redesign.png');
