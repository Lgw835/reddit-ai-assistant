import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../server/src/app.js';

/**
 * 仓库根目录的 Vercel 入口。
 *
 * 与 server/api/index.ts 等价，多一份是为了让 Root Directory 无论留空还是设成
 * server 都能部署成功 —— 忘记改这个设置是最容易踩的坑，踩了就是全站 404。
 *
 * 同一个实例会被多次复用，所以把 app 缓存在模块作用域，避免每次请求都重连数据库。
 */
let appPromise: Promise<FastifyInstance> | null = null;

async function getApp(): Promise<FastifyInstance> {
  if (!appPromise) {
    appPromise = buildApp(false).then(async (app) => {
      await app.ready();
      return app;
    });
  }
  return appPromise;
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const app = await getApp();
    app.server.emit('request', req, res);
  } catch (err) {
    // 启动失败时把原因直接回给调用方，否则平台只会显示一个
    // FUNCTION_INVOCATION_FAILED，排查时什么线索都没有
    appPromise = null; // 允许下次请求重试
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error && err.stack ? err.stack.split('\n').slice(0, 6) : [];
    console.error('[reddit-collector] 服务启动失败:', err);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: '服务启动失败：' + message, stack }));
  }
}
