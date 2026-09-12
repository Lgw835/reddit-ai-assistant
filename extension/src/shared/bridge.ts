import { getEndpoint, DEFAULT_BRIDGE } from './messages';

export class BridgeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'BridgeError';
  }
}

async function target(): Promise<{ base: string; headers: Record<string, string> }> {
  const ep = await getEndpoint();
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (ep.token) headers['x-rc-token'] = ep.token;
  return { base: ep.base || DEFAULT_BRIDGE, headers };
}

function friendly(base: string, status?: number): string {
  if (status === 401) return '访问令牌不正确，请在「设置」里重新填写并测试连接。';
  return '连不上服务（' + base + '）。本地部署请先运行 npm run server；云端部署请检查域名是否正确、是否已部署成功。';
}

/** 扩展页面（侧边栏 / background）请求桥接服务 */
export async function bridgeFetch<T>(
  path: string,
  init: RequestInit & { raw?: boolean } = {},
): Promise<T> {
  const { base, headers } = await target();
  let res: Response;
  try {
    res = await fetch(base + path, {
      ...init,
      headers: { ...headers, ...(init.headers ?? {}) },
    });
  } catch {
    throw new BridgeError(friendly(base));
  }

  const text = await res.text();
  if (init.raw) {
    if (!res.ok) throw new BridgeError(text || 'HTTP ' + res.status, res.status);
    return text as unknown as T;
  }

  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    if (!res.ok) throw new BridgeError(text.slice(0, 200), res.status);
    return text as unknown as T;
  }

  if (!res.ok) {
    const fromJson =
      json && typeof json === 'object' && 'error' in json
        ? String((json as { error: unknown }).error)
        : '';
    throw new BridgeError(fromJson || friendly(base, res.status), res.status);
  }
  return json as T;
}

export interface SseHandlers {
  onMeta?: (data: any) => void;
  onDelta?: (text: string) => void;
  onDone?: (data: any) => void;
  onError?: (message: string) => void;
}

/**
 * 读取 /api/chat 的 SSE 流。
 * Vercel 上响应可能被整体缓冲后一次性送达，这里的解析对两种情况都适用。
 */
export async function bridgeStream(
  path: string,
  body: unknown,
  handlers: SseHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const { base, headers } = await target();
  let res: Response;
  try {
    res = await fetch(base + path, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    handlers.onError?.(friendly(base));
    return;
  }

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    let msg = text.slice(0, 300);
    try {
      const j = JSON.parse(text);
      if (j?.error) msg = String(j.error);
    } catch {
      /* 非 JSON 错误体直接展示原文 */
    }
    handlers.onError?.(msg || friendly(base, res.status));
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const flush = (block: string) => {
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (!dataLines.length) return;
    let payload: any;
    try {
      payload = JSON.parse(dataLines.join('\n'));
    } catch {
      return;
    }
    if (event === 'meta') handlers.onMeta?.(payload);
    else if (event === 'delta') handlers.onDelta?.(String(payload.text ?? ''));
    else if (event === 'done') handlers.onDone?.(payload);
    else if (event === 'error') handlers.onError?.(String(payload.message ?? '未知错误'));
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      flush(buffer.slice(0, sep));
      buffer = buffer.slice(sep + 2);
    }
  }
  if (buffer.trim()) flush(buffer);
}
