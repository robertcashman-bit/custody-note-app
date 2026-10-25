/**
 * E2E: OpenAI API key syncs between two isolated Electron profiles (mock API).
 */
import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { dismissFirstLaunchModalIfPresent } from './e2e-helpers';

const MAIN = path.join(__dirname, '..', '..', 'main.js');
const TEST_KEY = 'SYNC-TEST-0001-KEY1';
const FAKE_OPENAI_KEY = 'sk-test-e2e-openai-sync';

let mock: { server: unknown; start: () => Promise<string>; stop: () => Promise<void> };
let apiBase = '';
let electronA: ElectronApplication;
let electronB: ElectronApplication;
let pageA: Page;
let pageB: Page;
let userDataA = '';
let userDataB = '';

async function launchDevice(userData: string) {
  const app = await _electron.launch({
    args: [MAIN],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CUSTODYNOTE_TEST_USERDATA: userData,
      CUSTODYNOTE_E2E_SKIP_LICENCE_GATE: '1',
      LICENCE_SERVER_BASE_URL: apiBase,
    },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#splash').waitFor({ state: 'hidden', timeout: 60_000 }).catch(async () => {
    await page.waitForSelector('.app-header, #header-app-title', { timeout: 30_000 });
  });
  await page.waitForFunction(() => typeof (window as unknown as { api?: unknown }).api !== 'undefined', {
    timeout: 30_000,
  });
  await dismissFirstLaunchModalIfPresent(page);
  await page.evaluate(async (key) => {
    const w = window as unknown as {
      api: { licenceActivate: (p: { key: string; email: string }) => Promise<{ success?: boolean }> };
    };
    const res = await w.api.licenceActivate({ key, email: 'openai-sync-e2e@test.local' });
    if (!res || !res.success) throw new Error('licence activate failed');
  }, TEST_KEY);
  return { app, page };
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const mod = await import('../fixtures/mockSyncServer.mjs');
  mock = mod.createMockSyncServer();
  apiBase = await mock.start();
  userDataA = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-oai-a-'));
  userDataB = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-oai-b-'));
  ({ app: electronA, page: pageA } = await launchDevice(userDataA));
  ({ app: electronB, page: pageB } = await launchDevice(userDataB));
});

test.afterAll(async () => {
  for (const app of [electronA, electronB]) {
    if (!app) continue;
    try {
      await Promise.race([app.close(), new Promise<void>((r) => setTimeout(r, 12_000))]);
    } catch { /* ignore */ }
  }
  if (mock) await mock.stop();
  for (const dir of [userDataA, userDataB]) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

test('save OpenAI key on A appears on B after account sync', async () => {
  await pageA.evaluate(async (keyVal) => {
    const w = window as unknown as {
      api: {
        setSettings: (s: Record<string, string>) => Promise<unknown>;
        quickfileSettingsEnsure?: (opts?: object) => Promise<unknown>;
      };
    };
    await w.api.setSettings({ openaiApiKey: keyVal });
  }, FAKE_OPENAI_KEY);
  await pageA.waitForTimeout(3500);

  await pageA.evaluate(async () => {
    const w = window as unknown as { api: { quickfileSettingsEnsure?: (opts?: object) => Promise<unknown> } };
    if (w.api.quickfileSettingsEnsure) await w.api.quickfileSettingsEnsure({ force: true });
  });
  await pageA.waitForTimeout(1500);

  await pageB.evaluate(async () => {
    const w = window as unknown as { api: { quickfileSettingsEnsure?: (opts?: object) => Promise<unknown> } };
    if (w.api.quickfileSettingsEnsure) await w.api.quickfileSettingsEnsure({ force: true });
  });
  await pageB.waitForTimeout(2000);

  const keyOnB = await pageB.evaluate(async () => {
    const w = window as unknown as { api: { getSettings?: () => Promise<{ openaiApiKey?: string }> } };
    const s = await w.api.getSettings!();
    return s.openaiApiKey || '';
  });
  expect(keyOnB).toBe(FAKE_OPENAI_KEY);
});

test('clear OpenAI key on A clears B', async () => {
  await pageA.evaluate(async () => {
    const w = window as unknown as { api: { setSettings: (s: Record<string, string>) => Promise<unknown> } };
    await w.api.setSettings({ openaiApiKey: '' });
  });
  await pageA.waitForTimeout(3500);

  await pageB.evaluate(async () => {
    const w = window as unknown as { api: { quickfileSettingsEnsure?: (opts?: object) => Promise<unknown> } };
    if (w.api.quickfileSettingsEnsure) await w.api.quickfileSettingsEnsure({ force: true });
  });
  await pageB.waitForTimeout(2000);

  const keyOnB = await pageB.evaluate(async () => {
    const w = window as unknown as { api: { getSettings?: () => Promise<{ openaiApiKey?: string }> } };
    const s = await w.api.getSettings!();
    return s.openaiApiKey || '';
  });
  expect(keyOnB).toBe('');
});
