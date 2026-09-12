import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { autoConnect, dbStatus, isReady } from './db';
import { loadConfig, isServerless } from './config';
import { authRequired, registerAuth, isPublicDeploy } from './auth';
import { dbRoutes, syncSettingsToDb, hydrateSettingsFromDb } from './routes/db';
import { settingsRoutes } from './routes/settings';
import { postRoutes } from './routes/posts';
import { commentRoutes } from './routes/comments';
import { chatRoutes } from './routes/chat';

export const VERSION = '0.2.0';

export async function buildApp(log = true): Promise<FastifyInstance> {
  const app = Fastify({
    logger: log ? { level: process.env.LOG_LEVEL ?? 'info' } : false,
    bodyLimit: 32 * 1024 * 1024, // 长帖一次性采集的评论体积可能较大
    trustProxy: true,
  });

  await app.register(cors, {
    // 浏览器扩展的来源是 chrome-extension://<id>，这里直接回显来源
    origin: true,
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization', 'x-rc-token'],
  });

  registerAuth(app);

  // 插件用它来验证域名是否可用：不需要令牌，但会说明是否需要令牌
  app.get('/api/health', async () => {
    const cfg = await loadConfig();
    return {
      ok: true,
      version: VERSION,
      mode: isServerless() ? 'serverless' : 'local',
      authRequired: authRequired(),
      publicDeploy: isPublicDeploy(),
      db: dbStatus(),
      llmConfigured: Boolean(cfg.llm.baseUrl && cfg.llm.model),
    };
  });

  await app.register(dbRoutes);
  await app.register(settingsRoutes);
  await app.register(postRoutes);
  await app.register(commentRoutes);
  await app.register(chatRoutes);

  await autoConnect((msg) => app.log.info(msg));
  if (isReady()) {
    // 先把表里存的配置读回来（云端唯一的持久化位置），再把有效配置写回去做首次播种
    await hydrateSettingsFromDb().catch(() => false);
    await syncSettingsToDb().catch(() => {});
  }

  return app;
}
