#!/usr/bin/env node
/**
 * Full-app Officer Emails standalone view screenshots (Electron + Playwright).
 * Output: /opt/cursor/artifacts/officer-email-full-*.png
 */
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { _electron } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = '/opt/cursor/artifacts';

const SYNTH = {
  officer1Email: 'officer.alpha@example.police.uk',
  officer1Name: 'PC Alpha',
  officer2Email: 'officer.beta@example.police.uk',
  officer2Name: 'PC Beta',
  client: 'Synthetic Client',
  station: 'Synthetic Police Station',
  date: '15 Mar 2026',
  time: '14:30',
  offence: 'Synthetic offence',
  extra: 'Synthetic extra note for disclosure timing.',
  userEmail: 'rep.synthetic@example.firm.uk',
};

async function dismissFirstLaunch(page) {
  const skip = page.locator('#fl-skip');
  try {
    await skip.waitFor({ state: 'visible', timeout: 25000 });
    await skip.click();
    await page.locator('#first-launch-modal').waitFor({ state: 'hidden', timeout: 15000 });
  } catch {
    /* not shown */
  }
}

async function setDarkMode(page, enabled) {
  await page.evaluate(async (on) => {
    document.documentElement.classList.toggle('dark', on);
    const btn = document.getElementById('dark-mode-toggle');
    if (btn) btn.textContent = on ? '\u2600' : '\u263E';
    if (window.api && window.api.setSettings) {
      await window.api.setSettings({ darkMode: on ? 'true' : 'false' });
    }
  }, enabled);
}

async function openOfficerEmails(page) {
  await page.locator('#home-card-officer-emails').scrollIntoViewIfNeeded();
  await page.locator('#home-card-officer-emails').click();
  await page.locator('#view-officer-emails').waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForFunction(() => document.getElementById('view-officer-emails')?.classList.contains('active'), {
    timeout: 20000,
  });
  await page.locator('#oes-gen').waitFor({ state: 'visible', timeout: 20000 });
}

async function fillField(locator, value) {
  await locator.click();
  await locator.fill(value);
  await locator.dispatchEvent('input');
  await locator.dispatchEvent('change');
}

function officerView(page) {
  return page.locator('#view-officer-emails.active');
}

async function fillAndGenerate(page) {
  const view = officerView(page);
  await view.locator('.officer-email-add-recipient').click();
  await expectRowCount(page, 2);

  const rows = view.locator('.officer-email-recipient-row');
  await fillField(rows.nth(0).locator('.officer-email-recipient-to'), SYNTH.officer1Email);
  await fillField(rows.nth(0).locator('.officer-email-recipient-name'), SYNTH.officer1Name);
  await fillField(rows.nth(1).locator('.officer-email-recipient-to'), SYNTH.officer2Email);
  await fillField(rows.nth(1).locator('.officer-email-recipient-name'), SYNTH.officer2Name);

  await view.locator('#oes-duty-solicitor').check();
  await view.locator('#oes-outlook-sig').check();

  await fillField(view.locator('#oes-client'), SYNTH.client);
  await fillField(view.locator('#oes-station'), SYNTH.station);
  await fillField(view.locator('#oes-date'), SYNTH.date);
  await fillField(view.locator('#oes-time'), SYNTH.time);
  await fillField(view.locator('#oes-offence'), SYNTH.offence);
  await fillField(view.locator('#oes-extra'), SYNTH.extra);
  await fillField(view.locator('#oes-user-email'), SYNTH.userEmail);

  await view.locator('#oes-gen').click();
  await page.waitForFunction(() => {
    const sub = document.getElementById('oes-subject');
    const body = document.getElementById('oes-body');
    return sub && body && String(sub.value).trim().length > 5 && String(body.value).trim().length > 80;
  }, { timeout: 30000 });
  await page.waitForFunction(() => {
    const body = document.getElementById('oes-body');
    return body && String(body.value).includes('PC Alpha');
  }, { timeout: 10000 });
  await page.waitForTimeout(400);
}

async function expectRowCount(page, n) {
  await page.waitForFunction(
    (count) => document.querySelectorAll('#view-officer-emails.active .officer-email-recipient-row').length >= count,
    n,
    { timeout: 10000 }
  );
}

async function screenshotSet(page, tag) {
  const viewportPath = path.join(OUT, `officer-email-full-${tag}-1440x900.png`);
  const viewPath = path.join(OUT, `officer-email-full-${tag}-view.png`);
  const scrollPath = path.join(OUT, `officer-email-full-${tag}-scrolled.png`);

  await page.locator('#view-officer-emails').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.locator('#view-officer-emails.active .officer-email-recipients-block').scrollIntoViewIfNeeded();
  await page.screenshot({ path: viewportPath, fullPage: false });
  const view = page.locator('#view-officer-emails');
  await view.screenshot({ path: viewPath });
  await page.screenshot({ path: scrollPath, fullPage: true });
  console.log('Wrote', viewportPath, viewPath, scrollPath);
}

async function main() {
  const testUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-officer-fullshot-'));
  const electronApp = await _electron.launch({
    args: [path.join(ROOT, 'main.js')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CUSTODYNOTE_TEST_USERDATA: testUserData,
      CUSTODYNOTE_E2E_SKIP_LICENCE_GATE: '1',
    },
  });

  try {
    const page = await electronApp.firstWindow();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForLoadState('domcontentloaded');
    await page.locator('#splash').waitFor({ state: 'hidden', timeout: 60000 }).catch(() => undefined);
    await page.waitForFunction(() => typeof window.api !== 'undefined', { timeout: 30000 });
    await dismissFirstLaunch(page);

    await setDarkMode(page, true);
    await openOfficerEmails(page);
    await fillAndGenerate(page);
    await screenshotSet(page, 'dark');

    await setDarkMode(page, false);
    await page.waitForTimeout(300);
    await screenshotSet(page, 'light');
  } finally {
    await electronApp.close().catch(() => undefined);
    try {
      fs.rmSync(testUserData, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

await main();
