import type { CommentRecord } from '../shared/types';
import type { SavePayload, SaveResult } from '../shared/messages';
import {
  allCommentElements,
  commentBodyEl,
  parseComment,
  parsePost,
  postElement,
  collectPageContext,
  expandAll,
} from './reddit-dom';

const savedIds = new Set<string>();
let toastTimer: number | undefined;

export function toast(message: string, kind: 'info' | 'error' = 'info'): void {
  let el = document.querySelector<HTMLDivElement>('.rc-toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'rc-toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.toggle('rc-toast--error', kind === 'error');
  requestAnimationFrame(() => el?.classList.add('rc-toast--show'));
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    el?.classList.remove('rc-toast--show');
  }, 3200);
}

async function bridge<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = (await chrome.runtime.sendMessage({
    type: 'BRIDGE_REQUEST',
    path,
    method,
    body,
  })) as { ok: boolean; data?: T; error?: string };
  if (!res?.ok) throw new Error(res?.error ?? '本地服务无响应');
  return res.data as T;
}

export async function saveComments(
  comments: CommentRecord[],
  source: CommentRecord['source'] = 'manual',
): Promise<SaveResult> {
  const payload: SavePayload = {
    post: parsePost() ?? undefined,
    comments,
    source,
  };
  const res = await bridge<SaveResult>('/api/comments', 'POST', payload);
  (res.savedIds ?? []).forEach((id) => savedIds.add(id));
  refreshSavedMarks();
  chrome.runtime.sendMessage({ type: 'LIBRARY_CHANGED' }).catch(() => {});
  return res;
}

async function removeComment(id: string): Promise<void> {
  await bridge('/api/comments/' + encodeURIComponent(id), 'DELETE');
  savedIds.delete(id);
  refreshSavedMarks();
  chrome.runtime.sendMessage({ type: 'LIBRARY_CHANGED' }).catch(() => {});
}

function setChipState(chip: HTMLButtonElement, saved: boolean): void {
  chip.classList.toggle('rc-saved', saved);
  chip.textContent = saved ? '✓ 已收藏' : '＋ 收藏';
  chip.title = saved ? '再次点击可从收藏库移除' : '保存这条评论到我的收藏库';
  const anchor = chip.parentElement;
  anchor?.classList.toggle('rc-is-saved', saved);
}

export function refreshSavedMarks(): void {
  for (const el of allCommentElements()) {
    const id = el.getAttribute('thingid');
    if (!id) continue;
    const chip = el.querySelector<HTMLButtonElement>('.rc-chip');
    if (chip) setChipState(chip, savedIds.has(id));
  }
}

function attachChip(el: Element): void {
  const id = el.getAttribute('thingid');
  if (!id) return;
  const body = commentBodyEl(el);
  if (!body || body.querySelector(':scope > .rc-chip')) return;

  body.classList.add('rc-anchor');
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'rc-chip';
  setChipState(chip, savedIds.has(id));

  chip.addEventListener('click', async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const wasSaved = savedIds.has(id);
    chip.classList.add('rc-busy');
    try {
      if (wasSaved) {
        await removeComment(id);
        toast('已从收藏库移除');
      } else {
        const record = parseComment(el);
        if (!record) throw new Error('无法解析这条评论');
        const res = await saveComments([record], 'manual');
        toast('已收藏 u/' + (record.author ?? '') + '　库内共 ' + (res.total ?? '?') + ' 条');
      }
    } catch (err) {
      chip.classList.add('rc-error');
      setTimeout(() => chip.classList.remove('rc-error'), 2000);
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      chip.classList.remove('rc-busy');
      setChipState(chip, savedIds.has(id));
    }
  });

  body.appendChild(chip);
}

export function decorateAll(): void {
  for (const el of allCommentElements()) attachChip(el);
}

/** 从服务端拉取当前帖子下已收藏的评论 id，并在页面上标记 */
export async function syncSavedIds(): Promise<void> {
  const post = parsePost();
  if (!post?.id) return;
  try {
    const res = await bridge<{ ok: boolean; savedIds: string[] }>(
      '/api/posts/' + encodeURIComponent(post.id) + '/saved',
      'GET',
    );
    savedIds.clear();
    (res.savedIds ?? []).forEach((id) => savedIds.add(id));
    refreshSavedMarks();
  } catch {
    /* 服务未启动时静默，不打扰浏览 */
  }
}

export function isSaved(id: string): boolean {
  return savedIds.has(id);
}

/** 帖子顶部工具条：收藏整帖 / 展开全部 / 打开助手 */
export function mountToolbar(): void {
  const post = postElement();
  if (!post || document.querySelector('.rc-toolbar')) return;
  if (!/\/comments\//.test(location.pathname)) return;

  const bar = document.createElement('div');
  bar.className = 'rc-toolbar';

  const brand = document.createElement('span');
  brand.className = 'rc-toolbar__brand';
  brand.textContent = '◆ Reddit 收集器';
  bar.appendChild(brand);

  const status = document.createElement('span');
  status.className = 'rc-toolbar__status';

  const mkBtn = (label: string, handler: (btn: HTMLButtonElement) => Promise<void> | void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rc-btn';
    b.textContent = label;
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await handler(b);
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), 'error');
      } finally {
        b.disabled = false;
      }
    });
    bar.appendChild(b);
    return b;
  };

  mkBtn('展开全部评论', async (btn) => {
    const label = btn.textContent;
    btn.textContent = '展开中…';
    const res = await expandAll(20, (round, count) => {
      btn.textContent = '展开中… 第 ' + round + ' 轮 / ' + count + ' 条';
    });
    btn.textContent = label;
    decorateAll();
    refreshSavedMarks();
    toast('已展开：' + res.before + ' → ' + res.after + ' 条评论');
    status.textContent = '页面共 ' + res.after + ' 条评论';
  });

  mkBtn('收藏整帖评论', async (btn) => {
    const ctx = collectPageContext();
    if (!ctx.comments.length) {
      toast('当前页面没有可保存的评论', 'error');
      return;
    }
    btn.textContent = '保存中…';
    const res = await saveComments(ctx.comments, 'bulk');
    btn.textContent = '收藏整帖评论';
    toast('已保存 ' + (res.savedIds?.length ?? 0) + ' 条评论，库内共 ' + (res.total ?? '?') + ' 条');
  });

  mkBtn('打开助手', async () => {
    const res = (await chrome.runtime
      .sendMessage({ type: 'OPEN_PANEL' })
      .catch(() => null)) as { ok: boolean; error?: string } | null;
    if (!res?.ok) {
      toast(res?.error ?? '请点击工具栏扩展图标，或按 Alt+R 打开侧边栏', 'error');
    }
  });

  bar.appendChild(status);

  const host = post.parentElement ?? document.body;
  host.insertBefore(bar, post.nextSibling);
  status.textContent = '页面共 ' + allCommentElements().length + ' 条评论';
}
