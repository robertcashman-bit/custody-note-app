/**
 * Officer Emails: date/time stepper and chips must meet WCAG AA contrast (4.5:1)
 * in light, default dark, and dark + theme-slate.
 */
import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { dismissFirstLaunchModalIfPresent } from './e2e-helpers';

let electronApp: ElectronApplication;
let page: Page;
let testUserData: string;

const ARTIFACTS = '/opt/cursor/artifacts';
const MIN_CONTRAST = 4.5;

type ThemeCase = {
  id: string;
  screenshotName: string;
  apply: (p: Page) => Promise<void>;
};

const THEME_CASES: ThemeCase[] = [
  {
    id: 'theme-light',
    screenshotName: 'officer-email-contrast-theme-light.png',
    apply: async (p) => {
      await p.evaluate(() => {
        const el = document.documentElement;
        el.classList.remove('dark');
        ['theme-slate', 'theme-midnight', 'theme-teal', 'theme-emerald', 'theme-rose', 'theme-purple', 'theme-charcoal', 'theme-copper'].forEach((c) =>
          el.classList.remove(c),
        );
        el.classList.add('theme-light');
      });
    },
  },
  {
    id: 'dark',
    screenshotName: 'officer-email-contrast-dark.png',
    apply: async (p) => {
      await p.evaluate(() => {
        const el = document.documentElement;
        ['theme-light', 'theme-slate', 'theme-midnight', 'theme-teal', 'theme-emerald', 'theme-rose', 'theme-purple', 'theme-charcoal', 'theme-copper'].forEach((c) =>
          el.classList.remove(c),
        );
        el.classList.add('dark');
      });
    },
  },
  {
    id: 'dark-theme-slate',
    screenshotName: 'officer-email-contrast-dark-theme-slate.png',
    apply: async (p) => {
      await p.evaluate(() => {
        const el = document.documentElement;
        ['theme-light', 'theme-midnight', 'theme-teal', 'theme-emerald', 'theme-rose', 'theme-purple', 'theme-charcoal', 'theme-copper'].forEach((c) =>
          el.classList.remove(c),
        );
        el.classList.add('dark', 'theme-slate');
      });
    },
  },
];

async function openOfficerEmailsView(p: Page): Promise<void> {
  await p.locator('.bottom-nav-btn[data-nav="home"]').click();
  const card = p.locator('#home-card-officer-emails');
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await expect(p.locator('#view-officer-emails')).toHaveClass(/active/, { timeout: 15000 });
  await expect(p.locator('#view-officer-emails .officer-email-step-val').first()).toBeVisible({ timeout: 15000 });
}

async function assertWcagContrast(
  p: Page,
  input: { selector: string; label: string; themeId: string },
): Promise<{ ratio: number; fg: string; bg: string }> {
  const result = await p.evaluate(({ selector }) => {
    function parseRgb(rgb: string): [number, number, number] | null {
      const m = rgb.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      return m ? [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)] : null;
    }

    function relativeLuminance([r, g, b]: [number, number, number]): number {
      const chan = (c: number) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
    }

    function contrastRatio(fg: [number, number, number], bg: [number, number, number]): number {
      const l1 = relativeLuminance(fg);
      const l2 = relativeLuminance(bg);
      const lighter = Math.max(l1, l2);
      const darker = Math.min(l1, l2);
      return (lighter + 0.05) / (darker + 0.05);
    }

    function effectiveBackground(el: HTMLElement): string {
      let node: HTMLElement | null = el;
      while (node) {
        const bg = getComputedStyle(node).backgroundColor;
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
        node = node.parentElement;
      }
      return getComputedStyle(document.body).backgroundColor || 'rgb(255, 255, 255)';
    }

    const el = document.querySelector(selector) as HTMLElement | null;
    if (!el) return { ok: false as const, reason: 'missing element' };

    const fg = parseRgb(getComputedStyle(el).color || '');
    const bg = parseRgb(effectiveBackground(el));
    if (!fg || !bg) {
      return { ok: false as const, reason: 'unparsed color', fgRaw: getComputedStyle(el).color, bgRaw: effectiveBackground(el) };
    }
    const ratio = contrastRatio(fg, bg);
    return { ok: true as const, ratio, fg: `rgb(${fg.join(', ')})`, bg: `rgb(${bg.join(', ')})` };
  }, { selector: input.selector });

  expect(result.ok, `${input.themeId} ${input.label}: element must exist`).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  expect(
    result.ratio,
    `${input.themeId} ${input.label}: WCAG contrast ${result.ratio.toFixed(2)} (fg ${result.fg} on ${result.bg})`,
  ).toBeGreaterThanOrEqual(MIN_CONTRAST);
  return { ratio: result.ratio, fg: result.fg, bg: result.bg };
}

test.beforeAll(async () => {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  testUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-officer-email-contrast-'));
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
  await page.locator('#splash').waitFor({ state: 'hidden', timeout: 60_000 }).catch(async () => {
    await page.waitForSelector('.app-header, #header-app-title', { timeout: 30_000 });
  });
  await page.waitForFunction(() => typeof (window as unknown as { api?: unknown }).api !== 'undefined', {
    timeout: 30_000,
  });
  await dismissFirstLaunchModalIfPresent(page);
});

test.afterAll(async ({}, testInfo) => {
  testInfo.setTimeout(120_000);
  if (electronApp) {
    try {
      await Promise.race([
        electronApp.close(),
        new Promise<void>((resolve) => setTimeout(resolve, 12_000)),
      ]);
    } catch {
      /* ignore */
    }
    try {
      const proc = electronApp.process();
      if (proc && !proc.killed) proc.kill();
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

for (const themeCase of THEME_CASES) {
  test(`Officer Emails stepper/chips meet WCAG contrast (${themeCase.id})`, async () => {
    await themeCase.apply(page);
    await openOfficerEmailsView(page);

    const chipSelector = '#view-officer-emails .officer-email-chip:not(.on)';
    await expect(page.locator(chipSelector).first()).toBeVisible();

    await assertWcagContrast(page, {
      selector: '#view-officer-emails .officer-email-step-val[data-role="d-val"]',
      label: '.officer-email-step-val (date)',
      themeId: themeCase.id,
    });
    await assertWcagContrast(page, {
      selector: chipSelector,
      label: '.officer-email-chip (unselected)',
      themeId: themeCase.id,
    });
    await assertWcagContrast(page, {
      selector: '#view-officer-emails .officer-email-time-colon',
      label: '.officer-email-time-colon',
      themeId: themeCase.id,
    });

    const shotPath = path.join(ARTIFACTS, themeCase.screenshotName);
    await page.locator('#view-officer-emails').screenshot({ path: shotPath });
    expect(fs.existsSync(shotPath)).toBe(true);
  });
}
