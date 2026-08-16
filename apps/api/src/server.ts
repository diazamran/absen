import { buildApp } from './app.js';
import { initRealtime } from './realtime/emitter.js';
import { config } from './config.js';

async function main() {
  const app = await buildApp();

  // ===== Realtime (Socket.IO) =====
  const io = initRealtime(app.server);
  app.decorate('io', io);

  const port = config.port;
  await app.listen({ port, host: '0.0.0.0' });

  // eslint-disable-next-line no-console
  console.log(`✅ ${config.appName} API berjalan di http://localhost:${port}`);
  // eslint-disable-next-line no-console
  console.log(`   Realtime (Socket.IO) aktif di /socket.io`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Gagal memulai server:', e);
  process.exit(1);
});
