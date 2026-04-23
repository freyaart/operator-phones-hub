/** Parse Slovenian-style money: `1.399,00` or `739,00` (NBSP allowed). */
export function parseSiEuroString(fragment: string): number | null {
  const s = fragment.replace(/\u00a0/g, ' ').replace(/\s/g, '').replace('€', '');
  const m = s.match(/^(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})$/);
  if (!m) return null;
  const num = m[1].includes('.') ? m[1].replace(/\./g, '').replace(',', '.') : m[1].replace(',', '.');
  const v = parseFloat(num);
  return Number.isFinite(v) ? v : null;
}

/** First SI-format euro amount in a string (greedy left-to-right). */
export function firstSiEuroIn(text: string): number | null {
  const m = text.match(/(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})\s*€/);
  return m ? parseSiEuroString(m[1]) : null;
}

export function allSiEuroAmounts(text: string): number[] {
  const matches = [...text.matchAll(/(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})\s*€/g)];
  return matches
    .map((m) => parseSiEuroString(m[1]))
    .filter((v): v is number => v !== null);
}
