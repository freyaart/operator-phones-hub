import type { Page } from 'playwright';
import type { Prisma } from '@prisma/client';
import type { OperatorId } from '../../types.js';
import type { OfferPayload } from '../upsertOffer.js';
import { scrapeA1 } from './a1.js';
import { scrapeTelekom } from './telekom.js';
import { scrapeT2 } from './t2.js';
import { scrapeTelemach } from './telemach.js';

export type PhoneSyncRow = {
  id: string;
  slug: string;
  brand: string;
  series: string;
  storageGb: number | null;
  details: Prisma.JsonValue;
};

export async function scrapeOperatorOffer(page: Page, operator: OperatorId, phone: PhoneSyncRow): Promise<OfferPayload> {
  switch (operator) {
    case 'a1':
      return scrapeA1(page, phone);
    case 'telekom':
      return scrapeTelekom(page, phone);
    case 't2':
      return scrapeT2(page, phone);
    case 'telemach':
      return scrapeTelemach(page, phone);
    default:
      return { raw: { error: 'unknown operator' } };
  }
}
