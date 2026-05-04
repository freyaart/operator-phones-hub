/**
 * Match operator catalog items to canonical Reborn-sourced `PhoneModel` rows.
 *
 * The matcher runs in stages, from strictest to loosest:
 *   1. exact canonical-slug match (parsed slug -> PhoneModel.slug)
 *   2. brand + normalized series match (storage / color stripped)
 *   3. brand + normalized series with light token mutations (proplus -> pro plus, ...)
 *
 * Each stage records a confidence score and a `matchedBy` tag so reviewers know
 * which heuristic produced the link. Anything that survives all stages stays in
 * `UNMATCHED` so it can be reviewed and resolved manually.
 */
import type { MatchStatus, PhoneModel } from '@prisma/client';
import { prisma } from '../db.js';
import { humanizeSeries, slugifyCatalogText } from '../discovery/parse-catalog-slug.js';

const SERIES_NOISE_TOKENS = new Set([
  '4g',
  '5g',
  'lte',
  'dual',
  'sim',
  'esim',
  'global',
  'eu',
  'edition',
]);

export type MatcherInput = {
  parsedBrand: string | null;
  parsedSeries: string | null;
  parsedSlug: string | null;
  storageGb?: number | null;
  displayName?: string | null;
};

export type MatcherDecision = {
  phoneModelId: string | null;
  matchStatus: MatchStatus;
  matchConfidence: number | null;
  matchedBy: string | null;
};

function normalizeSeries(value: string): string {
  return value
    .toLowerCase()
    .replace(/\(([^)]*)\)/g, ' ')
    .replace(/[^a-z0-9+\s]/g, ' ')
    .replace(/\bproplus\b/g, 'pro plus')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeSeries(value: string): string[] {
  return normalizeSeries(value)
    .split(' ')
    .filter((token) => token && !SERIES_NOISE_TOKENS.has(token) && !/^\d{2,4}gb$/i.test(token));
}

