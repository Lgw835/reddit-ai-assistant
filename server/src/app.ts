import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { autoConnect, dbStatus, isReady } from './db.js';
import { loadConfig, isServerless } from './config.js';
import { authRequired, registerAuth, isPublicDeploy } from './auth.js';
import { dbRoutes, syncSettingsToDb, hydrateSettingsFromDb } from './routes/db.js';
import { settingsRoutes } from './routes/settings.js';
import { postRoutes } from './routes/posts.js';
import { commentRoutes } from './routes/comments.js';
import { chatRoutes } from './routes/chat.js';

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

  // 客户端可能在没有请求体时也带上 JSON 的 content-type（DELETE 最常见），
  // 默认解析器会因此回 400，这里把空 body 当成空对象处理
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body: string, done) => {
      if (!body || !body.trim()) return done(null, {});
      try {
        done(null, JSON.parse(body));
      } catch (err) {
        (err as { statusCode?: number }).statusCode = 400;
        done(err as Error, undefined);
      }
    },
  );

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
