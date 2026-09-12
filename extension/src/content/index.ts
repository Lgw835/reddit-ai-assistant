import type { RuntimeMessage } from '../shared/messages';
import { collectPageContext, expandAll, parseComment, parsePost } from './reddit-dom';
import { decorateAll, mountToolbar, saveComments, syncSavedIds, toast, refreshSavedMarks } from './capture-ui';
import { handleHighlightParam, highlightComment } from './highlight';

let lastHoveredComment: Element | null = null;
let rescanTimer: number | undefined;
let lastUrl = location.href;

function scheduleRescan(delay = 350): void {
  if (rescanTimer) clearTimeout(rescanTimer);
  rescanTimer = window.setTimeout(() => {
    decorateAll();
    mountToolbar();
    refreshSavedMarks();
  }, delay);
}

function watchDom(): void {
  const observer = new MutationObserver((records) => {
    let relevant = false;
    for (const r of records) {
      for (const node of r.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.tagName === 'SHREDDIT-COMMENT' || node.querySelector?.('shreddit-comment')) {
          relevant = true;
          break;
        }
      }
      if (relevant) break;
    }
    if (relevant) scheduleRescan();

    // Reddit 是单页应用，URL 变化时重新初始化
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      scheduleRescan(800);
      void syncSavedIds();
      handleHighlightParam();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

function trackHover(): void {
  document.addEventListener(
    'mouseover',
    (ev) => {
      const target = ev.target;
      if (!(target instanceof Element)) return;
      const comment = target.closest('shreddit-comment');
      if (comment) lastHoveredComment = comment;
    },
    { passive: true },
  );
}

async function saveElement(el: Element | null, note?: string): Promise<void> {
  if (!el) {
    toast('没有定位到评论，请把鼠标停在一条评论上再试', 'error');
    return;
  }
  const record = parseComment(el);
  if (!record) {
    toast('无法解析这条评论', 'error');
    return;
  }
  if (note) record.note = note;
  try {
    const res = await saveComments([record], note ? 'selection' : 'manual');
    toast('已收藏 u/' + (record.author ?? '') + '　库内共 ' + (res.total ?? '?') + ' 条');
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err), 'error');
  }
}

function handleMessage(
  msg: RuntimeMessage,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (r: unknown) => void,
): boolean | undefined {
  switch (msg?.type) {
    case 'PING_CONTENT': {
      const post = parsePost();
      sendResponse({
        ok: true,
        url: location.href,
        isPostPage: Boolean(post) && /\/comments\//.test(location.pathname),
        postTitle: post?.title ?? null,
        subreddit: post?.subreddit ?? null,
        commentCount: document.querySelectorAll('shreddit-comment').length,
      });
      return true;
    }
    case 'GET_PAGE_CONTEXT': {
      sendResponse(collectPageContext());
      return true;
    }
    case 'EXPAND_ALL': {
      void expandAll(20).then((res) => {
        decorateAll();
        refreshSavedMarks();
        sendResponse({ ok: true, ...res });
      });
      return true;
    }
    case 'HIGHLIGHT_COMMENT': {
      sendResponse({
        ok: highlightComment(msg.commentId, { author: msg.author, excerpt: msg.excerpt }),
      });
      return true;
    }
    case 'SAVE_POST_BULK': {
      const ctx = collectPageContext();
      void saveComments(ctx.comments, 'bulk')
        .then((res) => sendResponse({ ...res, ok: true }))
        .catch((err) => sendResponse({ ok: false, error: String(err?.message ?? err) }));
      return true;
    }
    case 'SAVE_FOCUSED_COMMENT': {
      void saveElement(lastHoveredComment).then(() => sendResponse({ ok: true }));
      return true;
    }
    case 'CAPTURE_SELECTION': {
      const sel = window.getSelection();
      let el: Element | null = null;
      if (sel && sel.rangeCount) {
        const node = sel.getRangeAt(0).commonAncestorContainer;
        const asEl = node instanceof Element ? node : node.parentElement;
        el = asEl?.closest('shreddit-comment') ?? null;
      }
      void saveElement(el ?? lastHoveredComment, msg.selectionText).then(() =>
        sendResponse({ ok: true }),
      );
      return true;
    }
    default:
      return undefined;
  }
}

function init(): void {
  chrome.runtime.onMessage.addListener(handleMessage);
  trackHover();
  watchDom();
  scheduleRescan(200);
  void syncSavedIds();
  handleHighlightParam();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
