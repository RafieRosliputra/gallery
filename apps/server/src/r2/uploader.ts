import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { R2Config, WorkerUploadConfig } from '../config.js';
import { derivativeDirectory } from '../thumbs/generate.js';

export const R2_CACHE_CONTROL = 'public, max-age=31536000, immutable';
export const R2_CONTENT_TYPE = 'image/webp';

/** R2 object key, matching SPEC § Storage: `t/<key>/<size>.webp`. */
export function r2Key(derivKey: string, size: '300' | '1600'): string {
  return `t/${derivKey}/${size}.webp`;
}

export interface R2Uploader {
  upload(derivKey: string, dataDir: string): Promise<string[]>;
}

const SIZES = ['300', '1600'] as const;

export function createS3Uploader(config: R2Config): R2Uploader {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  return {
    async upload(derivKey: string, dataDir: string): Promise<string[]> {
      const directory = derivativeDirectory(dataDir, derivKey);
      const keys: string[] = [];
      for (const size of SIZES) {
        const body = await readFile(path.join(directory, `${size}.webp`));
        const key = r2Key(derivKey, size);
        await client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: key,
            Body: body,
            ContentType: R2_CONTENT_TYPE,
            CacheControl: R2_CACHE_CONTROL,
          }),
        );
        keys.push(key);
      }
      return keys;
    },
  };
}

/**
 * R2_MODE=worker: upload through the Cloudflare Worker route (PUT /s/_r2/<key>)
 * so the NAS never needs R2 credentials. The Worker keeps its own R2 binding.
 */
export function createWorkerUploader(config: WorkerUploadConfig): R2Uploader {
  return {
    async upload(derivKey: string, dataDir: string): Promise<string[]> {
      const directory = derivativeDirectory(dataDir, derivKey);
      const keys: string[] = [];
      for (const size of SIZES) {
        const body = await readFile(path.join(directory, `${size}.webp`));
        const key = r2Key(derivKey, size);
        const response = await fetch(`${config.uploadUrl}/${key}`, {
          method: 'PUT',
          headers: {
            'X-Upload-Secret': config.secret,
            'Content-Type': R2_CONTENT_TYPE,
          },
          body,
          signal: AbortSignal.timeout(60_000),
        });
        if (!response.ok) {
          const detail = (await response.text().catch(() => '')).slice(0, 200);
          throw new Error(`worker upload ${key} failed: ${response.status}${detail ? ` ${detail}` : ''}`);
        }
        keys.push(key);
      }
      return keys;
    },
  };
}

export function createUploader(config: {
  r2Mode: 'off' | 's3' | 'worker';
  r2?: R2Config;
  workerUpload?: WorkerUploadConfig;
}): R2Uploader | undefined {
  if (config.r2Mode === 's3' && config.r2) return createS3Uploader(config.r2);
  if (config.r2Mode === 'worker' && config.workerUpload) return createWorkerUploader(config.workerUpload);
  return undefined;
}
