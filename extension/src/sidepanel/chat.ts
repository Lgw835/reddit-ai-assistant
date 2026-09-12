import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { bridgeStream, bridgeFetch } from '../shared/bridge';
import { CITE_RE, resolveCitation } from '../shared/citations';
import type { Citation, PageContext, RetrievalScope } from '../shared/types';
import { getPageContext, getPageInfo, openAndHighlight, sendToActiveTab } from './tabs';
import { confirmDialog, toast } from './dialog.js';

let sessionId: string | undefined;
let history: { role: 'user' | 'assistant'; content: string }[] = [];
let streaming = false;
let cachedContext: PageContext | null = null;

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

function messagesBox(): HTMLDivElement {
  return $('#messages');
}

function scrollToBottom(): void {
  const box = messagesBox();
  box.scrollTop = box.scrollHeight;
}

export function addSystemLine(text: string): void {
  messagesBox().appendChild(el('div', 'msg msg--system', text));
  scrollToBottom();
}

function addUserMessage(text: string): void {
  messagesBox().appendChild(el('div', 'msg msg--user', text));
  scrollToBottom();
}

function flash(node: HTMLElement, text: string): void {
  const tip = el('div', 'cite-tip', text);
  node.appendChild(tip);
  setTimeout(() => tip.remove(), 4000);
}

/** 跳转到被引用的评论：先在当前页定位，失败再开新标签页 */
async function jumpToCitation(c: Citation, chip: HTMLElement): Promise<void> {
  const res = await sendToActiveTab<{ ok: boolean }>({
    type: 'HIGHLIGHT_COMMENT',
    commentId: c.id,
    author: c.author,
    excerpt: c.excerpt,
  });
  if (res?.ok) return;

  const url = c.url && /^https?:\/\//.test(c.url) ? c.url : null;
  if (url) {
    await openAndHighlight(url, c.id);
    return;
  }
  flash(chip.parentElement ?? chip, '这条评论没有可用的定位链接，无法跳转');
}

/**
 * 生成可点击的引用芯片。
 * 模型有时会把作者名或序号写成 ID，这里做兜底解析，解析不到也给出明确提示，
 * 而不是点了没反应。
 */
function makeCiteChip(raw: string, candidates: Citation[]): HTMLElement {
  const c = resolveCitation(raw, candidates);
  const btn = el('button', c ? 'cite' : 'cite cite--unknown');
  btn.type = 'button';
  btn.append(document.createTextNode('u/' + (c?.author ?? raw)));
  btn.appendChild(el('span', 'cite__origin', c ? (c.origin === 'library' ? '库' : '页') : '?'));
  btn.title = c
    ? c.excerpt + '\n\n点击跳转到这条评论'
    : '模型给出的引用标记「' + raw + '」不在候选评论里，无法定位';

  btn.addEventListener('click', () => {
    if (c) void jumpToCitation(c, btn);
    else flash(btn.parentElement ?? btn, '这个引用标记不在候选评论里，无法定位');
  });
  return btn;
}

function replaceCitations(root: HTMLElement, candidates: Citation[]): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.nodeValue && node.nodeValue.includes('[[cite:')) targets.push(node);
  }
  for (const node of targets) {
    const text = node.nodeValue ?? '';
    const frag = document.createDocumentFragment();
    let last = 0;
    CITE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CITE_RE.exec(text))) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      frag.appendChild(makeCiteChip(m[1], candidates));
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode?.replaceChild(frag, node);
  }
}

