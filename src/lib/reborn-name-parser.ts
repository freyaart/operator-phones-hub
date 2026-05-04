import { slugifyCatalogText } from '../discovery/parse-catalog-slug.js';

const KNOWN_BRANDS = [
  'Apple',
  'Samsung',
  'Google',
  'Xiaomi',
  'Huawei',
  'Honor',
  'OnePlus',
  'Motorola',
  'Realme',
  'Nothing',
  'Oppo',
  'Doro',
  'Sony',
  'ZTE',
  'Asus',
];

const BRAND_SLUG: Record<string, string> = {
  Apple: 'apple',
  Samsung: 'samsung',
  Google: 'google',
  Xiaomi: 'xiaomi',
  Huawei: 'huawei',
  Honor: 'honor',
  OnePlus: 'oneplus',
  Motorola: 'motorola',
  Realme: 'realme',
  Nothing: 'nothing',
  Oppo: 'oppo',
  Doro: 'doro',
  Sony: 'sony',
  ZTE: 'zte',
  Asus: 'asus',
};

const STORAGE_GB_VALUES = new Set([16, 32, 64, 128, 256, 512, 1024, 2048]);

const GRADE_SUFFIX = /\b(A\+|A|B\+|B|C\+|C)\b\s*$/i;

const REBORN_PREFIX = /^\s*reborn\s*®?\s*/i;

/**
 * Strip the "REBORN®" prefix and the marketing tail ("- Obnovljen ... v Sloveniji - A+").
 * Returns the part of the name we can usefully parse.
 */
function trimRebornCosmetics(name: string): { core: string; grade: string | null; tail: string } {
  let working = name.replace(REBORN_PREFIX, '').trim();
  const dashIndex = working.indexOf(' - ');
  let tail = '';
  if (dashIndex !== -1) {
    tail = working.slice(dashIndex + 3).trim();
    working = working.slice(0, dashIndex).trim();
  }
  let grade: string | null = null;
  const gradeMatch = tail.match(GRADE_SUFFIX);
  if (gradeMatch) {
    grade = gradeMatch[1].toUpperCase();
  }
  return { core: working, grade, tail };
}

/**
 * Try to extract a storage value (in GB) from the name fragment.
 * Supports `(128GB)`, `128GB`, `128 GB`. Returns the matched substring + value.
 */
function extractStorage(fragment: string): { storageGb: number | null; cleaned: string } {
  let cleaned = fragment;
  let storageGb: number | null = null;

  const parenMatch = cleaned.match(/\((\d{2,4})\s*(GB|TB)\)/i);
  if (parenMatch) {
    storageGb = normalizeStorage(parenMatch[1], parenMatch[2]);
    cleaned = cleaned.replace(parenMatch[0], ' ').replace(/\s+/g, ' ').trim();
    return { storageGb, cleaned };
  }

  const inlineMatch = cleaned.match(/\b(\d{2,4})\s*(GB|TB)\b/i);
  if (inlineMatch) {
    storageGb = normalizeStorage(inlineMatch[1], inlineMatch[2]);
    cleaned = cleaned.replace(inlineMatch[0], ' ').replace(/\s+/g, ' ').trim();
  }

  return { storageGb, cleaned };
}

function normalizeStorage(rawValue: string, unit: string): number | null {
  const value = parseInt(rawValue, 10);
  if (!Number.isFinite(value)) return null;
  const gb = unit.toUpperCase() === 'TB' ? value * 1024 : value;
  return STORAGE_GB_VALUES.has(gb) ? gb : null;
}

function detectBrand(core: string): string | null {
  for (const brand of KNOWN_BRANDS) {
    const re = new RegExp(`^${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(core)) return brand;
  }
  return null;
}

function brandToSlugPrefix(brand: string): string {
  return BRAND_SLUG[brand] ?? slugifyCatalogText(brand);
}

function buildCanonicalSlug(brand: string, series: string): string {
  const seriesSlug = slugifyCatalogText(series);
  const prefix = brandToSlugPrefix(brand);
  if (seriesSlug.startsWith(`${prefix}-`)) return seriesSlug;
  if (seriesSlug === prefix) return seriesSlug;
  return `${prefix}-${seriesSlug}`.replace(/--+/g, '-');
}

export type ParsedRebornName = {
  brand: string;
  series: string;
  marketingName: string;
  canonicalSlug: string;
  storageGb: number | null;
  grade: string | null;
  /** Original "core" portion (without REBORN® prefix and marketing tail). */
  core: string;
};

/**
 * Parse the canonical brand / model / storage out of a Reborn product name.
 *
 * Examples:
 *   "REBORN® Apple iPhone 6s (32GB) - Obnovljen iPhone z 1-letno garancijo v Sloveniji - A+"
 *     -> { brand: "Apple", series: "iPhone 6s", storageGb: 32, grade: "A+" }
 *   "Reborn® Samsung Galaxy A53 5G (128GB) - ..."
 *     -> { brand: "Samsung", series: "Galaxy A53 5G", storageGb: 128 }
 *   "REBORN® Samsung Galaxy S21 5G 128GB - ..."
 *     -> { brand: "Samsung", series: "Galaxy S21 5G", storageGb: 128 }
 *
 * Returns `null` when the brand can't be detected (likely a non-phone product).
 */
export function parseRebornProductName(name: string): ParsedRebornName | null {
  if (!name) return null;
  const { core, grade } = trimRebornCosmetics(name);
  if (!core) return null;

  const brand = detectBrand(core);
  if (!brand) return null;

  const afterBrand = core.slice(brand.length).trim();
  const { storageGb, cleaned } = extractStorage(afterBrand);
  const series = cleaned.replace(/\s+/g, ' ').trim();
  if (!series) return null;

  const canonicalSlug = buildCanonicalSlug(brand, series);

  return {
    brand,
    series,
    marketingName: series,
    canonicalSlug,
    storageGb,
    grade,
    core,
  };
}

/**
 * Best-effort color extraction from a child product name.
 * Reborn child names typically embed the color before the grade, e.g. "... - space gray - A+".
 * Falls back to `optionText` when the name fails to yield a color.
 */
export function parseRebornChildColor(child: { name: string | null; optionText: string | null }): string | null {
  if (child.optionText && child.optionText.trim()) return child.optionText.trim();
  if (!child.name) return null;
  const stripped = child.name.replace(REBORN_PREFIX, '').trim();
  const segments = stripped
    .split(' - ')
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length < 2) return null;
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const segment = segments[i];
    if (GRADE_SUFFIX.test(segment)) continue;
    if (/(GB|TB|garancijo|Sloveniji|Obnovljen)/i.test(segment)) continue;
    if (segment.split(' ').length > 4) continue;
    return segment;
  }
  return null;
}
