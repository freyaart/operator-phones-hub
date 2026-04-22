import type { Page } from 'playwright';

const HASH =
  'https://www.telekom.si/e-trgovina/telefonija/mobiteli#q=:datum-padajoce:tip-cene:najnizja:zaloga:vse:napovedujemo:ne:v-prodaji:da&stran=';

/** Collect unique mobitel PDP URLs using Telekom hash pagination. */
export async function collectTelekomMobitelUrls(page: Page, maxPages = 60): Promise<string[]> {
  const all = new Set<string>();
  let stagnant = 0;
  for (let stran = 1; stran <= maxPages; stran++) {
    await page.goto(HASH + stran, { waitUntil: 'domcontentloaded', timeout: 65000 });
    await page.waitForTimeout(5500);
    const hrefs = await page.locator('a[href]').evaluateAll((els) => {
      const s: string[] = [];
      for (const e of els) {
        const h = e.getAttribute('href');
        if (h && /\/mobiteli\/p\//.test(h)) {
          const abs = h.startsWith('http') ? h.split('#')[0] : 'https://www.telekom.si' + h.split('#')[0];
          s.push(abs);
        }
      }
      return s;
    });
    const before = all.size;
    for (const h of hrefs) all.add(h);
    const added = all.size - before;
    if (added === 0) {
      stagnant++;
      if (stagnant >= 2) break;
    } else {
      stagnant = 0;
    }
  }
  return [...all];
}
