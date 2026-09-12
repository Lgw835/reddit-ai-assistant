import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../server/src/app';

/**
 * 仓库根目录的 Vercel 入口。
 *
 * 与 server/api/index.ts 等价，多一份是为了让 Root Directory 无论留空还是设成
 * server 都能部署成功 —— 忘记改这个设置是最容易踩的坑，踩了就是全站 404。
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
  const app = await getApp();
  app.server.emit('request', req, res);
}
