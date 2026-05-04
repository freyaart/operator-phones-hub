import type { MatchStatus, Prisma } from '@prisma/client';
import { Hono } from 'hono';
import { prisma } from '../db.js';
import { isOperatorId } from '../types.js';
import { rowForComparison, unionSortedColumns } from '../lib/phone-spec-compare.js';

const app = new Hono();

const MATCHED_STATUSES: MatchStatus[] = ['MATCHED_AUTO', 'MATCHED_MANUAL'];

const OPERATOR_META: Record<string, { name: string }> = {
  a1: { name: 'A1' },
  telekom: { name: 'Telekom Slovenije' },
  t2: { name: 'T-2' },
  telemach: { name: 'Telemach' },
};

const phoneDetailInclude = {
  phoneSpec: true,
  rebornProducts: {
    orderBy: [
      { isMatched: 'desc' },
      { isParent: 'desc' },
      { storageGb: 'asc' },
      { priceEur: 'asc' },
      { productId: 'asc' },
    ],
  },
  catalogItems: {
    where: { matchStatus: { in: MATCHED_STATUSES } },
    include: { offers: true },
    orderBy: [{ operator: 'asc' }, { displayName: 'asc' }],
  },
  artifacts: {
    take: 10,
    orderBy: { createdAt: 'desc' },
  },
} satisfies Prisma.PhoneModelInclude;

function summarizeOffers(
  offers: Array<{
    operator: string;
    offerType: string;
    retailPriceEur: number | null;
    monthlyEur: number | null;
    initialDepositEur: number | null;
    contractMonths: number | null;
    planLabel: string | null;
    productUrl: string | null;
  }>,
) {
  const byOperator = new Map<
    string,
    {
      bestRetailEur: number | null;
      bestContractMonthlyEur: number | null;
      bestContractDepositEur: number | null;
      plans: string[];
    }
  >();
  for (const offer of offers) {
    const current =
      byOperator.get(offer.operator) ??
      {
        bestRetailEur: null,
        bestContractMonthlyEur: null,
        bestContractDepositEur: null,
        plans: [],
      };
    if (offer.offerType === 'RETAIL' && offer.retailPriceEur != null) {
      current.bestRetailEur =
        current.bestRetailEur == null ? offer.retailPriceEur : Math.min(current.bestRetailEur, offer.retailPriceEur);
    }
    if (offer.offerType !== 'RETAIL' && offer.monthlyEur != null) {
      current.bestContractMonthlyEur =
        current.bestContractMonthlyEur == null
          ? offer.monthlyEur
          : Math.min(current.bestContractMonthlyEur, offer.monthlyEur);
      if (offer.initialDepositEur != null) {
        current.bestContractDepositEur =
          current.bestContractDepositEur == null
            ? offer.initialDepositEur
            : Math.min(current.bestContractDepositEur, offer.initialDepositEur);
      }
    }
    if (offer.planLabel && !current.plans.includes(offer.planLabel)) current.plans.push(offer.planLabel);
    byOperator.set(offer.operator, current);
  }
  return Object.fromEntries(byOperator);
}

function offerComparableTotal(offer: {
  retailPriceEur: number | null;
  monthlyEur: number | null;
  initialDepositEur: number | null;
  contractMonths: number | null;
}) {
  if (offer.retailPriceEur != null) return offer.retailPriceEur;
  if (offer.monthlyEur != null) return (offer.initialDepositEur ?? 0) + offer.monthlyEur * (offer.contractMonths ?? 24);
  return Number.POSITIVE_INFINITY;
}

