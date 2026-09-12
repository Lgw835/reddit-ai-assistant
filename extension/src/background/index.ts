import { getEndpoint, DEFAULT_BRIDGE, type RuntimeMessage } from '../shared/messages';

const MENU_SAVE_SELECTION = 'rc-save-selection';
const MENU_SAVE_COMMENT = 'rc-save-comment';
const MENU_OPEN_PANEL = 'rc-open-panel';

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_SAVE_SELECTION,
      title: '收藏选中内容到 Reddit 库',
      contexts: ['selection'],
      documentUrlPatterns: ['https://*.reddit.com/*'],
    });
    chrome.contextMenus.create({
      id: MENU_SAVE_COMMENT,
      title: '收藏这条评论',
      contexts: ['page', 'link'],
      documentUrlPatterns: ['https://*.reddit.com/*'],
    });
    chrome.contextMenus.create({
      id: MENU_OPEN_PANEL,
      title: '打开 Reddit 助手',
      contexts: ['all'],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === MENU_SAVE_SELECTION) {
    chrome.tabs
      .sendMessage(tab.id, { type: 'CAPTURE_SELECTION', selectionText: info.selectionText ?? '' })
      .catch(() => {});
  } else if (info.menuItemId === MENU_SAVE_COMMENT) {
    chrome.tabs.sendMessage(tab.id, { type: 'SAVE_FOCUSED_COMMENT' }).catch(() => {});
  } else if (info.menuItemId === MENU_OPEN_PANEL) {
    openPanel(tab.windowId);
  }
});

chrome.action.onClicked.addListener((tab) => {
  openPanel(tab.windowId);
});

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (command === 'open-panel') {
    openPanel(tab?.windowId);
  } else if (command === 'save-focused-comment' && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'SAVE_FOCUSED_COMMENT' }).catch(() => {});
  }
});

function openPanel(windowId?: number): void {
  if (windowId === undefined) return;
  chrome.sidePanel.open({ windowId }).catch(() => {});
}

/**
 * 内容脚本无法直接访问本地回环地址（私有网络访问限制），
 * 而且跨域请求受页面限制，所以所有桥接请求统一由 service worker 代发。
 */
chrome.runtime.onMessage.addListener((msg: RuntimeMessage, _sender, sendResponse) => {
  if (msg?.type === 'BRIDGE_REQUEST') {
    void (async () => {
      try {
        const ep = await getEndpoint();
        const base = ep.base || DEFAULT_BRIDGE;
        const headers: Record<string, string> = { 'content-type': 'application/json' };
        if (ep.token) headers['x-rc-token'] = ep.token;
        const res = await fetch(base + msg.path, {
          method: msg.method ?? 'GET',
          headers,
          body: msg.body === undefined ? undefined : JSON.stringify(msg.body),
        });
        const text = await res.text();
        let data: unknown = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = text;
        }
        if (!res.ok) {
          const err =
            data && typeof data === 'object' && 'error' in data
              ? String((data as { error: unknown }).error)
              : 'HTTP ' + res.status;
          sendResponse({ ok: false, error: err, status: res.status });
          return;
        }
        sendResponse({ ok: true, data });
      } catch (err) {
        sendResponse({
          ok: false,
          error: '连不上服务，请在侧边栏「设置」里检查服务地址（本地需先运行 npm run server）。',
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return true;
  }

  if (msg?.type === 'OPEN_PANEL') {
    void (async () => {
      try {
        const w = await chrome.windows.getCurrent();
        if (w.id === undefined) throw new Error('no window');
        await chrome.sidePanel.open({ windowId: w.id });
        sendResponse({ ok: true });
      } catch {
        // Chrome 要求 sidePanel.open 由用户手势触发，页面内按钮可能被拒绝
        sendResponse({ ok: false, error: '请点击浏览器工具栏上的扩展图标，或按 Alt+R 打开侧边栏' });
      }
    })();
    return true;
  }

  if (msg?.type === 'LIBRARY_CHANGED') {
    // 广播给侧边栏刷新收藏库（侧边栏未打开时会抛错，忽略即可）
    chrome.runtime.sendMessage({ type: 'LIBRARY_CHANGED_BROADCAST' }).catch(() => {});
    sendResponse({ ok: true });
    return true;
  }

  return undefined;
});
