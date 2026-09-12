import type { FastifyInstance } from 'fastify';
import type { RowDataPacket } from 'mysql2';
import { getPool, isReady } from '../db.js';
import { loadConfig } from '../config.js';
import { streamChat, type ChatMessage } from '../llm.js';
import {
  SYSTEM_PROMPT,
  buildContextBlock,
  searchLibrary,
  searchPage,
  recentLibrary,
  resolveCitations,
  applyRepairs,
} from '../retrieval.js';
import type { RetrievalCandidate } from '../retrieval-types.js';
import type { PageContext } from '../types.js';
import { randomId } from '../util.js';

interface ChatBody {
  sessionId?: string;
  message: string;
  scope?: 'page' | 'page+library' | 'library';
  page?: PageContext;
  history?: { role: 'user' | 'assistant'; content: string }[];
}

function sse(res: NodeJS.WritableStream, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function ensureSession(sessionId: string | undefined, title: string, pageUrl: string) {
  const id = sessionId || randomId('chat');
  if (!isReady()) return id;
  await getPool().query(
    `INSERT INTO chat_sessions (id, title, page_url) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE page_url = VALUES(page_url), updated_at = CURRENT_TIMESTAMP`,
    [id, title.slice(0, 200), pageUrl.slice(0, 1000)],
  );
  return id;
}

async function saveMessage(
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
  citations: unknown[] | null,
): Promise<void> {
  if (!isReady()) return;
  await getPool()
    .query('INSERT INTO chat_messages (session_id, role, content, citations) VALUES (?, ?, ?, ?)', [
      sessionId,
      role,
      content,
      citations ? JSON.stringify(citations) : null,
    ])
    .catch(() => {});
}

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: ChatBody }>('/api/chat', async (req, reply) => {
    const cfg = await loadConfig();
    const body = req.body;
    const question = (body?.message ?? '').trim();

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });

    const fail = (msg: string) => {
      sse(reply.raw, 'error', { message: msg });
      reply.raw.end();
    };

    if (!question) return fail('问题不能为空');
    if (!cfg.llm.baseUrl || !cfg.llm.model) {
      return fail('尚未配置大模型接口，请到设置页填写 URL / Key / Model。');
    }

    const scope = body.scope ?? cfg.retrieval.scope;
    const page = body.page ?? { comments: [] };
    const postTitle = page.post?.title ?? '';
    const subreddit = page.post?.subreddit ?? '';

    let candidates: RetrievalCandidate[] = [];
    try {
      if (scope !== 'library' && page.comments?.length) {
        candidates = candidates.concat(
          searchPage(question, page.comments, cfg.retrieval, postTitle, subreddit),
        );
      }
      if (scope !== 'page' && isReady()) {
        const fromLib = await searchLibrary(question, cfg.retrieval.libraryTopK, cfg.retrieval.maxCommentChars);
        const lib = fromLib.length
          ? fromLib
          : await recentLibrary(Math.min(10, cfg.retrieval.libraryTopK), cfg.retrieval.maxCommentChars);
        const have = new Set(candidates.map((c) => c.id));
        candidates = candidates.concat(lib.filter((c) => !have.has(c.id)));
      }
    } catch (err) {
      return fail('检索失败：' + (err instanceof Error ? err.message : String(err)));
    }

    if (!candidates.length) {
      return fail(
        scope === 'library'
          ? '收藏库里还没有任何评论，先在 Reddit 页面收藏一些内容吧。'
          : '当前页面没有采集到评论。请确认停留在 Reddit 帖子页，必要时先点「展开全部评论」。',
      );
    }

    const sessionId = await ensureSession(body.sessionId, question, page.url ?? '');
    sse(reply.raw, 'meta', {
      sessionId,
      scope,
      candidates: candidates.map((c) => ({
        id: c.id,
        author: c.author,
        url: c.url,
        excerpt: c.text.slice(0, 160),
        origin: c.origin,
        postTitle: c.postTitle,
      })),
    });

    const contextBlock = buildContextBlock(candidates);
    const messages: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }];
    for (const h of (body.history ?? []).slice(-6)) {
      messages.push({ role: h.role, content: h.content });
    }
    const idList = candidates.map((c) => c.id).join('、');
    messages.push({
      role: 'user',
      content:
        `当前页面：${page.post?.title ? `《${page.post.title}》(${subreddit})` : page.url ?? '未知'}\n\n` +
        `## 候选评论（共 ${candidates.length} 条）\n\n${contextBlock}\n\n` +
        `## 本次可用的引用 ID（只能用这些，逐字复制）\n${idList}\n\n` +
        `## 我的需求\n${question}\n\n` +
        `请只依据上面的候选评论作答；每个要点都要带原文摘录和 [[cite:ID]] 引用标记，` +
        `ID 必须来自上面的 ID 列表，不要写作者名或序号。`,
    });

    await saveMessage(sessionId, 'user', question, null);

    let answer = '';
    const controller = new AbortController();
    reply.raw.on('close', () => controller.abort());

    try {
      for await (const delta of streamChat(cfg.llm, messages, controller.signal)) {
        answer += delta;
        sse(reply.raw, 'delta', { text: delta });
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        sse(reply.raw, 'error', {
          message: 'LLM 调用失败：' + (err instanceof Error ? err.message : String(err)),
        });
      }
      reply.raw.end();
      return;
    }

    // 模型常把作者名或序号写成 ID，这里统一校验并纠正，保证引用都能跳转
    const resolution = resolveCitations(answer, candidates);
    const finalAnswer = applyRepairs(answer, resolution.repairs);
    const citations = resolution.cited.map((c) => ({
      id: c.id,
      author: c.author,
      url: c.url,
      excerpt: c.text.slice(0, 160),
      origin: c.origin,
    }));

    await saveMessage(sessionId, 'assistant', finalAnswer, citations);
    sse(reply.raw, 'done', {
      sessionId,
      citations,
      repairs: resolution.repairs,
      unresolved: resolution.unresolved,
    });
    reply.raw.end();
  });

  app.get('/api/chat/sessions', async (req, reply) => {
    if (!isReady()) {
      reply.code(503);
      return { ok: false, items: [] };
    }
    const [rows] = await getPool().query<RowDataPacket[]>(
      `SELECT s.id, s.title, s.page_url, s.updated_at,
              (SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.id) AS msg_count
       FROM chat_sessions s ORDER BY s.updated_at DESC LIMIT 50`,
    );
    return { ok: true, items: rows };
  });

  app.get<{ Params: { id: string } }>('/api/chat/sessions/:id', async (req, reply) => {
    if (!isReady()) {
      reply.code(503);
      return { ok: false, items: [] };
    }
    const [rows] = await getPool().query<RowDataPacket[]>(
      'SELECT role, content, citations, created_at FROM chat_messages WHERE session_id = ? ORDER BY id ASC',
      [req.params.id],
    );
    return { ok: true, items: rows };
  });

  app.delete<{ Params: { id: string } }>('/api/chat/sessions/:id', async (req, reply) => {
    if (!isReady()) {
      reply.code(503);
      return { ok: false };
    }
    const pool = getPool();
    await pool.query('DELETE FROM chat_messages WHERE session_id = ?', [req.params.id]);
    await pool.query('DELETE FROM chat_sessions WHERE id = ?', [req.params.id]);
    return { ok: true };
  });
}
