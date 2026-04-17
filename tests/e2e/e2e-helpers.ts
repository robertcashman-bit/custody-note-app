import type { Page } from '@playwright/test';

/**
 * Fresh `CUSTODYNOTE_TEST_USERDATA` has no fee earner / DSCC PIN, so `initFirstLaunchModal`
 * shows the welcome wizard and it blocks bottom-nav clicks until dismissed.
 */
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
