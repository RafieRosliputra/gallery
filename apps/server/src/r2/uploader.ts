import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { R2Config } from '../config.js';
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

export function createR2Uploader(config: R2Config): R2Uploader {
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
      for (const size of ['300', '1600'] as const) {
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
