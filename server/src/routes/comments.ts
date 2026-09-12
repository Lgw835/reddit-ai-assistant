import type { FastifyInstance } from 'fastify';
import { isReady } from '../db.js';
import {
  upsertPost,
  upsertComments,
  deleteComment,
  setNote,
  setTags,
  listComments,
  facets,
  stats,
  exportAll,
} from '../store.js';
import type { CommentRecord, PostRecord } from '../types.js';
import { redditUrl } from '../util.js';

interface SaveBody {
  post?: PostRecord;
  comments: CommentRecord[];
  source?: CommentRecord['source'];
}

export async function commentRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: SaveBody }>('/api/comments', async (req, reply) => {
    if (!isReady()) {
      reply.code(503);
      return { ok: false, error: '数据库未连接，请先在设置页配置 MySQL。' };
    }
    const { post, comments, source } = req.body ?? { comments: [] };
    if (!Array.isArray(comments) || comments.length === 0) {
      reply.code(400);
      return { ok: false, error: '没有要保存的评论' };
    }
    if (post?.id) await upsertPost(post);
    const ids = await upsertComments(comments, source ?? 'manual');
    const all = await stats();
    return { ok: true, savedIds: ids, total: all.comments };
  });

  app.get<{
    Querystring: {
      q?: string;
      subreddit?: string;
      author?: string;
      tag?: string;
      postId?: string;
      limit?: string;
      offset?: string;
    };
  }>('/api/comments', async (req, reply) => {
    if (!isReady()) {
      reply.code(503);
      return { ok: false, error: '数据库未连接', items: [], total: 0 };
    }
    const { q, subreddit, author, tag, postId, limit, offset } = req.query;
    const res = await listComments({
      q,
      subreddit,
      author,
      tag,
      postId,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return { ok: true, ...res };
  });

  app.get('/api/comments/facets', async (req, reply) => {
    if (!isReady()) {
      reply.code(503);
      return { ok: false, subreddits: [], authors: [], tags: [] };
    }
    return { ok: true, ...(await facets()) };
  });

  app.delete<{ Params: { id: string } }>('/api/comments/:id', async (req, reply) => {
    if (!isReady()) {
      reply.code(503);
      return { ok: false, error: '数据库未连接' };
    }
    const removed = await deleteComment(req.params.id);
    return { ok: removed };
  });

  app.patch<{ Params: { id: string }; Body: { note?: string; tags?: string[] } }>(
    '/api/comments/:id',
    async (req, reply) => {
      if (!isReady()) {
        reply.code(503);
        return { ok: false, error: '数据库未连接' };
      }
      const { note, tags } = req.body ?? {};
      if (note !== undefined) await setNote(req.params.id, note.trim() || null);
      if (Array.isArray(tags)) await setTags(req.params.id, tags);
      return { ok: true };
    },
  );

  app.get<{ Querystring: { format?: string } }>('/api/export', async (req, reply) => {
    if (!isReady()) {
      reply.code(503);
      return { ok: false, error: '数据库未连接' };
    }
    const groups = await exportAll();
    if (req.query.format === 'json') {
      reply.header('content-type', 'application/json; charset=utf-8');
      return groups;
    }
    const lines: string[] = ['# Reddit 收藏评论导出', ''];
    for (const { post, comments } of groups) {
      const title = (post.title as string) ?? '(无标题)';
      const url = redditUrl(post.permalink as string) ?? '';
      lines.push(`## ${title}`);
      lines.push(`- 版块：${post.subreddit ?? '-'}　作者：u/${post.author ?? '-'}`);
      if (url) lines.push(`- 帖子链接：${url}`);
      lines.push('');
      for (const c of comments) {
        const curl = (c.url as string) || redditUrl(c.permalink as string) || '';
        lines.push(`### u/${c.author ?? '-'}${c.score ? `（${c.score} 赞）` : ''}`);
        lines.push('');
        lines.push(String(c.body_text ?? '').replace(/\n/g, '\n'));
        lines.push('');
        if (c.note) lines.push(`> 我的备注：${c.note}`);
        if (c.tag_names) lines.push(`> 标签：${c.tag_names}`);
        if (curl) lines.push(`> 原文：${curl}`);
        lines.push('');
      }
      lines.push('---', '');
    }
    reply.header('content-type', 'text/markdown; charset=utf-8');
    return lines.join('\n');
  });
}
