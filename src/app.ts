import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { phonesRouter } from './api/phones.js';

/** Shared Hono app: used by local `server.ts` and Vercel `api/index.ts`. */
export const app = new Hono();

app.use('/*', cors({ origin: '*' }));

app.get('/health', (c) => c.json({ ok: true, service: 'operator-phones-hub' }));

app.route('/api', phonesRouter);
