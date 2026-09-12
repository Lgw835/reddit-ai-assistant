import type { CommentRecord, PageContext, PostRecord } from '../shared/types';

const REDDIT = 'https://www.reddit.com';
const NBSP = / /g;

function attr(el: Element, name: string): string | undefined {
  const v = el.getAttribute(name);
  return v === null || v === '' ? undefined : v;
}

function num(el: Element, name: string): number | undefined {
  const v = attr(el, name);
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * 读取元素的可见文本：
 * 去掉插件自己注入的按钮，并把 HTML 缩进产生的空白整理成干净的段落。
 */
function textOf(el: Element | null | undefined): string {
  if (!el) return '';
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll('.rc-chip, .rc-toolbar, script, style').forEach((n) => n.remove());
  const lines = (clone.textContent ?? '')
    .replace(NBSP, ' ')
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, ' ').trim());
  return lines
    .filter((line, i) => line !== '' || (i > 0 && lines[i - 1] !== ''))
    .join('\n')
    .trim();
}

export function absUrl(permalink?: string): string | undefined {
  if (!permalink) return undefined;
  if (/^https?:\/\//.test(permalink)) return permalink;
  return REDDIT + (permalink.startsWith('/') ? permalink : '/' + permalink);
}

/** 评论正文容器（light DOM，可直接读取与插入按钮） */
export function commentBodyEl(el: Element): HTMLElement | null {
  const id = attr(el, 'thingid');
  if (id) {
    const byId = el.querySelector<HTMLElement>('#' + CSS.escape(id + '-comment-rtjson-content'));
    if (byId) return byId;
  }
  return el.querySelector<HTMLElement>(':scope > [slot="comment"]');
}

export function parseComment(el: Element): CommentRecord | null {
  const id = attr(el, 'thingid');
  const postId = attr(el, 'postid');
  if (!id || !postId) return null;

  const body = commentBodyEl(el);
  const bodyText = textOf(body);
  const author = attr(el, 'author') ?? '[已删除]';

  const parentId = attr(el, 'parentid') ?? null;
  let parentExcerpt: string | null = null;
  if (parentId) {
    const parentEl = document.querySelector('shreddit-comment[thingid="' + parentId + '"]');
    if (parentEl) {
      const t = textOf(commentBodyEl(parentEl));
      if (t) parentExcerpt = t.slice(0, 400);
    }
  }

  const permalink = attr(el, 'permalink');
  return {
    id,
    postId,
    parentId,
    author,
    bodyText,
    bodyHtml: body ? body.innerHTML.slice(0, 200_000) : undefined,
    permalink,
    url: absUrl(permalink),
    depth: num(el, 'depth') ?? 0,
    score: num(el, 'score') ?? 0,
    createdUtc: attr(el, 'created'),
    parentExcerpt,
  };
}

export function postElement(): Element | null {
  return (
    document.querySelector('shreddit-post[show-full-content]') ??
    document.querySelector('shreddit-post')
  );
}

export function parsePost(el?: Element | null): PostRecord | null {
  const node = el ?? postElement();
  if (!node) return null;
  const id = attr(node, 'id');
  if (!id) return null;
  const permalink = attr(node, 'permalink');
  const bodyEl = document.querySelector('#' + CSS.escape(id + '-post-rtjson-content'));
  return {
    id,
    subreddit: attr(node, 'subreddit-prefixed-name') ?? attr(node, 'subreddit-name'),
    title: attr(node, 'post-title'),
    author: attr(node, 'author'),
    permalink,
    url: absUrl(permalink),
    bodyText: textOf(bodyEl).slice(0, 100_000),
    score: num(node, 'score') ?? 0,
    numComments: num(node, 'comment-count') ?? 0,
    createdUtc: attr(node, 'created-timestamp'),
  };
}

export function allCommentElements(): Element[] {
  return [...document.querySelectorAll('shreddit-comment')];
}

export function findCommentElement(id: string): Element | null {
  return document.querySelector('shreddit-comment[thingid="' + id + '"]');
}

export function collectPageContext(): PageContext {
  const post = parsePost();
  const comments: CommentRecord[] = [];
  for (const el of allCommentElements()) {
    const parsed = parseComment(el);
    if (parsed && parsed.bodyText) comments.push(parsed);
  }
  return {
    url: location.href,
    isPostPage: Boolean(post) && /\/comments\//.test(location.pathname),
    post,
    comments,
  };
}

const MORE_TEXT =
  /(more repl|more comment|show more|view more|load more|更多回复|更多评论|查看更多|继续此话题|继续该话题|展开)/i;

/** 找出页面上所有“展开更多回复”的可点击元素 */
function moreButtons(): HTMLElement[] {
  const out = new Set<HTMLElement>();
  const candidates = document.querySelectorAll<HTMLElement>(
    'button, summary, a[role="button"], faceplate-partial[loading="action"] > button',
  );
  for (const el of candidates) {
    if (el.dataset.rcClicked === '1') continue;
    if (el.closest('shreddit-comment-tree, shreddit-comment') === null) continue;
    const id = el.id || '';
    const label = (el.getAttribute('aria-label') || '') + ' ' + (el.textContent || '');
    if (/more-comments|show-more|comment-children/i.test(id) || MORE_TEXT.test(label)) {
      out.add(el);
    }
  }
  return [...out];
}

export async function expandAll(
  maxRounds = 20,
  onProgress?: (round: number, count: number) => void,
): Promise<{ rounds: number; before: number; after: number }> {
  const before = allCommentElements().length;
  let rounds = 0;

  for (let i = 0; i < maxRounds; i++) {
    const buttons = moreButtons();
    if (!buttons.length) break;
    rounds = i + 1;
    for (const b of buttons) {
      b.dataset.rcClicked = '1';
      try {
        b.click();
      } catch {
        /* 忽略无法点击的元素 */
      }
    }
    onProgress?.(rounds, allCommentElements().length);
    await new Promise((r) => setTimeout(r, 900));
  }

  return { rounds, before, after: allCommentElements().length };
}
