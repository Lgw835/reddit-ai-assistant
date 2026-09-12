import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export const TOKEN_HEADER = 'x-rc-token';

/** 部署到公网时必须设置 ACCESS_TOKEN，否则任何人拿到域名就能读你的收藏库和用你的模型额度 */
export function accessToken(): string {
  return (process.env.ACCESS_TOKEN ?? '').trim();
}

export function authRequired(): boolean {
  return accessToken().length > 0;
}

/** 公网部署但没设 ACCESS_TOKEN 时，除健康检查外一律拒绝，避免默认裸奔 */
export function isPublicDeploy(): boolean {
  return Boolean(process.env.VERCEL || process.env.PUBLIC_DEPLOY);
}

function tokenOf(req: FastifyRequest): string {
  const header = req.headers[TOKEN_HEADER];
  if (typeof header === 'string' && header.trim()) return header.trim();
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const q = (req.query as Record<string, unknown> | undefined)?.token;
  return typeof q === 'string' ? q.trim() : '';
}

/** 除 /api/health 外的所有接口都要带访问令牌 */
export function registerAuth(app: FastifyInstance): void {
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const url = req.raw.url ?? '';
    if (req.method === 'OPTIONS') return;
    if (url.startsWith('/api/health')) return;
    if (!url.startsWith('/api/')) return;

    const expected = accessToken();

    if (!expected) {
      if (isPublicDeploy()) {
        reply.code(500).send({
          ok: false,
          error:
            '服务部署在公网但没有设置 ACCESS_TOKEN 环境变量。请在 Vercel 项目的 Environment Variables 里加上 ACCESS_TOKEN 后重新部署。',
        });
      }
      return; // 本地运行不强制
    }

    if (tokenOf(req) !== expected) {
      reply.code(401).send({ ok: false, error: '访问令牌不正确，请在插件里重新填写。' });
    }
  });
}