function dropConnectivity(slug: string): string {
  return slug
    .replace(/-(4g|5g|lte)(?=-|$)/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function brandsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function buildSlugCandidates(input: MatcherInput): string[] {
  const candidates = new Set<string>();
  if (input.parsedSlug) {
    candidates.add(input.parsedSlug);
    candidates.add(dropConnectivity(input.parsedSlug));
  }
  if (input.parsedBrand && input.parsedSeries) {
    const seriesSlug = slugifyCatalogText(input.parsedSeries);
    const brandSlug = slugifyCatalogText(input.parsedBrand);
    candidates.add(`${brandSlug}-${seriesSlug}`.replace(/--+/g, '-'));
    candidates.add(dropConnectivity(`${brandSlug}-${seriesSlug}`));
  }
  return [...candidates].filter(Boolean);
}

async function loadCandidatesByBrand(brand: string): Promise<PhoneModel[]> {
  return prisma.phoneModel.findMany({
    where: { brand: { equals: brand, mode: 'insensitive' } },
  });
}

function scoreSeriesMatch(inputSeries: string, candidate: PhoneModel): number {
  const inputTokens = tokenizeSeries(inputSeries);
  const candidateTokens = tokenizeSeries(`${candidate.series} ${candidate.marketingName ?? ''}`);
  if (inputTokens.length === 0 || candidateTokens.length === 0) return 0;
  const candidateSet = new Set(candidateTokens);
  let hits = 0;
  for (const token of inputTokens) {
    if (candidateSet.has(token)) hits += 1;
  }
  const precision = hits / inputTokens.length;
  const recall = hits / candidateTokens.length;
  if (precision === 0 || recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

export async function matchOperatorItem(input: MatcherInput): Promise<MatcherDecision> {
  // Stage 1: exact canonical-slug match.
  const slugCandidates = buildSlugCandidates(input);
  if (slugCandidates.length > 0) {
    const exact = await prisma.phoneModel.findFirst({ where: { slug: { in: slugCandidates } } });
    if (exact) {
      return {
        phoneModelId: exact.id,
        matchStatus: 'MATCHED_AUTO',
        matchConfidence: 1,
        matchedBy: 'auto-slug',
      };
    }
  }

  // Stages 2+ require a brand + series; otherwise we can't safely match.
  if (!input.parsedBrand || !input.parsedSeries) {
    return { phoneModelId: null, matchStatus: 'UNMATCHED', matchConfidence: null, matchedBy: null };
  }

  const candidates = await loadCandidatesByBrand(input.parsedBrand);
  if (candidates.length === 0) {
    return { phoneModelId: null, matchStatus: 'UNMATCHED', matchConfidence: null, matchedBy: null };
  }

  // Stage 2: best F1 over normalized series tokens.
  let bestCandidate: PhoneModel | null = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    if (!brandsEqual(candidate.brand, input.parsedBrand)) continue;
    const score = scoreSeriesMatch(input.parsedSeries, candidate);
    if (score > bestScore) {
      bestCandidate = candidate;
      bestScore = score;
    }
  }

  if (bestCandidate && bestScore >= 0.85) {
    return {
      phoneModelId: bestCandidate.id,
      matchStatus: 'MATCHED_AUTO',
      matchConfidence: bestScore,
      matchedBy: 'auto-series-tokens',
    };
  }

  if (bestCandidate && bestScore >= 0.6) {
    return {
      phoneModelId: bestCandidate.id,
      matchStatus: 'NEEDS_REVIEW',
      matchConfidence: bestScore,
      matchedBy: 'auto-series-tokens',
    };
  }

  return { phoneModelId: null, matchStatus: 'UNMATCHED', matchConfidence: null, matchedBy: null };
}

/**
 * Build matcher input from a normalized operator catalog row, deriving parsed
 * fields from the existing slug/series helpers when they're missing.
 */
export function buildMatcherInput(item: {
  parsedBrand: string | null;
  parsedSeries: string | null;
  parsedSlug: string | null;
  storageGb: number | null;
  displayName: string | null;
}): MatcherInput {
  let parsedSeries = item.parsedSeries;
  if (!parsedSeries && item.parsedSlug && item.parsedBrand) {
    parsedSeries = humanizeSeries(item.parsedSlug, item.parsedBrand);
  }
  return {
    parsedBrand: item.parsedBrand,
    parsedSeries,
    parsedSlug: item.parsedSlug,
    storageGb: item.storageGb,
    displayName: item.displayName,
  };
}

export type RematchOptions = {
  onlyUnmatched?: boolean;
  preserveManual?: boolean;
};

export type RematchSummary = {
  scanned: number;
  matched: number;
  needsReview: number;
  unmatched: number;
  preservedManual: number;
};

/**
 * Re-run the matcher across operator catalog items. Used by `sync:reborn` to
 * refresh links after the canonical catalog changes. By default we leave
 * manually-matched rows alone.
 */
export async function rematchAllOperatorCatalogItems(options: RematchOptions = {}): Promise<RematchSummary> {
  const { onlyUnmatched = false, preserveManual = true } = options;
  const where: { matchStatus?: MatchStatus | { in: MatchStatus[] } } = {};
  if (onlyUnmatched) {
    where.matchStatus = { in: ['UNMATCHED', 'NEEDS_REVIEW'] };
  } else if (preserveManual) {
    where.matchStatus = { in: ['UNMATCHED', 'NEEDS_REVIEW', 'MATCHED_AUTO'] };
  }

  const items = await prisma.operatorCatalogItem.findMany({ where });
  const summary: RematchSummary = {
    scanned: items.length,
    matched: 0,
    needsReview: 0,
    unmatched: 0,
    preservedManual: 0,
  };

  for (const item of items) {
    if (preserveManual && item.matchStatus === 'MATCHED_MANUAL') {
      summary.preservedManual += 1;
      continue;
    }
    const decision = await matchOperatorItem(
      buildMatcherInput({
        parsedBrand: item.parsedBrand,
        parsedSeries: item.parsedSeries,
        parsedSlug: item.parsedSlug,
        storageGb: item.storageGb,
        displayName: item.displayName,
      }),
    );

    if (decision.phoneModelId === item.phoneModelId && decision.matchStatus === item.matchStatus) {
      summary[bucketKey(decision.matchStatus)] += 1;
      continue;
    }

    await prisma.operatorCatalogItem.update({
      where: { id: item.id },
      data: {
        phoneModelId: decision.phoneModelId,
        matchStatus: decision.matchStatus,
        matchConfidence: decision.matchConfidence,
        matchedBy: decision.matchedBy,
        matchedAt: decision.phoneModelId ? new Date() : null,
      },
    });

    if (decision.phoneModelId) {
      await prisma.operatorOffer.updateMany({
        where: { operatorCatalogItemId: item.id },
        data: { phoneModelId: decision.phoneModelId },
      });
    } else {
      await prisma.operatorOffer.updateMany({
        where: { operatorCatalogItemId: item.id },
        data: { phoneModelId: null },
      });
    }

    summary[bucketKey(decision.matchStatus)] += 1;
  }

  return summary;
}

function bucketKey(status: MatchStatus): 'matched' | 'needsReview' | 'unmatched' {
  switch (status) {
    case 'MATCHED_AUTO':
    case 'MATCHED_MANUAL':
      return 'matched';
    case 'NEEDS_REVIEW':
      return 'needsReview';
    default:
      return 'unmatched';
  }
}