function renderMarkdown(
  target: HTMLElement,
  text: string,
  partial: boolean,
  candidates: Citation[],
): void {
  // 流式过程中隐藏还没写完的引用标记，避免闪烁
  const cleaned = partial ? text.replace(/\[\[?c?i?t?e?:?[^\]]*$/, '') : text;
  target.innerHTML = DOMPurify.sanitize(marked.parse(cleaned, { async: false }) as string);
  replaceCitations(target, candidates);
}

function renderSources(target: HTMLElement, citations: Citation[]): void {
  if (!citations.length) return;
  const box = el('div', 'sources');
  box.appendChild(el('div', 'sources__title', '引用来源（点击跳转）'));
  for (const c of citations) {
    const item = el('button', 'sources__item');
    item.type = 'button';
    item.appendChild(el('b', undefined, 'u/' + c.author));
    item.appendChild(
      document.createTextNode(
        '　' + (c.origin === 'library' ? '收藏库' : '当前页') + '　' + c.excerpt,
      ),
    );
    item.addEventListener('click', () => void jumpToCitation(c, item));
    box.appendChild(item);
  }
  target.appendChild(box);
}

export async function refreshContextBar(): Promise<void> {
  const info = await getPageInfo();
  const bar = $('#page-info');
  const canUse = info.ok && info.isPostPage;
  if (!info.ok) {
    bar.textContent = info.error ?? '无法读取当前页面';
  } else if (!info.isPostPage) {
    bar.textContent = '当前不是帖子详情页，可只检索收藏库';
  } else {
    bar.textContent =
      (info.subreddit ? info.subreddit + '　' : '') +
      '已加载 ' +
      (info.commentCount ?? 0) +
      ' 条评论' +
      (info.postTitle ? '　《' + info.postTitle.slice(0, 28) + '》' : '');
  }
  ($('#btn-expand') as HTMLButtonElement).disabled = !canUse;
  ($('#btn-bulk') as HTMLButtonElement).disabled = !canUse;
  cachedContext = null;
}

async function ensureContext(scope: RetrievalScope): Promise<PageContext | null> {
  if (scope === 'library') return null;
  if (cachedContext) return cachedContext;
  cachedContext = await getPageContext();
  return cachedContext;
}

function stripForWire(c: PageContext['comments'][number]) {
  return {
    id: c.id,
    postId: c.postId,
    parentId: c.parentId,
    author: c.author,
    bodyText: c.bodyText,
    permalink: c.permalink,
    depth: c.depth,
    score: c.score,
    createdUtc: c.createdUtc,
  };
}

async function send(question: string): Promise<void> {
  if (streaming) return;
  const scope = ($('#scope') as HTMLSelectElement).value as RetrievalScope;
  const hint = $('#chat-hint');
  const sendBtn = $('#btn-send') as HTMLButtonElement;

  addUserMessage(question);
  history.push({ role: 'user', content: question });

  const wrap = el('div', 'msg msg--assistant');
  const body = el('div', 'msg__body typing');
  wrap.appendChild(body);
  messagesBox().appendChild(wrap);
  scrollToBottom();

  streaming = true;
  sendBtn.disabled = true;
  hint.textContent = '正在检索…';

  const ctx = await ensureContext(scope);
  if (ctx) hint.textContent = '已取当前页 ' + ctx.comments.length + ' 条评论，正在生成…';

  // 每轮对话保留自己的候选列表，这样翻回旧消息点引用依然能跳转
  let candidates: Citation[] = [];
  let answer = '';
  let failed = false;

  await bridgeStream(
    '/api/chat',
    {
      sessionId,
      message: question,
      scope,
      history: history.slice(-7, -1),
      page: ctx
        ? { url: ctx.url, post: ctx.post, comments: ctx.comments.map(stripForWire) }
        : undefined,
    },
    {
      onMeta: (data) => {
        sessionId = data.sessionId ?? sessionId;
        candidates = (data.candidates ?? []) as Citation[];
        hint.textContent = '候选评论 ' + candidates.length + ' 条，正在生成…';
      },
      onDelta: (text) => {
        answer += text;
        renderMarkdown(body, answer, true, candidates);
        scrollToBottom();
      },
      onDone: (data) => {
        renderMarkdown(body, answer, false, candidates);
        body.classList.remove('typing');
        renderSources(wrap, (data.citations ?? []) as Citation[]);
        if (data.unresolved?.length) {
          wrap.appendChild(
            el(
              'div',
              'cite-tip',
              '有 ' + data.unresolved.length + ' 个引用标记无法对应到具体评论：' +
                data.unresolved.join('、'),
            ),
          );
        }
        history.push({ role: 'assistant', content: answer });
        scrollToBottom();
      },
      onError: (message) => {
        failed = true;
        body.classList.remove('typing');
        wrap.classList.add('msg--error');
        body.textContent = message;
      },
    },
  );

  if (!failed && !answer) {
    body.classList.remove('typing');
    body.textContent = '模型没有返回内容，请检查设置页里的模型名与接口是否正确。';
    wrap.classList.add('msg--error');
  }

  streaming = false;
  sendBtn.disabled = false;
  hint.textContent = '';
}

async function loadHistoryList(): Promise<void> {
  const box = messagesBox();
  box.innerHTML = '';
  addSystemLine('正在读取历史对话…');
  try {
    const res = await bridgeFetch<{ ok: boolean; items: any[] }>('/api/chat/sessions');
    box.innerHTML = '';
    if (!res.items?.length) {
      addSystemLine('还没有历史对话');
      return;
    }
    addSystemLine('点击标题恢复对话，点「删除」移除该条记录');

    const clearAll = el('button', 'mini', '清空全部对话记录');
    clearAll.type = 'button';
    clearAll.addEventListener('click', async () => {
      if (!(await confirmDialog('删除全部 ' + res.items.length + ' 条对话记录？此操作不可撤销。', { okText: '全部删除', danger: true }))) return;
      try {
        await bridgeFetch('/api/chat/sessions', { method: 'DELETE' });
        toast('已清空对话记录');
        await loadHistoryList();
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), 'err');
      }
    });
    box.appendChild(clearAll);

    for (const s of res.items) {
      const row = el('div', 'history__row');

      const item = el('button', 'sources__item history__open');
      item.type = 'button';
      item.textContent =
        (s.title ?? '(无标题)') + '　·　' + (s.msg_count ?? 0) + ' 条　' + (s.updated_at ?? '');
      item.addEventListener('click', () => void restoreSession(s.id, s.title));
      row.appendChild(item);

      const del = el('button', 'mini history__del', '删除');
      del.type = 'button';
      del.title = '删除这条对话记录';
      del.addEventListener('click', async () => {
        if (!(await confirmDialog('删除这条对话记录？ ' + (s.title ?? ''), { okText: '删除', danger: true }))) return;
        try {
          await bridgeFetch('/api/chat/sessions/' + encodeURIComponent(s.id), { method: 'DELETE' });
          if (sessionId === s.id) sessionId = undefined;
          toast('已删除');
          await loadHistoryList();
        } catch (err) {
          toast(err instanceof Error ? err.message : String(err), 'err');
        }
      });
      row.appendChild(del);

      box.appendChild(row);
    }
  } catch (err) {
    box.innerHTML = '';
    addSystemLine(err instanceof Error ? err.message : String(err));
  }
}

