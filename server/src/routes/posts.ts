import type { FastifyInstance } from 'fastify';
import { isReady } from '../db.js';
import { upsertPost, savedIdsForPost, deletePostCollection } from '../store.js';
import type { PostRecord } from '../types.js';

export async function postRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { post: PostRecord } }>('/api/posts', async (req, reply) => {
    if (!isReady()) {
      reply.code(503);
      return { ok: false, error: '数据库未连接' };
    }
    const post = req.body?.post;
    if (!post?.id) {
      reply.code(400);
      return { ok: false, error: '缺少 post.id' };
    }
    await upsertPost(post);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/posts/:id', async (req, reply) => {
    if (!isReady()) {
      reply.code(503);
      return { ok: false, error: '数据库未连接' };
    }
    const removed = await deletePostCollection(req.params.id);
    return { ok: true, removed };
  });

  app.get<{ Params: { id: string } }>('/api/posts/:id/saved', async (req) => {
    if (!isReady()) return { ok: false, savedIds: [] as string[] };
    const savedIds = await savedIdsForPost(req.params.id);
    return { ok: true, savedIds };
  });
}
