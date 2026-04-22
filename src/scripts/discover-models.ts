/**
 * Discover handset SKUs from operator listings and upsert into `PhoneModel`.
 *
 *   npm run discover
 *   npm run discover -- --sources=telekom
 *   npm run discover -- --dry-run
 *
 * Requires: `npm run playwright:install` and `DATABASE_URL` in `.env`
 */
import { chromium } from 'playwright';
import { prisma } from '../db.js';
import { parseCatalogSlug } from '../discovery/parse-catalog-slug.js';
import { collectTelekomMobitelUrls } from '../discovery/collect-telekom.js';
import { collectA1TelefoniPaths } from '../discovery/collect-a1.js';
import { mergeDiscoveryDetails } from '../discovery/merge-details.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

function hasFlag(f: string): boolean {
  return process.argv.includes(f);
}

function telekomSlugFromUrl(url: string): string | null {
  const m = url.match(/\/mobiteli\/p\/([^/?#]+)/i);
  return m ? m[1].toLowerCase() : null;
}

function a1SlugFromPath(path: string): string | null {
  const m = path.match(/^\/telefoni\/([^/?#]+)/i);
  return m ? m[1].toLowerCase() : null;
}

async function upsertFromTelekomUrl(url: string, dryRun: boolean) {
  const seg = telekomSlugFromUrl(url);
  if (!seg) return;
  const parsed = parseCatalogSlug(seg);
  if (dryRun) {
    console.log('[telekom]', parsed.slug, '→', parsed.brand, parsed.series, parsed.storageGb);
    return;
  }
  const existing = await prisma.phoneModel.findUnique({ where: { slug: parsed.slug } });
  const details = mergeDiscoveryDetails(existing?.details, {
    shopUrl: { operator: 'telekom', url },
    importTag: 'telekom-listing',
  });
  await prisma.phoneModel.upsert({
    where: { slug: parsed.slug },
    create: {
      slug: parsed.slug,
      brand: parsed.brand,
      series: parsed.series,
      storageGb: parsed.storageGb,
      details,
    },
    update: {
      brand: parsed.brand,
      series: parsed.series,
      storageGb: parsed.storageGb,
      details,
    },
  });
}

async function upsertFromA1Path(path: string, dryRun: boolean) {
  const seg = a1SlugFromPath(path);
  if (!seg) return;
  const parsed = parseCatalogSlug(seg);
  const abs = `https://www.a1.si${path}`;
  if (dryRun) {
    console.log('[a1]', parsed.slug, '→', parsed.brand, parsed.series, parsed.storageGb);
    return;
  }
  const existing = await prisma.phoneModel.findUnique({ where: { slug: parsed.slug } });
  const details = mergeDiscoveryDetails(existing?.details, {
    shopUrl: { operator: 'a1', url: abs },
    importTag: 'a1-listing',
  });
  await prisma.phoneModel.upsert({
    where: { slug: parsed.slug },
    create: {
      slug: parsed.slug,
      brand: parsed.brand,
      series: parsed.series,
      storageGb: parsed.storageGb,
      details,
    },
    update: {
      brand: parsed.brand,
      series: parsed.series,
      storageGb: parsed.storageGb,
      details,
    },
  });
}

async function main() {
  const dryRun = hasFlag('--dry-run');
  const sourcesArg = arg('--sources');
  const sources = new Set(
    (sourcesArg ?? 'telekom,a1')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );

  const browser = await chromium.launch({
    headless: process.env.HEADFUL !== '1',
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    locale: 'sl-SI',
    timezoneId: 'Europe/Ljubljana',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  let telekomCount = 0;
  let a1Count = 0;

  try {
    if (sources.has('telekom')) {
      const urls = await collectTelekomMobitelUrls(page);
      telekomCount = urls.length;
      console.log(`Telekom: ${urls.length} product URLs`);
      for (const url of urls) {
        await upsertFromTelekomUrl(url, dryRun);
      }
    }

    if (sources.has('a1')) {
      const paths = await collectA1TelefoniPaths(page);
      a1Count = paths.length;
      console.log(`A1: ${paths.length} listing paths`);
      for (const path of paths) {
        await upsertFromA1Path(path, dryRun);
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }

  if (!dryRun) {
    const total = await prisma.phoneModel.count();
    console.log(`Done. PhoneModel rows in DB: ${total}`);
  } else {
    console.log(`Dry run: telekom URLs=${telekomCount}, a1 paths=${a1Count} (no DB writes)`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
