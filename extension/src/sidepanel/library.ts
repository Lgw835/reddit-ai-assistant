import { bridgeFetch, getBridgeBaseSafe } from './util';
import { confirmDialog, promptDialog, alertDialog, toast } from './dialog.js';
import type { CommentListItem } from '../shared/types';
import { openAndHighlight, sendToActiveTab } from './tabs';

const PAGE_SIZE = 30;

let offset = 0;
let total = 0;
let loading = false;

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function query(): Record<string, string> {
  return {
    q: ($('#lib-q') as HTMLInputElement).value.trim(),
    subreddit: ($('#lib-subreddit') as HTMLSelectElement).value,
    author: ($('#lib-author') as HTMLSelectElement).value,
    tag: ($('#lib-tag') as HTMLSelectElement).value,
  };
}

function jump(item: CommentListItem): void {
  void (async () => {
    const res = await sendToActiveTab<{ ok: boolean }>({
      type: 'HIGHLIGHT_COMMENT',
      commentId: item.id,
      author: item.author ?? undefined,
      excerpt: (item.bodyText ?? '').slice(0, 80),
    });
    if (res?.ok) return;
    const url = item.url ?? (item.permalink ? 'https://www.reddit.com' + item.permalink : null);
    if (url) await openAndHighlight(url, item.id);
  })();
}

function card(item: CommentListItem): HTMLElement {
  const box = el('div', 'card');

  const head = el('div', 'card__head');
  head.appendChild(el('span', 'card__author', 'u/' + (item.author ?? '未知')));
  if (item.score) head.appendChild(el('span', undefined, item.score + ' 赞'));
  if (item.subreddit) head.appendChild(el('span', undefined, item.subreddit));
  head.appendChild(el('span', undefined, (item.savedAt ?? '').slice(0, 16)));
  if (item.source === 'bulk') head.appendChild(el('span', 'chip', '整帖'));
  box.appendChild(head);

  const body = el('div', 'card__body card__body--clamp', item.bodyText ?? '');
  body.title = '点击展开/收起全文';
  body.addEventListener('click', () => body.classList.toggle('card__body--clamp'));
  box.appendChild(body);

  if (item.postTitle) box.appendChild(el('div', 'card__post', '来自《' + item.postTitle + '》'));
  if (item.note) box.appendChild(el('div', 'card__note', '备注：' + item.note));

  if (item.tags.length) {
    const tags = el('div', 'card__tags');
    item.tags.forEach((t) => tags.appendChild(el('span', 'chip', '#' + t)));
    box.appendChild(tags);
  }

  const actions = el('div', 'card__actions');

  const btnJump = el('button', 'mini', '跳转原帖');
  btnJump.type = 'button';
  btnJump.addEventListener('click', () => jump(item));
  actions.appendChild(btnJump);

  const btnNote = el('button', 'mini', item.note ? '改备注' : '加备注');
  btnNote.type = 'button';
  btnNote.addEventListener('click', async () => {
    const note = await promptDialog('给这条评论写点备注：', item.note ?? '', '写点什么…');
    if (note === null) return;
    try {
      await bridgeFetch('/api/comments/' + encodeURIComponent(item.id), {
        method: 'PATCH',
        body: JSON.stringify({ note }),
      });
      toast('备注已保存');
      await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'err');
    }
  });
  actions.appendChild(btnNote);

  const btnTag = el('button', 'mini', '标签');
  btnTag.type = 'button';
  btnTag.addEventListener('click', async () => {
    const tags = await promptDialog('用逗号分隔多个标签：', item.tags.join(','), '例如：咖啡, 手冲');
    if (tags === null) return;
    try {
      await bridgeFetch('/api/comments/' + encodeURIComponent(item.id), {
        method: 'PATCH',
        body: JSON.stringify({ tags: tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean) }),
      });
      toast('标签已保存');
      await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'err');
    }
  });
  actions.appendChild(btnTag);

  const btnDel = el('button', 'mini', '删除');
  btnDel.type = 'button';
  btnDel.addEventListener('click', async () => {
    if (!(await confirmDialog('确定从收藏库删除这条评论？', { okText: '删除', danger: true }))) return;
    try {
      await bridgeFetch('/api/comments/' + encodeURIComponent(item.id), { method: 'DELETE' });
      toast('已删除');
      await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'err');
    }
  });
  actions.appendChild(btnDel);

  if (item.postId) {
    const btnDelPost = el('button', 'mini', '删除整帖');
    btnDelPost.type = 'button';
    btnDelPost.title = '删除这个帖子下所有已收藏的评论';
    btnDelPost.addEventListener('click', async () => {
      const name = item.postTitle ? '《' + item.postTitle.slice(0, 30) + '》' : '这个帖子';
      if (!(await confirmDialog('删除 ' + name + ' 下所有已收藏的评论？此操作不可撤销。', { okText: '全部删除', danger: true }))) return;
      try {
        const res = await bridgeFetch<{ ok: boolean; removed: number }>(
          '/api/posts/' + encodeURIComponent(item.postId),
          { method: 'DELETE' },
        );
        toast('已删除 ' + (res.removed ?? 0) + ' 条');
        await reload();
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), 'err');
      }
    });
    actions.appendChild(btnDelPost);
  }

  box.appendChild(actions);
  return box;
}

