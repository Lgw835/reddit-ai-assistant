import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { getPool, isReady } from './db.js';
import type { PostRecord, CommentRecord } from './types.js';
import { toMysqlDate, clampText, toInt, excerpt, redditUrl } from './util.js';

export async function upsertPost(post: PostRecord): Promise<void> {
  if (!post?.id) throw new Error('缺少帖子 id');
  await getPool().query(
    `INSERT INTO posts (id, subreddit, title, author, permalink, url, body_text, score, num_comments, created_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       subreddit = VALUES(subreddit),
       title = VALUES(title),
       author = VALUES(author),
       permalink = VALUES(permalink),
       url = VALUES(url),
       body_text = COALESCE(NULLIF(VALUES(body_text), ''), body_text),
       score = VALUES(score),
       num_comments = VALUES(num_comments),
       created_utc = COALESCE(VALUES(created_utc), created_utc)`,
    [
      post.id,
      clampText(post.subreddit, 128),
      clampText(post.title, 1024),
      clampText(post.author, 128),
      clampText(post.permalink, 768),
      clampText(post.url ?? redditUrl(post.permalink), 1024),
      post.bodyText ?? null,
      toInt(post.score),
      toInt(post.numComments),
      toMysqlDate(post.createdUtc),
    ],
  );
}

export async function upsertComments(
  comments: CommentRecord[],
  defaultSource: CommentRecord['source'] = 'manual',
): Promise<string[]> {
  const valid = comments.filter((c) => c?.id && c?.postId);
  if (!valid.length) return [];
  const pool = getPool();

  const rows = valid.map((c) => [
    c.id,
    c.postId,
    clampText(c.parentId, 32),
    clampText(c.author, 128),
    c.bodyText ?? null,
    c.bodyHtml ?? null,
    clampText(c.permalink, 768),
    clampText(c.url ?? redditUrl(c.permalink), 1024),
    toInt(c.depth),
    toInt(c.score),
    toMysqlDate(c.createdUtc),
    excerpt(c.parentExcerpt, 500),
    c.note ?? null,
    c.source ?? defaultSource,
  ]);

  // 批量插入；已存在的行只补齐内容与分数，不覆盖用户备注
  await pool.query(
    `INSERT INTO comments
       (id, post_id, parent_id, author, body_text, body_html, permalink, url, depth, score,
        created_utc, parent_excerpt, note, source)
     VALUES ?
     ON DUPLICATE KEY UPDATE
       body_text = VALUES(body_text),
       body_html = VALUES(body_html),
       permalink = VALUES(permalink),
       url = VALUES(url),
       depth = VALUES(depth),
       score = VALUES(score),
       parent_excerpt = COALESCE(VALUES(parent_excerpt), parent_excerpt),
       note = COALESCE(NULLIF(VALUES(note), ''), note)`,
    [rows],
  );

  return valid.map((c) => c.id);
}

export async function deleteComment(id: string): Promise<boolean> {
  const pool = getPool();
  await pool.query('DELETE FROM comment_tags WHERE comment_id = ?', [id]);
  const [res] = await pool.query<ResultSetHeader>('DELETE FROM comments WHERE id = ?', [id]);
  return res.affectedRows > 0;
}

/** 删掉一个帖子下所有已收藏的评论，以及帖子本身 */
export async function deletePostCollection(postId: string): Promise<number> {
  const pool = getPool();
  await pool.query(
    'DELETE ct FROM comment_tags ct JOIN comments c ON c.id = ct.comment_id WHERE c.post_id = ?',
    [postId],
  );
  const [res] = await pool.query<ResultSetHeader>('DELETE FROM comments WHERE post_id = ?', [postId]);
  await pool.query('DELETE FROM posts WHERE id = ?', [postId]);
  return res.affectedRows;
}

export async function setNote(id: string, note: string | null): Promise<void> {
  await getPool().query('UPDATE comments SET note = ? WHERE id = ?', [note, id]);
}

export async function setTags(commentId: string, tags: string[]): Promise<void> {
  const pool = getPool();
  const clean = [...new Set(tags.map((t) => t.trim()).filter(Boolean).slice(0, 20))];
  await pool.query('DELETE FROM comment_tags WHERE comment_id = ?', [commentId]);
  if (!clean.length) return;
  for (const name of clean) {
    await pool.query('INSERT IGNORE INTO tags (name) VALUES (?)', [name]);
  }
  const [rows] = await pool.query<(RowDataPacket & { id: number; name: string })[]>(
    'SELECT id, name FROM tags WHERE name IN (?)',
    [clean],
  );
  if (!rows.length) return;
  await pool.query('INSERT IGNORE INTO comment_tags (comment_id, tag_id) VALUES ?', [
    rows.map((r) => [commentId, r.id]),
  ]);
}

export interface ListQuery {
  q?: string;
  subreddit?: string;
  author?: string;
  tag?: string;
  postId?: string;
  limit?: number;
  offset?: number;
}

export interface CommentListItem {
  id: string;
  postId: string;
  author: string | null;
  bodyText: string | null;
  permalink: string | null;
  url: string | null;
  score: number | null;
  depth: number | null;
  note: string | null;
  source: string;
  createdUtc: string | null;
  savedAt: string;
  postTitle: string | null;
  subreddit: string | null;
  tags: string[];
}

