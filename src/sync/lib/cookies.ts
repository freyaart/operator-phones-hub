import type { Page } from 'playwright';

export async function acceptA1Cookies(page: Page): Promise<void> {
  const btn = page.locator('#onetrust-accept-btn-handler, #onetrust-reject-all-handler').first();
  if (await btn.isVisible({ timeout: 4000 }).catch(() => false)) {
    await btn.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(600);
  }
}

export async function acceptTelekomCookies(page: Page): Promise<void> {
  const btn = page.getByRole('button', { name: /Sprejmi|Strinjam|Accept/i }).first();
  if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await btn.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(500);
  }
}
