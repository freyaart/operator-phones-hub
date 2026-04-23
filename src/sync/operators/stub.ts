/**
 * Placeholder sync: replace with Playwright / HTTP scrapers per operator.
 * Return `null` fields when a scrape fails so you can spot gaps in the API.
 */
import type { OperatorId } from '../../types.js';
import type { OfferPayload } from '../upsertOffer.js';

export async function stubFetchOffer(
  _operator: OperatorId,
  ctx: { brand: string; series: string; storageGb: number | null; slug: string }
): Promise<Partial<OfferPayload>> {
  void ctx;
  return {
    retailPriceEur: null,
    monthlyEur: null,
    tradeInAvailable: null,
    productUrl: null,
    raw: { note: 'stub — implement scraper in src/sync/operators/<operator>.ts' },
  };
}
