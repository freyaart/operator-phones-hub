/**
 * Turn nested `specs` JSON into dot-path keys so you can render comparison tables / CSV.
 */

export type FlatScalar = string | number | boolean | null;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function scalarToCell(v: unknown): FlatScalar {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean')) {
      return v.map(String).join('; ');
    }
    return JSON.stringify(v);
  }
  return JSON.stringify(v);
}

/** Flatten nested objects into "a.b.c" keys; arrays become a single delimited string. */
export function flattenSpecsTree(root: unknown, prefix = ''): Record<string, FlatScalar> {
  const out: Record<string, FlatScalar> = {};
  if (root === null || root === undefined) return out;

  if (!isPlainObject(root)) {
    if (prefix) out[prefix] = scalarToCell(root);
    return out;
  }

  for (const [k, v] of Object.entries(root)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v === null || v === undefined) {
      out[key] = null;
      continue;
    }
    if (isPlainObject(v)) {
      Object.assign(out, flattenSpecsTree(v, key));
    } else {
      out[key] = scalarToCell(v);
    }
  }
  return out;
}

/** Identity + catalog columns + flattened specs (prefixed with `spec.`). */
export function rowForComparison(phone: {
  id: string;
  slug: string;
  brand: string;
  series: string;
  storageGb: number | null;
  specs: unknown;
}): Record<string, FlatScalar> {
  const base: Record<string, FlatScalar> = {
    id: phone.id,
    slug: phone.slug,
    brand: phone.brand,
    series: phone.series,
    storageGb: phone.storageGb,
  };
  const flat = flattenSpecsTree(phone.specs, 'spec');
  return { ...base, ...flat };
}

export function unionSortedColumns(rows: Record<string, FlatScalar>[]): string[] {
  const s = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) s.add(k);
  return [...s].sort((a, b) => a.localeCompare(b));
}
