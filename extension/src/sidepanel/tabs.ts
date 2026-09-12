import type { PageContext } from '../shared/types';

export interface PageInfo {
  ok: boolean;
  url?: string;
  isPostPage?: boolean;
  postTitle?: string | null;
  subreddit?: string | null;
  commentCount?: number;
  error?: string;
}

export async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/** 给当前活动标签页的内容脚本发消息；页面不是 Reddit 或脚本未注入时返回 null */
export async function sendToActiveTab<T>(message: unknown): Promise<T | null> {
  const tab = await activeTab();
  if (!tab?.id) return null;
  if (!/^https:\/\/([a-z0-9-]+\.)?reddit\.com\//i.test(tab.url ?? '')) return null;
  try {
    return (await chrome.tabs.sendMessage(tab.id, message)) as T;
  } catch {
    return null;
  }
}

export async function getPageInfo(): Promise<PageInfo> {
  const res = await sendToActiveTab<PageInfo>({ type: 'PING_CONTENT' });
  if (!res) return { ok: false, error: '当前标签页不是 Reddit 页面（或需要刷新页面让插件生效）' };
  return res;
}

export async function getPageContext(): Promise<PageContext | null> {
  return sendToActiveTab<PageContext>({ type: 'GET_PAGE_CONTEXT' });
}

export async function openAndHighlight(url: string, commentId: string): Promise<void> {
  const target = new URL(url);
  target.searchParams.set('rc_highlight', commentId);
  await chrome.tabs.create({ url: target.toString() });
}
