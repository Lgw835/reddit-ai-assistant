import MiniSearch from 'minisearch';
import type { RowDataPacket } from 'mysql2';
import { getPool, isReady } from './db';
import type { PageComment, RetrievalCandidate } from './retrieval-types';
import type { RetrievalConfig } from './config';

const CJK = /[㐀-鿿぀-ヿ가-힯]/;

/** 同时适配拉丁词与中日韩（CJK 走二元组）的分词器 */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const latin = text.toLowerCase().match(/[a-z0-9_]{2,}/g) ?? [];
  out.push(...latin);
  const cjkRuns = text.match(/[㐀-鿿぀-ヿ가-힯]+/g) ?? [];
  for (const run of cjkRuns) {
    if (run.length === 1) {
      out.push(run);
      continue;
    }
    for (let i = 0; i < run.length - 1; i++) out.push(run.slice(i, i + 2));
  }
  return out;
}

const STOP = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'what', 'which', 'who', 'how', 'are', 'was',
  'you', 'your', 'have', 'has', 'about', 'from', 'they', 'their', 'there', 'them', 'but',
  '哪些', '什么', '怎么', '如何', '可以', '一下', '关于', '我们', '他们',
]);

export function keywords(query: string, limit = 8): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokenize(query)) {
    if (STOP.has(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max) + '…' : clean;
}

interface LibraryRow extends RowDataPacket {
  id: string;
  author: string | null;
  body_text: string | null;
  permalink: string | null;
  url: string | null;
  note: string | null;
  score: number | null;
  post_title: string | null;
  subreddit: string | null;
}

function rowToCandidate(r: LibraryRow, maxChars: number, rank: number): RetrievalCandidate {
  return {
    id: r.id,
    author: r.author ?? '未知用户',
    text: truncate(r.body_text ?? '', maxChars),
    url: r.url ?? (r.permalink ? 'https://www.reddit.com' + r.permalink : ''),
    postTitle: r.post_title ?? '',
    subreddit: r.subreddit ?? '',
    note: r.note ?? '',
    score: r.score ?? 0,
    origin: 'library',
    rank,
  };
}

const BASE_SELECT = `SELECT c.id, c.author, c.body_text, c.permalink, c.url, c.note, c.score,
       p.title AS post_title, p.subreddit
FROM comments c LEFT JOIN posts p ON p.id = c.post_id`;

/** 在收藏库（MySQL）中检索：FULLTEXT 优先，再用 LIKE 兜底（覆盖中文与短词） */
export async function searchLibrary(
  query: string,
  limit: number,
  maxChars: number,
): Promise<RetrievalCandidate[]> {
  if (!isReady()) return [];
  const pool = getPool();
  const picked = new Map<string, RetrievalCandidate>();

  if (!CJK.test(query)) {
    try {
      const [rows] = await pool.query<LibraryRow[]>(
        BASE_SELECT +
          ` WHERE MATCH(c.body_text) AGAINST (? IN NATURAL LANGUAGE MODE)
            ORDER BY MATCH(c.body_text) AGAINST (? IN NATURAL LANGUAGE MODE) DESC
            LIMIT ?`,
        [query, query, limit],
      );
      rows.forEach((r, i) => picked.set(r.id, rowToCandidate(r, maxChars, i)));
    } catch {
      /* 全文索引不可用时忽略，交给 LIKE 兜底 */
    }
  }

  if (picked.size < limit) {
    const kws = keywords(query, 6);
    if (kws.length) {
      const where = kws
        .map(() => '(c.body_text LIKE ? OR c.note LIKE ? OR c.author LIKE ?)')
        .join(' OR ');
      const params: unknown[] = [];
      for (const k of kws) params.push('%' + k + '%', '%' + k + '%', '%' + k + '%');
      params.push(limit * 2);
      const [rows] = await pool.query<LibraryRow[]>(
        BASE_SELECT + ` WHERE ${where} ORDER BY c.saved_at DESC LIMIT ?`,
        params,
      );
      for (const r of rows) {
        if (picked.size >= limit) break;
        if (!picked.has(r.id)) picked.set(r.id, rowToCandidate(r, maxChars, picked.size));
      }
    }
  }

  return [...picked.values()].slice(0, limit);
}

/** 取最近收藏，用于没有明确关键词时的兜底上下文 */
export async function recentLibrary(limit: number, maxChars: number): Promise<RetrievalCandidate[]> {
  if (!isReady()) return [];
  const [rows] = await getPool().query<LibraryRow[]>(
    BASE_SELECT + ' ORDER BY c.saved_at DESC LIMIT ?',
    [limit],
  );
  return rows.map((r, i) => rowToCandidate(r, maxChars, i));
}

/** 在当前页面采集到的评论中做 BM25 精选 */
export function searchPage(
  query: string,
  comments: PageComment[],
  cfg: RetrievalConfig,
  postTitle: string,
  subreddit: string,
): RetrievalCandidate[] {
  const usable = comments.filter((c) => c.id && (c.bodyText ?? '').trim().length > 0);

  const toCandidate = (c: PageComment, rank: number): RetrievalCandidate => ({
    id: c.id,
    author: c.author ?? '未知用户',
    text: truncate(c.bodyText ?? '', cfg.maxCommentChars),
    url: c.permalink ? 'https://www.reddit.com' + c.permalink : '',
    postTitle,
    subreddit,
    note: '',
    score: c.score ?? 0,
    origin: 'page',
    rank,
  });

  if (usable.length <= cfg.pageFullThreshold) {
    return usable.map(toCandidate);
  }

  const mini = new MiniSearch<PageComment & { bodyText: string; author: string }>({
    fields: ['bodyText', 'author'],
    storeFields: ['id'],
    tokenize,
    processTerm: (term) => term.toLowerCase(),
    searchOptions: { boost: { bodyText: 2 }, fuzzy: 0.15, prefix: true },
  });
  mini.addAll(
    usable.map((c) => ({ ...c, bodyText: c.bodyText ?? '', author: c.author ?? '' })),
  );

  const hits = mini.search(query).slice(0, cfg.pageTopK);
  const byId = new Map(usable.map((c) => [c.id, c]));
  const out: RetrievalCandidate[] = [];
  hits.forEach((h) => {
    const c = byId.get(String(h.id));
    if (c) out.push(toCandidate(c, out.length));
  });

  // 命中太少时补上高赞评论，避免上下文空洞
  if (out.length < 10) {
    const have = new Set(out.map((c) => c.id));
    const filler = [...usable]
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .filter((c) => !have.has(c.id))
      .slice(0, 10 - out.length);
    filler.forEach((c) => out.push(toCandidate(c, out.length)));
  }
  return out;
}

export const SYSTEM_PROMPT = [
  '你是 Reddit 评论检索助手。用户给出一个需求，你要在「候选评论」里找出真正相关的评论并如实回答。',
  '',
  '## 引用格式（最重要）',
  '- 引用标记只有一种写法：[[cite:ID]]，例如 [[cite:t1_er1eg7q]]。',
  '- ID 必须逐字复制候选评论中 “ID:” 后面那串以 t1_ 开头的字符串。',
  '- 严禁把作者名、序号、链接、帖子标题写进 [[cite:...]]。',
  '  错误示例：[[cite:Edith_avian_f]]、[[cite:3]]、[[cite:u/someone]]',
  '  正确示例：[[cite:t1_er1koaq]]',
  '- 引用标记放在句子末尾（句号之前），不要插在句子中间或词语中间，也不要单独成行。',
  '- 每条被你提及的评论都要有引用标记；一个要点只对应一条评论，多条评论支持同一结论就分别写成多行。',
  '',
  '## 内容要求',
  '1. 只能使用候选评论里的信息。候选里没有的事实、人名、观点一律不准出现。',
  '2. 每个要点必须包含被引评论的原文片段：用引号摘录原文（保持原语言，10-30 字），再用中文说明。',
  '   格式示例：u/name 认为拉花只是点缀：“Latte art is a garnish - not necessary”[[cite:t1_xxx]]',
  '3. 摘录必须与原文逐字一致，不得改写、拼接或翻译后当成原文。',
  '4. 只回答与需求直接相关的评论；无关的候选不要罗列。',
  '5. 分不清、证据不足、只是猜测时，明说“候选评论里没有明确说明”，不要替评论者补充理由。',
  '6. 候选里完全没有相关内容时，直接说没找到，并建议用户换个说法、点「展开全部评论」或先收藏更多内容。',
  '',
  '## 输出结构',
  '- 用中文，先一句话结论，再分点给依据，每点一行。',
  '- 评论之间存在分歧时，分别说明各方立场并各自附引用。',
  '',
  '输出前自查一遍：每个 [[cite:...]] 里的 ID，是否都能在候选列表的 “ID:” 字段中逐字找到。',
].join('\n');

export function buildContextBlock(candidates: RetrievalCandidate[]): string {
  if (!candidates.length) return '（没有候选评论）';
  return candidates
    .map((c, i) => {
      const meta = [
        `来源: ${c.origin === 'page' ? '当前页面' : '收藏库'}`,
      ];
      if (c.subreddit) meta.push(c.subreddit);
      if (c.postTitle) meta.push(`帖子《${truncate(c.postTitle, 80)}》`);
      if (c.score) meta.push(`赞 ${c.score}`);
      const note = c.note ? `\n我的备注: ${truncate(c.note, 200)}` : '';
      return [
        `### 候选 ${i + 1}`,
        `ID: ${c.id}`,
        `作者: u/${c.author}（作者名不是 ID，不能写进 cite）`,
        meta.join(' | '),
        `原文:`,
        c.text,
        note,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');
}

export interface CitationResolution {
  /** 规范化后真正被引用的评论 */
  cited: RetrievalCandidate[];
  /** 模型写错的标记 -> 实际评论 ID */
  repairs: Record<string, string>;
  /** 完全无法对应到候选的标记 */
  unresolved: string[];
}

const CITE_PATTERN = /\[\[cite:\s*([^\]\s][^\]]{0,80}?)\s*\]\]/g;

function normKey(s: string): string {
  return s.trim().toLowerCase().replace(/^u\//, '').replace(/[.,，。；;：:]+$/, '');
}

/**
 * 校验并修复模型写出的引用标记。
 * 实测模型常把作者名或序号当成 ID，这里统一纠正，避免前端点了没反应。
 */
export function resolveCitations(
  answer: string,
  candidates: RetrievalCandidate[],
): CitationResolution {
  const cited = new Map<string, RetrievalCandidate>();
  const repairs: Record<string, string> = {};
  const unresolved: string[] = [];

  CITE_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CITE_PATTERN.exec(answer))) {
    const raw = m[1];
    const key = normKey(raw);
    if (!key) continue;

    let hit = candidates.find((c) => c.id.toLowerCase() === key);
    if (!hit) {
      hit = candidates.find((c) => c.id.toLowerCase().replace(/^t\d_/, '') === key.replace(/^t\d_/, ''));
    }
    if (!hit) {
      const sameAuthor = candidates.filter((c) => c.author.toLowerCase() === key);
      if (sameAuthor.length === 1) hit = sameAuthor[0];
      else if (sameAuthor.length > 1) hit = sameAuthor[0];
    }
    if (!hit) {
      const idx = Number(key.replace(/^[[(]|[\])]$/g, ''));
      if (Number.isInteger(idx) && idx >= 1 && idx <= candidates.length) hit = candidates[idx - 1];
    }

    if (!hit) {
      if (!unresolved.includes(raw)) unresolved.push(raw);
      continue;
    }
    if (hit.id !== raw) repairs[raw] = hit.id;
    cited.set(hit.id, hit);
  }

  return { cited: [...cited.values()], repairs, unresolved };
}

/** 把答案里写错的引用标记替换成正确的 ID，存库与回看时都用修正后的文本 */
export function applyRepairs(answer: string, repairs: Record<string, string>): string {
  if (!Object.keys(repairs).length) return answer;
  return answer.replace(CITE_PATTERN, (full, raw: string) => {
    const fixed = repairs[raw];
    return fixed ? `[[cite:${fixed}]]` : full;
  });
}
