import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { prisma } from '../db.js';

type Step = {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
};

function requireEnv(name: string) {
  if (!process.env[name]?.trim()) {
    throw new Error(`${name} is required`);
  }
}

function run(step: Step) {
  return new Promise<void>((resolve, reject) => {
    console.log(`\n==> ${step.name}`);
    const child = spawn(step.command, step.args, {
      stdio: 'inherit',
      env: { ...process.env, ...step.env },
      shell: process.platform === 'win32',
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${step.name} failed with exit code ${code}`));
    });
  });
}

async function assertDatabaseReachable() {
  await prisma.$queryRaw`SELECT 1`;
}

function assertPlaywrightInstalled() {
  const browserDir = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (browserDir && existsSync(browserDir)) return;
  // `playwright install chromium` is idempotent, so this is a warning rather than a hard fail.
  console.warn('If discovery fails because Chromium is missing, run: npm run playwright:install');
}

async function main() {
  requireEnv('DATABASE_URL');
  requireEnv('REBORN_WAVE_API_URL');
  await assertDatabaseReachable();
  assertPlaywrightInstalled();

  const sourcesArg = process.argv.find((arg) => arg.startsWith('--sources='));
  const sources = sourcesArg ? [sourcesArg] : [];

  const steps: Step[] = [
    { name: 'Generate Prisma client', command: 'npm', args: ['run', 'db:generate'] },
    { name: 'Sync Reborn catalog', command: 'npm', args: ['run', 'sync:reborn', '--', '--rematch'] },
    { name: 'Discover operator catalog', command: 'npm', args: ['run', 'discover', '--', ...sources] },
    { name: 'Sync operator offers', command: 'npm', args: ['run', 'sync'] },
  ];

  for (const step of steps) {
    await run(step);
  }

  const [phones, rebornProducts, catalogItems, offers, matched] = await Promise.all([
    prisma.phoneModel.count(),
    prisma.rebornProduct.count(),
    prisma.operatorCatalogItem.count(),
    prisma.operatorOffer.count(),
    prisma.operatorCatalogItem.count({ where: { matchStatus: { in: ['MATCHED_AUTO', 'MATCHED_MANUAL'] } } }),
  ]);
  console.log('\nBootstrap complete:', { phones, rebornProducts, catalogItems, offers, matched });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
