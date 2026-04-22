const STORAGE = new Set([32, 64, 128, 256, 512, 1024]);

const COLOR_SUFFIX =
  /-(crna|bela|crn|black|white|modra|zelena|siva|grafitna|mentol|cosmic|titan|orange|plavi|vijoli|zlata|transparent|obsidian|mix|vijolicna|nebesno|blescece|izjemna|dark|light|natural|platinum|space|midnight|starlight|blue|green|purple|pink|gold|prozorno|violet|lavender|titanium|alpine|graphite|sierra|pacific|slate|cream|coral|lavanda)(?:-\d+)?$/i;

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
    .map((w) => {
      if (w === '5g' || w === '4g') return w.toUpperCase();
      if (/^iphone/i.test(w)) return w.replace(/^i/, 'I');
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
  joined = joined.replace(/\bIphone\b/g, 'iPhone');
  if (st) joined = joined.replace(new RegExp(`\\s+${st}$`), '');
  return joined || slug;
}

export type ParsedCatalogDevice = {
  slug: string;
  brand: string;
  series: string;
  storageGb: number | null;
};

export function parseCatalogSlug(pathSegment: string): ParsedCatalogDevice {
  const slug = pathSegment.toLowerCase().split('#')[0].replace(/^\/+|\/+$/g, '');
  const brand = inferBrand(slug);
  const storageGb = extractStorageGb(slug);
  const series = humanizeSeries(slug, brand);
  return { slug, brand, series, storageGb };
}
