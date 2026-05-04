# Operator Phones Hub

Catalog and offer API for Slovenian operator phone data. The database is populated in this order:

1. Reborn canonical catalog (`PhoneModel`, `RebornProduct`)
2. Operator catalog discovery (`OperatorCatalogItem`)
3. Operator offer sync (`OperatorOffer`)

## Environment

Create `.env` with:

```bash
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require
REBORN_WAVE_API_URL=https://api.wave.si
PORT=8787
```

Optional runtime settings:

```bash
CRON_SECRET=shared-secret-for-cron-routes
HEADFUL=1
SYNC_PDP_CONCURRENCY=3
SYNC_DB_CONCURRENCY=6
REBORN_SYNC_CONCURRENCY=5
```

## Bootstrap

Install Chromium once, then run the full resumable pipeline:

```bash
npm install
npm run playwright:install
npm run bootstrap:data
```

The bootstrap command validates `DATABASE_URL`, `REBORN_WAVE_API_URL`, database connectivity, then runs:

```bash
npm run db:generate
npm run sync:reborn -- --rematch
npm run discover
npm run sync
```

All steps use upserts, so rerunning after a failed later step is expected.

## Scheduled Jobs

The same operations are exposed for cron:

```text
GET/POST /api/jobs/reborn
GET/POST /api/jobs/discover
GET/POST /api/jobs/sync
```

If `CRON_SECRET` is set, call them with:

```text
Authorization: Bearer <CRON_SECRET>
```

`vercel.json` schedules Reborn twice daily, discovery daily, and offer sync every four hours.

## Sanity Checks

After bootstrap, check:

```text
GET /health
GET /api/status/data
GET /api/phones?q=iPhone
GET /api/public/operator-offers?model=iPhone%2015%20256GB
```

Expected `/api/status/data` counts after a successful run:

```text
PhoneModel > 0
RebornProduct > 0
OperatorCatalogItem > 0
OperatorOffer > 0
matchedCatalogItems > 0
```

Inspect matching gaps with:

```bash
npm run review:unmatched
```

Do matcher/parser work only from real unmatched output.

## Public Consumer API

`GET /api/public/operator-offers?model=<display name>` returns a stable DTO for frontends such as `zamenjaj-mobi`:

```json
{
  "data": {
    "phone": {
      "slug": "apple-iphone-15",
      "brand": "Apple",
      "series": "iPhone 15"
    },
    "offers": [
      {
        "operatorId": "a1",
        "operatorName": "A1",
        "retailPriceEur": 999,
        "monthlyEur": 41.62,
        "initialDepositEur": null,
        "contractMonths": 24,
        "planLabel": "Paket",
        "productUrl": "https://...",
        "availability": "IN_STOCK"
      }
    ]
  },
  "count": 1
}
```
