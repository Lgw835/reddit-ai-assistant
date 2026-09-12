import type { CommentRecord, PageContext, PostRecord } from './types';

export const DEFAULT_BRIDGE = 'http://127.0.0.1:8787';

/** 页面 <-> 侧边栏 <-> background 之间的消息协议 */
export type RuntimeMessage =
  | { type: 'PING_CONTENT' }
  | { type: 'GET_PAGE_CONTEXT'; includeBodies?: boolean }
  | { type: 'EXPAND_ALL' }
  | { type: 'HIGHLIGHT_COMMENT'; commentId: string; author?: string; excerpt?: string }
  | { type: 'SAVE_POST_BULK' }
  | { type: 'SAVE_FOCUSED_COMMENT' }
  | { type: 'CAPTURE_SELECTION'; selectionText: string }
  | { type: 'LIBRARY_CHANGED'; postId?: string }
  | { type: 'BRIDGE_REQUEST'; path: string; method?: string; body?: unknown }
  | { type: 'EXPAND_PROGRESS'; round: number; count: number }
  | { type: 'OPEN_PANEL' };

export interface BridgeResponse<T = unknown> {
  ok: boolean;
  status?: number;
  data?: T;
  error?: string;
}

export interface SaveResult {
  ok: boolean;
  savedIds?: string[];
  total?: number;
  error?: string;
}

export interface PageContextResult extends PageContext {}

export interface ExpandResult {
  ok: boolean;
  rounds: number;
  before: number;
  after: number;
}

export interface SavePayload {
  post?: PostRecord;
  comments: CommentRecord[];
  source?: CommentRecord['source'];
}

export interface Endpoint {
  /** 服务地址：本地 http://127.0.0.1:8787 或 Vercel 域名 */
  base: string;
  /** 公网部署时的访问令牌 */
  token: string;
  /** 是否已通过「测试连接」验证 */
  verified: boolean;
}

const EMPTY: Endpoint = { base: '', token: '', verified: false };

export async function getEndpoint(): Promise<Endpoint> {
  try {
    const res = await chrome.storage.local.get(['bridgeBase', 'bridgeToken', 'bridgeVerified']);
    return {
      base: typeof res.bridgeBase === 'string' ? res.bridgeBase : '',
      token: typeof res.bridgeToken === 'string' ? res.bridgeToken : '',
      verified: res.bridgeVerified === true,
    };
  } catch {
    return { ...EMPTY };
  }
}

export async function setEndpoint(ep: Partial<Endpoint>): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (ep.base !== undefined) patch.bridgeBase = normalizeBase(ep.base);
  if (ep.token !== undefined) patch.bridgeToken = ep.token.trim();
  if (ep.verified !== undefined) patch.bridgeVerified = ep.verified;
  await chrome.storage.local.set(patch);
}

export async function clearEndpoint(): Promise<void> {
  await chrome.storage.local.remove(['bridgeBase', 'bridgeToken', 'bridgeVerified']);
}

/** 用户可能只填了域名，这里补全协议并去掉结尾斜杠 */
export function normalizeBase(input: string): string {
  let v = input.trim().replace(/\/+$/, '');
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) {
    const isLocal = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(v);
    v = (isLocal ? 'http://' : 'https://') + v;
  }
  return v.replace(/\/+$/, '');
}

/** 仅返回地址，供只需要发请求的模块使用 */
export async function getBridgeBase(): Promise<string> {
  const ep = await getEndpoint();
  return ep.base || DEFAULT_BRIDGE;
}

export async function setBridgeBase(url: string): Promise<void> {
  await setEndpoint({ base: url });
}