export async function listComments(
  query: ListQuery,
): Promise<{ items: CommentListItem[]; total: number }> {
  const pool = getPool();
  const limit = Math.min(Math.max(toInt(query.limit, 50), 1), 200);
  const offset = Math.max(toInt(query.offset, 0), 0);

  const where: string[] = [];
  const params: unknown[] = [];

  if (query.q) {
    where.push('(c.body_text LIKE ? OR c.author LIKE ? OR c.note LIKE ? OR p.title LIKE ?)');
    const like = '%' + query.q + '%';
    params.push(like, like, like, like);
  }
  if (query.subreddit) {
    where.push('p.subreddit = ?');
    params.push(query.subreddit);
  }
  if (query.author) {
    where.push('c.author = ?');
    params.push(query.author);
  }
  if (query.postId) {
    where.push('c.post_id = ?');
    params.push(query.postId);
  }
  if (query.tag) {
    where.push(
      'EXISTS (SELECT 1 FROM comment_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.comment_id = c.id AND t.name = ?)',
    );
    params.push(query.tag);
  }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const [countRows] = await pool.query<(RowDataPacket & { total: number })[]>(
    `SELECT COUNT(*) AS total FROM comments c LEFT JOIN posts p ON p.id = c.post_id ${whereSql}`,
    params,
  );

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT c.id, c.post_id, c.author, c.body_text, c.permalink, c.url, c.score, c.depth,
            c.note, c.source, c.created_utc, c.saved_at,
            p.title AS post_title, p.subreddit,
            GROUP_CONCAT(t.name ORDER BY t.name SEPARATOR ',') AS tag_names
     FROM comments c
     LEFT JOIN posts p ON p.id = c.post_id
     LEFT JOIN comment_tags ct ON ct.comment_id = c.id
     LEFT JOIN tags t ON t.id = ct.tag_id
     ${whereSql}
     GROUP BY c.id
     ORDER BY c.saved_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  const items: CommentListItem[] = rows.map((r) => ({
    id: r.id as string,
    postId: r.post_id as string,
    author: (r.author as string) ?? null,
    bodyText: (r.body_text as string) ?? null,
    permalink: (r.permalink as string) ?? null,
    url: (r.url as string) ?? null,
    score: (r.score as number) ?? null,
    depth: (r.depth as number) ?? null,
    note: (r.note as string) ?? null,
    source: (r.source as string) ?? 'manual',
    createdUtc: (r.created_utc as string) ?? null,
    savedAt: r.saved_at as string,
    postTitle: (r.post_title as string) ?? null,
    subreddit: (r.subreddit as string) ?? null,
    tags: r.tag_names ? String(r.tag_names).split(',') : [],
  }));

  return { items, total: countRows[0]?.total ?? 0 };
}

export async function savedIdsForPost(postId: string): Promise<string[]> {
  if (!isReady()) return [];
  const [rows] = await getPool().query<(RowDataPacket & { id: string })[]>(
    'SELECT id FROM comments WHERE post_id = ?',
    [postId],
  );
  return rows.map((r) => r.id);
}

export async function facets(): Promise<{ subreddits: string[]; authors: string[]; tags: string[] }> {
  const pool = getPool();
  const [subs] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT p.subreddit AS v FROM posts p
     JOIN comments c ON c.post_id = p.id
     WHERE p.subreddit IS NOT NULL AND p.subreddit <> '' ORDER BY v`,
  );
  const [authors] = await pool.query<RowDataPacket[]>(
    `SELECT c.author AS v, COUNT(*) AS n FROM comments c
     WHERE c.author IS NOT NULL AND c.author <> ''
     GROUP BY c.author ORDER BY n DESC LIMIT 50`,
  );
  const [tags] = await pool.query<RowDataPacket[]>('SELECT name AS v FROM tags ORDER BY name');
  return {
    subreddits: subs.map((r) => r.v as string),
    authors: authors.map((r) => r.v as string),
    tags: tags.map((r) => r.v as string),
  };
}

export async function stats(): Promise<{ comments: number; posts: number }> {
  const pool = getPool();
  const [c] = await pool.query<(RowDataPacket & { n: number })[]>('SELECT COUNT(*) AS n FROM comments');
  const [p] = await pool.query<(RowDataPacket & { n: number })[]>('SELECT COUNT(*) AS n FROM posts');
  return { comments: c[0]?.n ?? 0, posts: p[0]?.n ?? 0 };
}

export async function exportAll(): Promise<
  { post: RowDataPacket; comments: RowDataPacket[] }[]
> {
  const pool = getPool();
  const [posts] = await pool.query<RowDataPacket[]>(
    `SELECT p.* FROM posts p WHERE EXISTS (SELECT 1 FROM comments c WHERE c.post_id = p.id)
     ORDER BY p.saved_at DESC`,
  );
  const out: { post: RowDataPacket; comments: RowDataPacket[] }[] = [];
  for (const post of posts) {
    const [comments] = await pool.query<RowDataPacket[]>(
      `SELECT c.*, GROUP_CONCAT(t.name SEPARATOR ',') AS tag_names
       FROM comments c
       LEFT JOIN comment_tags ct ON ct.comment_id = c.id
       LEFT JOIN tags t ON t.id = ct.tag_id
       WHERE c.post_id = ?
       GROUP BY c.id
       ORDER BY c.saved_at ASC`,
      [post.id],
    );
    out.push({ post, comments });
  }
  return out;
}
