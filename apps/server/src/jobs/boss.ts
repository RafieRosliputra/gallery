import { PgBoss } from 'pg-boss';

export const QUEUE_THUMB = 'thumb.generate';
export const QUEUE_R2 = 'r2.upload';

/**
 * Thumbnails run at the lowest queue priority: pg-boss orders by priority DESC,
 * so -1 sorts behind the default 0 used by future queues.
 */
const LOW_PRIORITY = -1;

export function createBoss(databaseUrl: string): PgBoss {
  return new PgBoss({ connectionString: databaseUrl });
}

export async function ensureQueues(boss: PgBoss): Promise<void> {
  await boss.createQueue(QUEUE_THUMB, {
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 600,
    retentionSeconds: 7 * 24 * 60 * 60,
  });
  await boss.createQueue(QUEUE_R2, {
    retryLimit: 5,
    retryDelay: 60,
    retryBackoff: true,
    expireInSeconds: 300,
    retentionSeconds: 7 * 24 * 60 * 60,
  });
}

const INSERT_BATCH_SIZE = 500;

export async function enqueueThumbnails(boss: PgBoss, assetIds: string[]): Promise<number> {
  let sent = 0;
  for (let offset = 0; offset < assetIds.length; offset += INSERT_BATCH_SIZE) {
    const batch = assetIds.slice(offset, offset + INSERT_BATCH_SIZE);
    const ids = await boss.insert(
      QUEUE_THUMB,
      batch.map((assetId) => ({ data: { assetId }, priority: LOW_PRIORITY })),
    );
    sent += ids?.length ?? 0;
  }
  return sent;
}

export async function enqueueR2Upload(boss: PgBoss, assetId: string): Promise<void> {
  await boss.send(QUEUE_R2, { assetId }, { priority: LOW_PRIORITY });
}
