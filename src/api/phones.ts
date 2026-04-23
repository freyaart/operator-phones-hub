import type { Prisma } from '@prisma/client';
import { Hono } from 'hono';
import { prisma } from '../db.js';
import { isOperatorId } from '../types.js';
import { rowForComparison, unionSortedColumns } from '../lib/phone-spec-compare.js';

const app = new Hono();

const phoneDetailInclude = {
  phoneSpec: true,
  rebornProducts: {
    orderBy: [{ isMatched: 'desc' }, { isParent: 'asc' }, { priceEur: 'asc' }, { productId: 'asc' }],
  },
  catalogItems: {
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

app.get('/phones', async (c) => {
  const brand = c.req.query('brand');
  const operator = c.req.query('operator');
  const q = c.req.query('q');

  const where: Prisma.PhoneModelWhereInput = {};
  if (brand) where.brand = { contains: brand };
  if (q) {
    where.OR = [{ series: { contains: q } }, { slug: { contains: q } }];
  }
  if (operator) {
    if (!isOperatorId(operator)) {
      return c.json({ error: `Invalid operator. Use one of: ${['a1', 'telekom', 't2', 'telemach'].join(', ')}` }, 400);
    }
    where.catalogItems = { some: { operator } };
  }

  const rows = await prisma.phoneModel.findMany({
    where,
    orderBy: [{ brand: 'asc' }, { series: 'asc' }],
    include: {
      phoneSpec: true,
      catalogItems: {
        where: operator ? { operator } : undefined,
        include: { offers: true },
        orderBy: [{ operator: 'asc' }, { displayName: 'asc' }],
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
    return c.json({ error: 'Pass at least two slugs, e.g. ?slugs=apple-iphone-15-pro-256,apple-iphone-15-128' }, 400);
  }

  const found = await prisma.phoneModel.findMany({
    where: { slug: { in: slugs } },
    include: {
      phoneSpec: true,
      offers: true,
    },
  });

  const bySlug = new Map(found.map((p) => [p.slug, p]));
  const missing = slugs.filter((s) => !bySlug.has(s));
  if (missing.length > 0) {
    return c.json({ error: 'Some slugs were not found', missing }, 404);
  }

  const phones = slugs.map((s) => bySlug.get(s)!);
  const rows = phones.map((phone) => {
    const base = rowForComparison(phone);
    const summary = summarizeOffers(phone.offers);
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
    phones,
  });
});

app.get('/operators/:operator/catalog', async (c) => {
  const operator = c.req.param('operator');
  if (!isOperatorId(operator)) {
    return c.json({ error: `Invalid operator. Use one of: ${['a1', 'telekom', 't2', 'telemach'].join(', ')}` }, 400);
  }
  const items = await prisma.operatorCatalogItem.findMany({
    where: { operator },
    include: {
      phoneModel: {
        include: {
          phoneSpec: true,
        },
      },
      offers: true,
    },
    orderBy: [{ displayName: 'asc' }],
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
