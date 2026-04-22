import type { Page } from 'playwright';
import { acceptA1Cookies } from '../sync/lib/cookies.js';

const BAD = /apple-care|zavarovanje|servis|pogoji|pomoč|kontakt|cookie/i;

/** Collect `/telefoni/...` handset paths from the main listing (first page). */
export async function collectA1TelefoniPaths(page: Page): Promise<string[]> {
  await page.goto('https://www.a1.si/telefoni/', { waitUntil: 'domcontentloaded', timeout: 65000 });
  await page.waitForTimeout(4000);
  await acceptA1Cookies(page);
  await page.waitForTimeout(1500);
  const hrefs = await page.locator('a[href^="/telefoni/"]').evaluateAll((els) => {
    const s = new Set<string>();
    for (const e of els) {
      const h = e.getAttribute('href');
      if (h && h.startsWith('/telefoni/')) s.add(h.split('#')[0]);
    }
    return [...s];
  });
  return hrefs.filter((h) => !BAD.test(h));
}
