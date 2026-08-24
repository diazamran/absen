import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { roleHasPermission, type PermissionKey } from '../rbac/permissions.js';
import { ApiError } from '../utils/errors.js';

declare module 'fastify' {
  interface FastifyInstance {
    requirePermission: (permission: PermissionKey) => (request: FastifyRequest) => Promise<void>;
  }
}

export const rbacPlugin = fp(async (app: FastifyInstance) => {
  app.decorate('requirePermission', (permission: PermissionKey) => {
    return async (request: FastifyRequest) => {
      await app.authenticate(request);
      const user = request.user;
      if (!user) throw ApiError.unauthorized();
      // Check all roles (primary + additional)
      const hasPermission = (user.roles || [user.roleKey]).some((r) => roleHasPermission(r, permission));
      if (!hasPermission) {
        throw ApiError.forbidden();
      }
    };
  });
});
