import type { Prisma } from '@prisma/client';

type PhoneRow = {
  slug: string;
  brand: string;
  series: string;
  /** Optional storage hint; canonical Reborn-first rows no longer carry one. */
  storageGb?: number | null;
  details: Prisma.JsonValue;
};

function asRecord(v: Prisma.JsonValue): Record<string, unknown> | null {
  return v != null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Optional manual PDP URLs per operator: `details.shopUrls: { telekom: "https://...", a1: "..." }` */
export function manualShopUrl(phone: PhoneRow, operator: string): string | null {
  const d = asRecord(phone.details);
  const urls = d?.shopUrls;
  if (!urls || typeof urls !== 'object' || Array.isArray(urls)) return null;
  const u = (urls as Record<string, unknown>)[operator];
  return typeof u === 'string' && u.startsWith('http') ? u : null;
}

export function manualShopUrls(phone: PhoneRow): Record<string, string> {
  const d = asRecord(phone.details);
  const urls = d?.shopUrls;
  if (!urls || typeof urls !== 'object' || Array.isArray(urls)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(urls as Record<string, unknown>)) {
    if (typeof value === 'string' && value.startsWith('http')) out[key] = value;
  }
  return out;
}

/** Telekom mobitel PDP slug candidates (path segment after `/p/`). */
export function telekomMobitelSlugs(phone: PhoneRow): string[] {
  const manual = manualShopUrl(phone, 'telekom');
  if (manual) {
    try {
      const seg = new URL(manual).pathname.split('/p/')[1];
      if (seg) return [seg.replace(/\/$/, '')];
    } catch {
      /* fall through */
    }
  }
  const s = phone.slug.toLowerCase();
  const out: string[] = [];
  const add = (x: string) => {
    if (x && !out.includes(x)) out.push(x);
  };
  add(s);
  const noGbSuffix = s.replace(/-(128|256|512|1024)gb$/i, '');
  if (noGbSuffix !== s) add(noGbSuffix);
  const trail = s.match(/^(.*)-(\d{2,4})$/);
  if (trail && !/gb|tb/i.test(s)) {
    const n = parseInt(trail[2], 10);
    if (n >= 32 && n <= 2048) add(trail[1]);
  }
  return out;
}

export function searchPhrase(phone: PhoneRow): string {
  const parts = [phone.brand, phone.series, phone.storageGb != null ? `${phone.storageGb} GB` : ''].filter(Boolean);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Drop a trailing `-128gb` style suffix so we can match canonical Reborn-first slugs
 * (which no longer carry storage in the slug).
 */
export function stripStorageSuffix(slug: string): string {
  return slug.replace(/-(16|32|64|128|256|512|1024|2048)(?:-gb|gb)$/i, '');
}
