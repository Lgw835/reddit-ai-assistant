import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';

/**
 * Vercel Serverless Function 入口（Root Directory 设为 server 时使用）。
 *
 * 这里刻意不用静态 import：整个应用通过 try 里的动态 import 载入，
 * 这样连模块加载阶段的错误（语法、依赖缺失、ESM/CJS 不匹配）也能被捕获并回给调用方。
 * 否则平台只会显示一个 FUNCTION_INVOCATION_FAILED，排查时毫无线索。
 */
let appPromise: Promise<FastifyInstance> | null = null;

async function getApp(): Promise<FastifyInstance> {
  if (!appPromise) {
    appPromise = (async () => {
      const { buildApp } = await import('../src/app.js');
      const app = await buildApp(false);
      await app.ready();
      return app;
    })();
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
    appPromise = null; // 允许下次请求重试
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error && err.stack ? err.stack.split('\n').slice(0, 8) : [];
    console.error('[reddit-collector] 服务启动失败:', err);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: '服务启动失败：' + message, stack }));
  }
}
