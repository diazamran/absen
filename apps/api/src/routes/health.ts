import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (_request, reply) => {
    reply.send({ success: true, status: 'ok', time: new Date().toISOString() });
  });
}
