import type { AdminSession } from './sessions.js';

declare module 'fastify' {
  interface FastifyRequest {
    adminSession?: AdminSession;
  }
}

export {};
