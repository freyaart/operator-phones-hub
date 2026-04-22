import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { phonesRouter } from './api/phones.js';

const app = new Hono();

app.use('/*', cors({ origin: '*' }));

app.get('/health', (c) => c.json({ ok: true, service: 'operator-phones-hub' }));

app.route('/api', phonesRouter);

const port = Number(process.env.PORT || 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Listening on http://localhost:${info.port}`);
  console.log(`  GET  /health`);
  console.log(`  GET  /api/phones`);
  console.log(`  GET  /api/phones/compare?slugs=a,b`);
  console.log(`  GET  /api/phones/:slug`);
});
