import { serve } from '@hono/node-server';
import { app } from './app.js';

const port = Number(process.env.PORT || 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Listening on http://localhost:${info.port}`);
  console.log(`  GET  /health`);
  console.log(`  GET  /api/phones`);
  console.log(`  GET  /api/phones/compare?slugs=a,b`);
  console.log(`  GET  /api/phones/reborn/:productId`);
  console.log(`  GET  /api/phones/:slug/offers`);
  console.log(`  GET  /api/operators/:operator/catalog`);
  console.log(`  GET  /api/phones/:slug`);
});
