import type { Prisma } from '@prisma/client';
import { Hono } from 'hono';
import { prisma } from '../db.js';
import { isOperatorId } from '../types.js';
import { rowForComparison, unionSortedColumns } from '../lib/flattenSpecs.js';

const app = new Hono();

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
    where.offers = { some: { operator } };
  }

  const rows = await prisma.phoneModel.findMany({
    where,
    orderBy: [{ brand: 'asc' }, { series: 'asc' }, { storageGb: 'asc' }],
    include: {
      offers: true,
    },
  });

  return c.json({ data: rows, count: rows.length });
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
    include: { offers: true },
  });

  const bySlug = new Map(found.map((p) => [p.slug, p]));
  const missing = slugs.filter((s) => !bySlug.has(s));
  if (missing.length > 0) {
    return c.json({ error: 'Some slugs were not found', missing }, 404);
  }

  const phones = slugs.map((s) => bySlug.get(s)!);
  const rows = phones.map(rowForComparison);
  const columns = unionSortedColumns(rows);

  return c.json({
    slugs: phones.map((p) => p.slug),
    columns,
    rows,
    /** Original nested objects if the UI needs grouped sections */
    phones,
  });
});

app.get('/phones/:slug', async (c) => {
  const slug = c.req.param('slug');
  const row = await prisma.phoneModel.findUnique({
    where: { slug },
    include: { offers: true },
  });
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json({ data: row });
});

export { app as phonesRouter };
