import { test, expect, _electron } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';

test('Close dismisses inline billing without remount', async () => {
  const testUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-k1-'));
  const electronApp = await _electron.launch({
    args: [path.join(__dirname, '..', '..', 'main.js')],
    env: { ...process.env, NODE_ENV: 'test', CUSTODYNOTE_TEST_USERDATA: testUserData, CUSTODYNOTE_E2E_SKIP_LICENCE_GATE: '1' },
  });
  const page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => typeof (window as any).api !== 'undefined', { timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => { const m = document.getElementById('first-launch-modal'); if (m) m.remove(); });

  const id = await page.evaluate(async () => {
    const api = (window as any).api;
    const data = { forename: 'Probe', surname: 'K1Close', attendanceDate: '2026-09-12', stationName: 'Brixton Police Station', dsccNumber: 'DSCC-K1-PROBE', formType: 'custody' };
    const saved = await api.attendanceSave({ id: null, data: JSON.stringify(data), status: 'draft', client_name: 'K1Close, Probe', attendance_date: '2026-09-12', station_name: 'Brixton Police Station', dscc_number: 'DSCC-K1-PROBE' });
    const aid = typeof saved === 'number' ? saved : saved?.id;
    await api.attendanceSave({ id: aid, data: JSON.stringify(data), status: 'finalised', client_name: 'K1Close, Probe', attendance_date: '2026-09-12', station_name: 'Brixton Police Station', dscc_number: 'DSCC-K1-PROBE' });
    return aid;
  });

  await page.evaluate(async (aid) => {
    const w = window as any;
    const row = await w.api.attendanceGet(aid);
    const parsed = JSON.parse(row.data);
    if (typeof w.applyAttendanceSessionFromRow === 'function') w.applyAttendanceSessionFromRow(aid, row, parsed);
    else { w.currentAttendanceId = aid; w.currentRecordStatus = 'finalised'; }
    w.showView('matter-billing');
  }, id);
  await page.waitForTimeout(1200);
  const start = page.locator('#matter-billing-start-btn');
  if (await start.isVisible()) await start.click();
  await page.waitForTimeout(800);
  const docNext = page.locator('#wf-doc-next');
  if (await docNext.isVisible()) { await docNext.click(); await page.waitForTimeout(500); }
  await expect(page.locator('#wf-bill-close')).toBeVisible();
  await page.locator('#wf-bill-close').click();
  await page.waitForTimeout(600);
  await expect(page.locator('#workflow-overlay')).toHaveCount(0);
  await electronApp.close();
  fs.rmSync(testUserData, { recursive: true, force: true });
});
