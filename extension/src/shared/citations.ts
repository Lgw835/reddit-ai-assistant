import type { Citation } from './types';

/** 允许模型写出的各种引用形态：t1_xxx、裸 id、u/作者、作者名、序号 */
export const CITE_RE = /\[\[cite:\s*([^\]\s][^\]]{0,80}?)\s*\]\]/g;

export type CiteMap = Map<string, Citation>;

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/^u\//, '').replace(/[.,，。；;：:]+$/, '');
}

/**
 * 把模型写出的引用标记解析成真正的候选评论。
 * 模型经常把作者名或序号当成 ID，这里统一兜底，否则引用点了没反应。
 */
export function resolveCitation(raw: string, candidates: Citation[]): Citation | null {
  if (!candidates.length) return null;
  const key = norm(raw);
  if (!key) return null;

  // 1. 逐字命中 ID
  const byId = candidates.find((c) => c.id.toLowerCase() === key);
  if (byId) return byId;

  // 2. 少了 t1_ / t3_ 前缀
  const byBareId = candidates.find((c) => {
    const bare = c.id.toLowerCase().replace(/^t\d_/, '');
    return bare === key.replace(/^t\d_/, '');
  });
  if (byBareId) return byBareId;

  // 3. 写成了作者名（唯一匹配才算，同一作者多条时无法判断具体是哪条）
  const byAuthor = candidates.filter((c) => c.author.toLowerCase() === key);
  if (byAuthor.length === 1) return byAuthor[0];

  // 4. 写成了候选列表里的序号
  const asIndex = Number(key.replace(/^[[(]|[\])]$/g, ''));
  if (Number.isInteger(asIndex) && asIndex >= 1 && asIndex <= candidates.length) {
    return candidates[asIndex - 1];
  }

  // 5. 作者名重复时，退而取该作者赞数最高的一条，至少能跳到正确的人
  if (byAuthor.length > 1) {
    return [...byAuthor].sort((a, b) => (b.excerpt?.length ?? 0) - (a.excerpt?.length ?? 0))[0];
  }

  return null;
}