async function restoreSession(id: string, title: string): Promise<void> {
  const res = await bridgeFetch<{ ok: boolean; items: any[] }>(
    '/api/chat/sessions/' + encodeURIComponent(id),
  );
  sessionId = id;
  history = [];
  const box = messagesBox();
  box.innerHTML = '';
  addSystemLine('已恢复对话：' + (title ?? id));
  for (const m of res.items ?? []) {
    if (m.role === 'user') {
      addUserMessage(m.content);
      history.push({ role: 'user', content: m.content });
    } else {
      const wrap = el('div', 'msg msg--assistant');
      const body = el('div', 'msg__body');
      wrap.appendChild(body);
      const cits: Citation[] =
        typeof m.citations === 'string' ? JSON.parse(m.citations) : (m.citations ?? []);
      renderMarkdown(body, m.content ?? '', false, cits);
      renderSources(wrap, cits);
      box.appendChild(wrap);
      history.push({ role: 'assistant', content: m.content });
    }
  }
  scrollToBottom();
}

export function initChat(): void {
  const form = $('#composer') as HTMLFormElement;
  const input = $('#input') as HTMLTextAreaElement;

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const text = input.value.trim();
    if (!text || streaming) return;
    input.value = '';
    void send(text);
  });

  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
      ev.preventDefault();
      form.requestSubmit();
    }
  });

  $('#btn-refresh-ctx').addEventListener('click', () => void refreshContextBar());

  $('#btn-new-chat').addEventListener('click', () => {
    sessionId = undefined;
    history = [];
    messagesBox().innerHTML = '';
    addSystemLine('新的对话。可以先「展开全部」再提问，检索范围更完整。');
  });

  $('#btn-history').addEventListener('click', () => void loadHistoryList());

  $('#btn-expand').addEventListener('click', async () => {
    const btn = $('#btn-expand') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = '展开中…';
    const res = await sendToActiveTab<{ ok: boolean; before: number; after: number }>({
      type: 'EXPAND_ALL',
    });
    btn.textContent = '展开全部';
    btn.disabled = false;
    if (res?.ok) addSystemLine('已展开评论：' + res.before + ' → ' + res.after + ' 条');
    else addSystemLine('展开失败：当前页面不可用');
    void refreshContextBar();
  });

  $('#btn-bulk').addEventListener('click', async () => {
    const btn = $('#btn-bulk') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = '保存中…';
    const res = await sendToActiveTab<{
      ok: boolean;
      savedIds?: string[];
      total?: number;
      error?: string;
    }>({ type: 'SAVE_POST_BULK' });
    btn.textContent = '收藏整帖';
    btn.disabled = false;
    if (res?.ok)
      addSystemLine(
        '已把 ' + (res.savedIds?.length ?? 0) + ' 条评论存入收藏库（库内共 ' + (res.total ?? '?') + ' 条）',
      );
    else addSystemLine('保存失败：' + (res?.error ?? '页面不可用'));
  });

  addSystemLine('描述你要找的内容，我会在当前页面和收藏库里定位对应评论并给出可跳转的引用。');
  void refreshContextBar();

  chrome.tabs.onActivated.addListener(() => void refreshContextBar());
  chrome.tabs.onUpdated.addListener((_id, info) => {
    if (info.status === 'complete') void refreshContextBar();
  });
}
