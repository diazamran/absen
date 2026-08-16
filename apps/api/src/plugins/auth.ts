import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { verifyToken } from '../lib/crypto.js';
import { config } from '../config.js';
import { ApiError } from '../utils/errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: { id: string; roleKey: string; fullName: string };
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest) => Promise<void>;
  }
}

export const authPlugin = fp(async (app: FastifyInstance) => {
  app.decorate('authenticate', async (request: FastifyRequest) => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw ApiError.unauthorized();
    }
    const token = header.slice(7);
    try {
      const payload = verifyToken(token, config.jwtSecret);
      if (payload.typ !== 'access' || !payload.sub) {
        throw ApiError.unauthorized();
      }
      request.user = {
        id: String(payload.sub),
        roleKey: String(payload.role),
        fullName: String(payload.name || ''),
      };
    } catch {
      throw ApiError.unauthorized();
    }
  });

  // Hook global: muat user utk semua request dengan token
  app.addHook('onRequest', async (request) => {
    const header = request.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      try {
        const payload = verifyToken(header.slice(7), config.jwtSecret);
        if (payload.typ === 'access' && payload.sub) {
          request.user = {
            id: String(payload.sub),
            roleKey: String(payload.role),
            fullName: String(payload.name || ''),
          };
        }
      } catch {
        // abaikan — route yang butuh auth akan menolak
      }
    }
  });
});
