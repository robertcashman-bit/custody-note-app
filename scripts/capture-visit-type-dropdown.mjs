#!/usr/bin/env node
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(__dirname, 'fixtures/visit-type-bar-preview.html');
const out = '/opt/cursor/artifacts/attendance-type-dropdown-open.png';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 420 } });
await page.goto('file://' + fixture);
await page.waitForTimeout(300);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log('Saved', out);
