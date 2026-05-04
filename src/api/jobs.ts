import { spawn } from 'node:child_process';
import { Hono } from 'hono';
import type { Context } from 'hono';

const app = new Hono();

type JobName = 'reborn' | 'discover' | 'sync';

const JOB_COMMANDS: Record<JobName, string[]> = {
  reborn: ['run', 'sync:reborn', '--', '--rematch'],
  discover: ['run', 'discover'],
  sync: ['run', 'sync'],
};

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = request.headers.get('authorization');
  return header === `Bearer ${secret}`;
}

function runNpmJob(name: JobName) {
  const args = JOB_COMMANDS[name];
  return new Promise<{ exitCode: number | null; output: string }>((resolve, reject) => {
    const child = spawn('npm', args, {
      env: process.env,
      shell: process.platform === 'win32',
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output += String(chunk);
    });
    child.on('error', reject);
    child.on('exit', (exitCode) => resolve({ exitCode, output: output.slice(-12000) }));
  });
}

async function runJob(c: Context, name: JobName) {
  if (!isAuthorized(c.req.raw)) return c.json({ error: 'Unauthorized' }, 401);

  const startedAt = new Date().toISOString();
  const result = await runNpmJob(name);
  const ok = result.exitCode === 0;
  return c.json(
    {
      ok,
      job: name,
      startedAt,
      finishedAt: new Date().toISOString(),
      exitCode: result.exitCode,
      output: result.output,
    },
    ok ? 200 : 500,
  );
}

app.post('/jobs/reborn', (c) => runJob(c, 'reborn'));
app.get('/jobs/reborn', (c) => runJob(c, 'reborn'));
app.post('/jobs/discover', (c) => runJob(c, 'discover'));
app.get('/jobs/discover', (c) => runJob(c, 'discover'));
app.post('/jobs/sync', (c) => runJob(c, 'sync'));
app.get('/jobs/sync', (c) => runJob(c, 'sync'));

export { app as jobsRouter };
