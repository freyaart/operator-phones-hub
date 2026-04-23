import type { Page } from 'playwright';
import type { OperatorId } from '../../types.js';
import { scrapeA1 } from './a1.js';
import { scrapeTelekom } from './telekom.js';
import { scrapeT2 } from './t2.js';
import { scrapeTelemach } from './telemach.js';
import type { OperatorSyncResult, SyncTarget } from './types.js';

export type { SyncTarget } from './types.js';

export async function scrapeOperatorOffer(
  page: Page,
  operator: OperatorId,
  target: SyncTarget,
): Promise<OperatorSyncResult> {
  switch (operator) {
    case 'a1':
      return scrapeA1(page, target);
    case 'telekom':
      return scrapeTelekom(page, target);
    case 't2':
      return scrapeT2(page, target);
    case 'telemach':
      return scrapeTelemach(page, target);
    default:
      return { offers: [], note: 'unknown operator' };
  }
}
