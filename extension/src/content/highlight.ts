import { allCommentElements, commentBodyEl, findCommentElement } from './reddit-dom';
import { toast } from './capture-ui';

export interface HighlightHint {
  author?: string;
  excerpt?: string;
}

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * ID 匹配不上时的兜底：按作者 + 原文片段找回这条评论。
 * 模型偶尔会写错 ID，页面也可能因为重新加载换了节点。
 */
function findByHint(hint: HighlightHint): Element | null {
  const author = hint.author?.replace(/^u\//, '').toLowerCase();
  const needle = hint.excerpt ? normalize(hint.excerpt).slice(0, 40) : '';
  if (!author && !needle) return null;

  const all = allCommentElements();
  const byAuthor = author
    ? all.filter((el) => (el.getAttribute('author') ?? '').toLowerCase() === author)
    : all;

  if (needle) {
    const hit = byAuthor.find((el) => normalize(commentBodyEl(el)?.textContent ?? '').includes(needle));
    if (hit) return hit;
  }
  return byAuthor.length === 1 ? byAuthor[0] : null;
}

/** 滚动到指定评论并闪烁高亮；找不到返回 false */
export function highlightComment(
  commentId: string,
  hint: HighlightHint = {},
  announce = true,
): boolean {
  const el = findCommentElement(commentId) ?? findByHint(hint);
  if (!el) {
    if (announce) toast('当前页面没有这条评论，可能需要先展开或它属于别的帖子', 'error');
    return false;
  }

  // 评论被折叠时先展开
  let node: Element | null = el;
  while (node) {
    const details: HTMLDetailsElement | null = node.closest('details');
    if (!details) break;
    if (!details.open) details.open = true;
    node = details.parentElement;
  }

  const target = (commentBodyEl(el) as HTMLElement | null) ?? (el as HTMLElement);
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.classList.remove('rc-flash');
  void target.offsetWidth; // 重新触发动画
  target.classList.add('rc-flash');
  window.setTimeout(() => target.classList.remove('rc-flash'), 3200);
  return true;
}

/** 处理 ?rc_highlight=t1_xxx —— 从别的页面点引用跳转过来时自动定位 */
export function handleHighlightParam(): void {
  const id = new URL(location.href).searchParams.get('rc_highlight');
  if (!id) return;

  let tries = 0;
  const attempt = () => {
    tries += 1;
    if (highlightComment(id, {}, false)) {
      const url = new URL(location.href);
      url.searchParams.delete('rc_highlight');
      history.replaceState(null, '', url.toString());
      return;
    }
    if (tries < 12) window.setTimeout(attempt, 600);
    else toast('没能在页面上找到这条评论，可能已被删除或需要展开更多回复', 'error');
  };
  window.setTimeout(attempt, 700);
}
