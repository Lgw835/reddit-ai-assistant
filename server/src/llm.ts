import type { LlmConfig } from './config.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function endpoint(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}${path}`;
}

export async function testLlm(cfg: LlmConfig): Promise<{ ok: true; sample: string }> {
  if (!cfg.baseUrl || !cfg.model) throw new Error('LLM 配置不完整（需要 baseUrl 与 model）。');
  const res = await fetch(endpoint(cfg.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 8,
      stream: false,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  let sample = '';
  try {
    const json = JSON.parse(text) as { choices?: { message?: { content?: string } }[] };
    sample = json.choices?.[0]?.message?.content ?? '';
  } catch {
    sample = text.slice(0, 120);
  }
  return { ok: true, sample };
}

/** 流式调用 OpenAI 兼容的 /chat/completions，逐段吐出增量文本 */
export async function* streamChat(
  cfg: LlmConfig,
  messages: ChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  if (!cfg.baseUrl || !cfg.model) throw new Error('LLM 配置不完整（需要 baseUrl 与 model）。');

  const res = await fetch(endpoint(cfg.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: cfg.temperature ?? 0.3,
      stream: true,
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(`LLM 请求失败 HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const json = JSON.parse(payload) as {
          choices?: { delta?: { content?: string }; message?: { content?: string } }[];
        };
        const delta = json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.message?.content ?? '';
        if (delta) yield delta;
      } catch {
        /* 忽略非法分片 */
      }
    }
  }
}
