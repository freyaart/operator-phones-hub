const STORAGE = new Set([32, 64, 128, 256, 512, 1024]);

const COLOR_SUFFIX =
  /-(crna|bela|crn|black|white|modra|zelena|siva|grafitna|mentol|cosmic(?:-orange)?|titan|orange|plavi|vijoli|zlata|transparent|obsidian|mix|vijolicna|nebesno|nebesko(?:-modra)?|kobaltno(?:-vijolicna)?|ledeno(?:-modra)?|mornarsko(?:-modra)?|senca|blescece|izjemna(?:-temno-siva)?|dark(?:-blue|-green)?|light|natural|platinum|space|midnight|starlight|blue|green|purple|pink|gold|prozorno|violet|lavender|titanium|alpine|graphite|sierra|pacific|slate|cream|coral|lavanda|grey|gray|sky-blue|mint|silver|srebrna|belo|peach|rose|golden)(?:-\d+)?$/i;

const NON_PHONE_HINT = /(watch|kiddo|tab-|tablet|ipad|buds|airpods|case|ovitek|mapa|etui|zascit|glass|steklo|polnilec|charger|cable|kabel)/i;

const BRAND_SLUG: Record<string, string> = {
  Apple: 'apple',
  Samsung: 'samsung',
  Google: 'google',
  Xiaomi: 'xiaomi',
  Honor: 'honor',
  Huawei: 'huawei',
  Doro: 'doro',
  Nothing: 'nothing',
  OnePlus: 'oneplus',
  Oppo: 'oppo',
  Motorola: 'motorola',
  Realme: 'realme',
};

function inferBrand(slug: string): string {
  const s = slug.toLowerCase();
  if (s.startsWith('iphone-') || s.startsWith('apple-')) return 'Apple';
  if (s.startsWith('samsung-')) return 'Samsung';
  if (s.startsWith('google-')) return 'Google';
  if (s.startsWith('xiaomi-') || s.startsWith('redmi-')) return 'Xiaomi';
  if (s.startsWith('honor-')) return 'Honor';
  if (s.startsWith('huawei-')) return 'Huawei';
  if (s.startsWith('doro-')) return 'Doro';
  if (s.startsWith('nothing-')) return 'Nothing';
  if (s.startsWith('oneplus-')) return 'OnePlus';
  if (s.startsWith('oppo-')) return 'Oppo';
  if (s.startsWith('motorola-') || s.startsWith('moto-')) return 'Motorola';
  if (s.startsWith('realme-')) return 'Realme';
  return slug.split('-')[0].replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Last plausible storage token in slug (supports `128gb` and `128-gb`; avoids `5g`). */
export function extractStorageGb(slug: string): number | null {
  const matches = [...slug.toLowerCase().matchAll(/(?:^|-)(\d{2,4})(?:-gb|gb)(?=-|$)/g)];
  let last: number | null = null;
  for (const m of matches) {
    const n = parseInt(m[1], 10);
    if (STORAGE.has(n)) last = n;
  }
  return last;
}

function extractColorSlug(slug: string): string | null {
  const match = slug.match(COLOR_SUFFIX);
  if (!match) return null;
  return match[1].toLowerCase();
}

function humanizeToken(w: string): string {
  if (w === '5g' || w === '4g') return w.toUpperCase();
  if (/^iphone/i.test(w)) return w.replace(/^i/, 'I');
  if (/^\d+[a-z]?$/i.test(w)) return w.toUpperCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
}

function normalizeAscii(input: string): string {
  return input.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

export function slugifyCatalogText(input: string): string {
  return normalizeAscii(input)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[+/(),]/g, ' ')
    .replace(/['".]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function humanizeSeries(slug: string, brand: string): string {
  let s = slug.toLowerCase().replace(/#/g, '');
  const st = extractStorageGb(s);
  if (st) {
    s = s.replace(new RegExp(`-${st}-gb`, 'i'), '');
    s = s.replace(new RegExp(`-${st}gb`, 'i'), '');
  }
  s = s.replace(COLOR_SUFFIX, '');
  const brandPrefixes: Record<string, RegExp> = {
    Apple: /^(apple-|iphone-)/i,
    Samsung: /^samsung-/i,
    Google: /^google-/i,
    Xiaomi: /^(xiaomi-|redmi-)/i,
    Honor: /^honor-/i,
    Huawei: /^huawei-/i,
    Doro: /^doro-/i,
    Nothing: /^nothing-/i,
    OnePlus: /^oneplus-/i,
    Oppo: /^oppo-/i,
    Motorola: /^(motorola-|moto-)/i,
    Realme: /^realme-/i,
  };
  const rx = brandPrefixes[brand];
  if (rx) s = s.replace(rx, '');
  s = s.replace(/^-+|-+$/g, '');
  const words = s.split('-').filter(Boolean);
  let joined = words
    .map(humanizeToken)
    .join(' ');
  joined = joined.replace(/\bIphone\b/g, 'iPhone');
  if (st) joined = joined.replace(new RegExp(`\\s+${st}$`), '');
  return joined || slug;
}

export type ParsedCatalogDevice = {
  canonicalSlug: string;
  variantSlug: string;
  brand: string;
  series: string;
  storageGb: number | null;
  color: string | null;
  isPhone: boolean;
};

export function parseCatalogName(input: {
  brand?: string | null;
  name: string;
}): ParsedCatalogDevice {
  const rawName = input.name
    .replace(/\b(mobilni|pametni)\s+telefon\b/gi, '')
    .replace(/\btelefon\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const brand = input.brand?.trim();
  const prefixed =
    brand && !new RegExp(`^${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(rawName)
      ? `${brand} ${rawName}`
      : rawName;
  return parseCatalogSlug(slugifyCatalogText(prefixed));
}

export function parseCatalogSlug(pathSegment: string): ParsedCatalogDevice {
  const variantSlug = pathSegment.toLowerCase().split('#')[0].replace(/^\/+|\/+$/g, '');
  const brand = inferBrand(variantSlug);
  const storageGb = extractStorageGb(variantSlug);
  const color = extractColorSlug(variantSlug);
  let canonicalCore = variantSlug;
  if (storageGb) {
    canonicalCore = canonicalCore.replace(new RegExp(`-${storageGb}-gb`, 'i'), '');
    canonicalCore = canonicalCore.replace(new RegExp(`-${storageGb}gb`, 'i'), '');
  }
  canonicalCore = canonicalCore.replace(COLOR_SUFFIX, '');
  const brandPrefix = BRAND_SLUG[brand] ?? variantSlug.split('-')[0];
  const withoutBrand = canonicalCore
    .replace(new RegExp(`^${brandPrefix}-`, 'i'), '')
    .replace(/^iphone-/i, 'iphone-')
    .replace(/^-+|-+$/g, '');
  const canonicalSlug = `${brandPrefix}-${withoutBrand}`.replace(/--+/g, '-');
  const series = humanizeSeries(canonicalCore, brand);
  return {
    canonicalSlug,
    variantSlug,
    brand,
    series,
    storageGb,
    color: color ? color.split('-').map(humanizeToken).join(' ') : null,
    isPhone: !NON_PHONE_HINT.test(variantSlug),
  };
}