async function loadFacets(): Promise<void> {
  try {
    const res = await bridgeFetch<{
      ok: boolean;
      subreddits: string[];
      authors: string[];
      tags: string[];
    }>('/api/comments/facets');
    const fill = (sel: string, values: string[], label: string) => {
      const node = $(sel) as HTMLSelectElement;
      const current = node.value;
      node.innerHTML = '';
      const first = document.createElement('option');
      first.value = '';
      first.textContent = label;
      node.appendChild(first);
      for (const v of values) {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = v;
        node.appendChild(o);
      }
      node.value = current;
    };
    fill('#lib-subreddit', res.subreddits ?? [], '全部版块');
    fill('#lib-author', res.authors ?? [], '全部作者');
    fill('#lib-tag', res.tags ?? [], '全部标签');
  } catch {
    /* 服务未连接时忽略 */
  }
}

async function fetchPage(append: boolean): Promise<void> {
  if (loading) return;
  loading = true;
  const list = $('#lib-list');
  const params = new URLSearchParams({
    ...query(),
    limit: String(PAGE_SIZE),
    offset: String(offset),
  });

  try {
    const res = await bridgeFetch<{ ok: boolean; items: CommentListItem[]; total: number }>(
      '/api/comments?' + params.toString(),
    );
    total = res.total ?? 0;
    if (!append) list.innerHTML = '';
    if (!res.items?.length && !append) {
      list.appendChild(el('div', 'msg msg--system', '收藏库里还没有内容。到 Reddit 页面点评论右上角的「＋ 收藏」试试。'));
    }
    for (const item of res.items ?? []) list.appendChild(card(item));
    offset += res.items?.length ?? 0;
    $('#lib-count').textContent = '共 ' + total + ' 条，已显示 ' + offset + ' 条';
    const more = $('#btn-lib-more') as HTMLButtonElement;
    more.hidden = offset >= total;
  } catch (err) {
    if (!append) list.innerHTML = '';
    list.appendChild(
      el('div', 'msg msg--error', err instanceof Error ? err.message : String(err)),
    );
  } finally {
    loading = false;
  }
}

export async function reload(): Promise<void> {
  offset = 0;
  await loadFacets();
  await fetchPage(false);
}

async function exportData(format: 'md' | 'json'): Promise<void> {
  const base = await getBridgeBaseSafe();
  const url = base + '/api/export' + (format === 'json' ? '?format=json' : '');
  try {
    const res = await fetch(url);
    const text = await res.text();
    if (!res.ok) throw new Error(text.slice(0, 200));
    const blob = new Blob([text], {
      type: format === 'json' ? 'application/json' : 'text/markdown',
    });
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = 'reddit-collection.' + (format === 'json' ? 'json' : 'md');
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
  } catch (err) {
    void alertDialog('导出失败：' + (err instanceof Error ? err.message : String(err)));
  }
}

export function initLibrary(): void {
  let timer: number | undefined;
  const debounced = () => {
    if (timer) clearTimeout(timer);
    timer = window.setTimeout(() => void reload(), 300);
  };

  $('#lib-q').addEventListener('input', debounced);
  for (const sel of ['#lib-subreddit', '#lib-author', '#lib-tag']) {
    $(sel).addEventListener('change', () => void reload());
  }
  $('#btn-lib-more').addEventListener('click', () => void fetchPage(true));
  $('#btn-export-md').addEventListener('click', () => void exportData('md'));
  $('#btn-export-json').addEventListener('click', () => void exportData('json'));

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'LIBRARY_CHANGED_BROADCAST') void reload();
  });
}
