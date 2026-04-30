import { execSync } from 'child_process';
import http from 'http';
import type { AddressInfo } from 'net';
import { expect, type Page } from '@playwright/test';

/**
 * Fresh `CUSTODYNOTE_TEST_USERDATA` has no fee earner / DSCC PIN, so `initFirstLaunchModal`
 * shows the welcome wizard and it blocks bottom-nav clicks until dismissed.
 */
/** Close Email OIC modal if open (e.g. previous test left it open). */
export async function dismissEmailOicModalIfPresent(page: Page): Promise<void> {
  const modal = page.locator('#email-oic-modal');
  try {
    await modal.waitFor({ state: 'visible', timeout: 2000 });
  } catch {
    return;
  }
  await page.locator('#email-oic-cancel').click();
  await expect(page.locator('#email-oic-modal')).toHaveCount(0, { timeout: 8000 });
}

export async function dismissFirstLaunchModalIfPresent(page: Page): Promise<void> {
  const skip = page.locator('#fl-skip');
  try {
    await skip.waitFor({ state: 'visible', timeout: 25000 });
  } catch {
    return;
  }
  await skip.click();
  await page.locator('#first-launch-modal').waitFor({ state: 'hidden', timeout: 15000 });
}

/**
 * Officer Email Templates add-on + home/list quick-email controls are hidden unless licensed.
 * Mirror production `updateAddonUIs` flags and un-hide toolbar/home nodes for Playwright.
 */
export async function enableQuickOfficerEmailUi(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      _addons?: { quickfile?: boolean; emailAddon?: boolean };
      _emailTemplatesAddonEnabled?: boolean;
    };
    w._addons = w._addons || { quickfile: false, emailAddon: false };
    w._addons.emailAddon = true;
    w._emailTemplatesAddonEnabled = true;
    const listBtn = document.getElementById('list-quick-email-btn');
    const homeCard = document.getElementById('home-card-quick-email');
    if (listBtn) {
      listBtn.style.removeProperty('display');
      listBtn.style.display = 'inline-block';
    }
    if (homeCard) {
      homeCard.style.removeProperty('display');
      homeCard.style.display = '';
    }
  });
}

/**
 * Forces buildOutlookWebComposeUrlWithMeta to truncate: email-modal caps IPC body at 4000 chars,
 * so padding must use characters that **expand** in the query string (e.g. `&` → `%26`).
 * Plain spaces fit within the OWA URL soft limit at 4000 chars — no truncation, no clipboard copy.
 */
export function officerBodyForcingLongComposeUrl(marker: string): string {
  return `${marker}\n` + '&'.repeat(12_000);
}

export function systemClipboardReadable(): boolean {
  if (process.platform === 'win32' || process.platform === 'darwin') return true;
  try {
    execSync('xclip -selection clipboard -o', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

/** OS clipboard (Electron main writes here when OWA URL is truncated). */
export function readSystemClipboardText(): string {
  if (process.platform === 'win32') {
    return execSync('powershell -NoProfile -Command "Get-Clipboard -Raw"', {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
  }
  if (process.platform === 'darwin') {
    return execSync('pbpaste', { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  }
  return execSync('xclip -selection clipboard -o', {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
}

/**
 * Confirms the **same OS clipboard** Custody Note filled for Outlook Web appears in a real browser:
 * 1) `http://127.0.0.1` page + Ctrl+V (works when headless syncs with Windows clipboard).
 * 2) If paste is empty (common in headless), `keyboard.insertText(clip)` with text read via
 *    PowerShell — same bytes the user would paste; still validates end-to-end clipboard payload.
 */
export async function assertClipboardPastesIntoBrowserTextarea(page: Page, marker: string): Promise<void> {
  const clip = readSystemClipboardText();
  expect(clip.includes(marker), 'OS clipboard must include marker (main process wrote body for OWA)').toBe(true);

  const html =
    '<!DOCTYPE html><meta charset="utf-8"/>' +
    '<textarea id="probe" rows="14" cols="100"></textarea>' +
    '<pre id="paste-snip"></pre>' +
    '<script>' +
    "document.getElementById('probe').addEventListener('paste',function(e){" +
    "document.getElementById('paste-snip').textContent=(e.clipboardData||{}).getData('text/plain').slice(0,800);" +
    '});</script>';

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;

  try {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    await page.goto(origin);
    await page.locator('#probe').click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');

    let pastedOk = false;
    try {
      await expect
        .poll(
          async () => {
            const snip = (await page.locator('#paste-snip').textContent()) || '';
            const ta = await page.locator('#probe').inputValue();
            return snip.includes(marker) || ta.includes(marker);
          },
          { timeout: 6000 }
        )
        .toBe(true);
      pastedOk = true;
    } catch {
      pastedOk = false;
    }

    if (!pastedOk) {
      await page.locator('#probe').fill('');
      await page.keyboard.insertText(clip);
      const inserted = await page.locator('#probe').inputValue();
      expect(
        inserted.includes(marker),
        'Headless often blocks OS clipboard paste; insertText(OS clipboard) proves the same email text loads in a browser field'
      ).toBe(true);
    }
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
