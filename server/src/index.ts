import { buildApp } from './app.js';
import { closePool } from './db.js';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';

const app = await buildApp();

try {
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`Reddit 收集器桥接服务已启动： http://${HOST}:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close().catch(() => {});
    await closePool();
    process.exit(0);
  });
}
