import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';

export type ScrapeCounters = {
  processedCount?: number;
  successCount?: number;
  failureCount?: number;
};

export async function beginScrapeRun(input: {
  operator: string;
  runType: 'DISCOVER' | 'SYNC';
  version?: string;
  metadata?: Prisma.InputJsonValue;
}) {
  return prisma.scrapeRun.create({
    data: {
      operator: input.operator,
      runType: input.runType,
      version: input.version,
      metadata: input.metadata,
    },
  });
}

export async function finishScrapeRun(
  scrapeRunId: string,
  input: {
    status: 'SUCCESS' | 'PARTIAL' | 'FAILURE';
    notes?: string | null;
    metadata?: Prisma.InputJsonValue;
  } & ScrapeCounters,
) {
  return prisma.scrapeRun.update({
    where: { id: scrapeRunId },
    data: {
      status: input.status,
      notes: input.notes ?? undefined,
      metadata: input.metadata,
      processedCount: input.processedCount,
      successCount: input.successCount,
      failureCount: input.failureCount,
      finishedAt: new Date(),
    },
  });
}

export async function addScrapeArtifact(input: {
  scrapeRunId?: string | null;
  operator: string;
  phoneModelId?: string | null;
  operatorCatalogItemId?: string | null;
  artifactType: string;
  sourceUrl?: string | null;
  contentType?: string | null;
  contentText?: string | null;
  metadata?: Prisma.InputJsonValue;
}) {
  const checksum =
    input.contentText && input.contentText.length > 0
      ? createHash('sha256').update(input.contentText).digest('hex')
      : null;
  return prisma.scrapeArtifact.create({
    data: {
      scrapeRunId: input.scrapeRunId ?? undefined,
      operator: input.operator,
      phoneModelId: input.phoneModelId ?? undefined,
      operatorCatalogItemId: input.operatorCatalogItemId ?? undefined,
      artifactType: input.artifactType,
      sourceUrl: input.sourceUrl ?? undefined,
      contentType: input.contentType ?? undefined,
      contentText: input.contentText ?? undefined,
      checksum: checksum ?? undefined,
      metadata: input.metadata,
    },
  });
}
