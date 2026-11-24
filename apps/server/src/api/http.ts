import type { FastifyReply } from 'fastify';
import type { ApiError } from '@gallery/shared';

export const NOT_FOUND_MESSAGE = 'Pautan tidak dijumpai.';
export const UNAUTHORIZED_MESSAGE = 'Sesi tidak sah atau telah tamat.';

export function sendError(
  reply: FastifyReply,
  status: number,
  error: string,
  message: string,
): FastifyReply {
  const body: ApiError = { error, message };
  return reply.code(status).send(body);
}

export function parseBigIntId(raw: string): string | null {
  return /^\d{1,19}$/.test(raw) ? raw : null;
}

export function parseLimit(raw: unknown, fallback: number, max: number): number {
  if (raw === undefined) return fallback;
  const value = typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isInteger(value) || value < 1) return fallback;
  return Math.min(value, max);
}

export function bodyRecord(body: unknown): Record<string, unknown> | null {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}