function publicModelBase(query: string) {
  return query
    .replace(/\b\d{2,4}\s*GB\b/gi, '')
    .replace(/\b(black|white|blue|green|pink|teal|natural|titanium|črn|crn|bela|moder|modra|roza)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function findPhoneForPublicQuery(query: string) {
  const q = publicModelBase(query);
  const slug = q.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return prisma.phoneModel.findFirst({
    where: {
      OR: [
        { slug },
        { slug: { contains: slug } },
        { series: { equals: q, mode: 'insensitive' } },
        { marketingName: { equals: q, mode: 'insensitive' } },
        { series: { contains: q, mode: 'insensitive' } },
        { marketingName: { contains: q, mode: 'insensitive' } },
      ],
    },
    include: {
      catalogItems: {
        where: { matchStatus: { in: MATCHED_STATUSES } },
        include: { offers: true },
        orderBy: [{ operator: 'asc' }, { displayName: 'asc' }],
      },
    },
    orderBy: [{ releaseYear: 'desc' }, { series: 'asc' }],
  });
}

app.get('/status/data', async (c) => {
  const [
    phoneModels,
    rebornProducts,
    operatorCatalogItems,
    operatorOffers,
    catalogByMatch,
    catalogByOperator,
    latestRuns,
  ] = await Promise.all([
    prisma.phoneModel.count(),
    prisma.rebornProduct.count(),
    prisma.operatorCatalogItem.count(),
    prisma.operatorOffer.count(),
    prisma.operatorCatalogItem.groupBy({ by: ['matchStatus'], _count: { _all: true } }),
    prisma.operatorCatalogItem.groupBy({ by: ['operator'], _count: { _all: true } }),
    prisma.scrapeRun.findMany({
      take: 20,
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        operator: true,
        runType: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        processedCount: true,
        successCount: true,
        failureCount: true,
        notes: true,
      },
    }),
  ]);
  const matchedCatalogItems = await prisma.operatorCatalogItem.count({
    where: { matchStatus: { in: MATCHED_STATUSES } },
  });

  return c.json({
    ok: phoneModels > 0 && rebornProducts > 0 && operatorCatalogItems > 0 && operatorOffers > 0,
    counts: {
      phoneModels,
      rebornProducts,
      operatorCatalogItems,
      operatorOffers,
      matchedCatalogItems,
    },
    matchSummary: Object.fromEntries(catalogByMatch.map((row) => [row.matchStatus, row._count._all])),
    operatorSummary: Object.fromEntries(catalogByOperator.map((row) => [row.operator, row._count._all])),
    latestRuns,
  });
});

app.get('/public/operator-offers', async (c) => {
  const model = c.req.query('model');
  const slug = c.req.query('slug');
  const query = model ?? slug;
  if (!query?.trim()) return c.json({ error: 'Pass model or slug' }, 400);

  const phone = slug
    ? await prisma.phoneModel.findUnique({
        where: { slug },
        include: {
          catalogItems: {
            where: { matchStatus: { in: MATCHED_STATUSES } },
            include: { offers: true },
            orderBy: [{ operator: 'asc' }, { displayName: 'asc' }],
          },
        },
      })
    : await findPhoneForPublicQuery(query);
  const fallbackCatalogItems = phone
    ? []
    : await prisma.operatorCatalogItem.findMany({
        where: {
          parsedSeries: { equals: publicModelBase(query), mode: 'insensitive' },
        },
        include: { offers: true },
        orderBy: [{ operator: 'asc' }, { displayName: 'asc' }],
      });
  if (!phone && fallbackCatalogItems.length === 0) return c.json({ data: null, offers: [], count: 0 }, 404);

  const catalogItems = phone?.catalogItems ?? fallbackCatalogItems;
  const byOperator = new Map<string, (typeof catalogItems)[number]['offers'][number] & { catalogItemName: string }>();
  for (const item of catalogItems) {
    for (const offer of item.offers) {
      const current = byOperator.get(offer.operator);
      const candidate = { ...offer, catalogItemName: item.displayName };
      if (!current || offerComparableTotal(candidate) < offerComparableTotal(current)) {
        byOperator.set(offer.operator, candidate);
      }
    }
  }

  const offers = [...byOperator.values()]
    .map((offer) => ({
      operatorId: offer.operator,
      operatorName: OPERATOR_META[offer.operator]?.name ?? offer.operator,
      catalogItemName: offer.catalogItemName,
      offerType: offer.offerType,
      title: offer.title,
      retailPriceEur: offer.retailPriceEur,
      monthlyEur: offer.monthlyEur,
      initialDepositEur: offer.initialDepositEur,
      contractMonths: offer.contractMonths,
      planLabel: offer.planLabel,
      productUrl: offer.productUrl,
      availability: offer.availability,
      tradeInAvailable: offer.tradeInAvailable,
    }))
    .sort((a, b) => offerComparableTotal(a) - offerComparableTotal(b));

  return c.json({
    data: {
      phone: {
        id: phone?.id ?? null,
        slug: phone?.slug ?? null,
        brand: phone?.brand ?? catalogItems[0]?.parsedBrand ?? null,
        series: phone?.series ?? publicModelBase(query),
        marketingName: phone?.marketingName ?? null,
        releaseYear: phone?.releaseYear ?? null,
      },
      offers,
    },
    count: offers.length,
  });
});

app.get('/phones', async (c) => {
  const brand = c.req.query('brand');
  const operator = c.req.query('operator');
  const q = c.req.query('q');

  const where: Prisma.PhoneModelWhereInput = {};
  if (brand) where.brand = { contains: brand, mode: 'insensitive' };
  if (q) {
    where.OR = [
      { series: { contains: q, mode: 'insensitive' } },
      { marketingName: { contains: q, mode: 'insensitive' } },
      { slug: { contains: q.toLowerCase() } },
    ];
  }
  if (operator) {
    if (!isOperatorId(operator)) {
      return c.json({ error: `Invalid operator. Use one of: ${['a1', 'telekom', 't2', 'telemach'].join(', ')}` }, 400);
    }
    where.catalogItems = { some: { operator, matchStatus: { in: MATCHED_STATUSES } } };
  }

  const rows = await prisma.phoneModel.findMany({
    where,
    orderBy: [{ brand: 'asc' }, { series: 'asc' }],
    include: {
      phoneSpec: true,
      catalogItems: {
        where: {
          matchStatus: { in: MATCHED_STATUSES },
          ...(operator ? { operator } : {}),
        },
        include: { offers: true },
        orderBy: [{ operator: 'asc' }, { displayName: 'asc' }],
      },
      _count: {
        select: {
          rebornProducts: true,
          catalogItems: { where: { matchStatus: { in: MATCHED_STATUSES } } },
        },
      },
    },
  });

  const data = rows.map((row) => ({
    ...row,
    offerSummary: summarizeOffers(row.catalogItems.flatMap((item) => item.offers)),
  }));

  return c.json({ data, count: data.length });
});

/** Side-by-side rows for comparison tables (flattened `specs` + identity columns). */
app.get('/phones/compare', async (c) => {
  const slugsParam = c.req.query('slugs') ?? '';
  const slugs = [...new Set(slugsParam.split(/[,;]+/).map((s) => s.trim()).filter(Boolean))];

  if (slugs.length < 2) {
    return c.json({ error: 'Pass at least two slugs, e.g. ?slugs=apple-iphone-15-pro,apple-iphone-15' }, 400);
  }

  const found = await prisma.phoneModel.findMany({
    where: { slug: { in: slugs } },
    include: {
      phoneSpec: true,
      catalogItems: {
        where: { matchStatus: { in: MATCHED_STATUSES } },
        include: { offers: true },
      },
    },
  });

  const bySlug = new Map(found.map((p) => [p.slug, p]));
  const missing = slugs.filter((s) => !bySlug.has(s));
  if (missing.length > 0) {
    return c.json({ error: 'Some slugs were not found', missing }, 404);
  }

  const phones = slugs.map((s) => bySlug.get(s)!);
  const rows = phones.map((phone) => {
    const offers = phone.catalogItems.flatMap((item) => item.offers);
    const base = rowForComparison(phone);
    const summary = summarizeOffers(offers);
    for (const [operator, values] of Object.entries(summary)) {
      base[`${operator}.retail`] = values.bestRetailEur;
      base[`${operator}.contractMonthly`] = values.bestContractMonthlyEur;
      base[`${operator}.contractDeposit`] = values.bestContractDepositEur;
      base[`${operator}.plans`] = values.plans.join('; ') || null;
    }
    return base;
  });
  const columns = unionSortedColumns(rows);

  return c.json({
    slugs: phones.map((p) => p.slug),
    columns,
    rows,
    phones: phones.map(({ catalogItems: _catalogItems, ...rest }) => rest),
  });
});

app.get('/operators/:operator/catalog', async (c) => {
  const operator = c.req.param('operator');
  if (!isOperatorId(operator)) {
    return c.json({ error: `Invalid operator. Use one of: ${['a1', 'telekom', 't2', 'telemach'].join(', ')}` }, 400);
  }
  const matchFilter = c.req.query('match');
  const where: Prisma.OperatorCatalogItemWhereInput = { operator };
  if (matchFilter === 'matched') where.matchStatus = { in: MATCHED_STATUSES };
  else if (matchFilter === 'unmatched') where.matchStatus = 'UNMATCHED';
  else if (matchFilter === 'review') where.matchStatus = 'NEEDS_REVIEW';

  const items = await prisma.operatorCatalogItem.findMany({
    where,
    include: {
      phoneModel: {
        include: { phoneSpec: true },
      },
      offers: true,
    },
    orderBy: [{ matchStatus: 'asc' }, { displayName: 'asc' }],
  });
  const counts = await prisma.operatorCatalogItem.groupBy({
    by: ['matchStatus'],
    where: { operator },
    _count: { _all: true },
  });
  return c.json({
    data: items,
    count: items.length,
    matchSummary: Object.fromEntries(counts.map((c) => [c.matchStatus, c._count._all])),
  });
});

/**
 * Inventory of operator catalog items the matcher could not link to a canonical
 * Reborn-sourced model. Useful for review / manual override.
 */
app.get('/catalog/unmatched', async (c) => {
  const operator = c.req.query('operator');
  const includeReview = c.req.query('includeReview') === '1';
  const where: Prisma.OperatorCatalogItemWhereInput = {
    matchStatus: includeReview ? { in: ['UNMATCHED', 'NEEDS_REVIEW'] } : 'UNMATCHED',
  };
  if (operator) {
    if (!isOperatorId(operator)) {
      return c.json({ error: `Invalid operator. Use one of: ${['a1', 'telekom', 't2', 'telemach'].join(', ')}` }, 400);
    }
    where.operator = operator;
  }
  const items = await prisma.operatorCatalogItem.findMany({
    where,
    orderBy: [{ operator: 'asc' }, { displayName: 'asc' }],
  });
  return c.json({ data: items, count: items.length });
});

app.get('/phones/:slug/offers', async (c) => {
  const slug = c.req.param('slug');
  const row = await prisma.phoneModel.findUnique({
    where: { slug },
    include: {
      phoneSpec: true,
      catalogItems: {
        where: { matchStatus: { in: MATCHED_STATUSES } },
        include: { offers: true },
        orderBy: [{ operator: 'asc' }, { displayName: 'asc' }],
      },
    },
  });
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json({
    data: {
      phone: {
        id: row.id,
        slug: row.slug,
        brand: row.brand,
        series: row.series,
        marketingName: row.marketingName,
        releaseYear: row.releaseYear,
        phoneSpec: row.phoneSpec,
      },
      catalogItems: row.catalogItems,
      offerSummary: summarizeOffers(row.catalogItems.flatMap((item) => item.offers)),
    },
  });
});

app.get('/phones/reborn/:productId', async (c) => {
  const productId = Number(c.req.param('productId'));
  if (!Number.isFinite(productId)) {
    return c.json({ error: 'Reborn product id must be numeric' }, 400);
  }

  const rebornProduct = await prisma.rebornProduct.findUnique({
    where: { productId },
    include: {
      phoneModel: {
        include: phoneDetailInclude,
      },
    },
  });
  if (!rebornProduct) return c.json({ error: 'Not found' }, 404);

  return c.json({
    data: rebornProduct.phoneModel,
    rebornProduct,
  });
});

app.get('/phones/:slug', async (c) => {
  const slug = c.req.param('slug');
  const row = await prisma.phoneModel.findUnique({
    where: { slug },
    include: phoneDetailInclude,
  });
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json({ data: row });
});

export { app as phonesRouter };
