import { bridgeFetch, $, setStatus } from './util';
import { getEndpoint } from '../shared/messages';
import { confirmDialog } from './dialog.js';
import type { DbSettings, LlmSettings, RetrievalSettings } from '../shared/types';

interface SettingsResponse {
  db: DbSettings;
  llm: LlmSettings;
  retrieval: RetrievalSettings;
}

interface DbStatusResponse {
  connected: boolean;
  target: string | null;
  error: string | null;
  config: DbSettings;
  editable?: boolean;
  counts: { comments: number; posts: number } | null;
}

const val = (sel: string): string => ($(sel) as HTMLInputElement).value.trim();
const setVal = (sel: string, v: string | number | undefined): void => {
  ($(sel) as HTMLInputElement).value = v === undefined || v === null ? '' : String(v);
};

export async function checkBridge(): Promise<boolean> {
  const banner = $('#bridge-banner');
  try {
    const res = await bridgeFetch<{
      ok: boolean;
      mode?: string;
      db: { connected: boolean; error: string | null };
    }>('/api/health');
    if (!res.db?.connected) {
      banner.textContent =
        '服务已连上，但 MySQL 未连接' +
        (res.db?.error ? '：' + res.db.error : '') +
        (res.mode === 'serverless'
          ? '。请检查 Vercel 环境变量里的 DB_* 配置。'
          : '。请到「设置」填写数据库信息。');
      banner.classList.remove('banner--hidden');
      return false;
    }
    banner.classList.add('banner--hidden');
    return true;
  } catch (err) {
    banner.textContent =
      (err instanceof Error ? err.message : String(err)) +
      '\n在项目目录执行： npm run server';
    banner.classList.remove('banner--hidden');
    return false;
  }
}

async function loadSettings(): Promise<void> {
  const ep = await getEndpoint();
  setVal('#set-bridge', ep.base);
  try {
    const s = await bridgeFetch<SettingsResponse>('/api/settings');
    setVal('#llm-url', s.llm.baseUrl);
    setVal('#llm-key', s.llm.apiKey);
    setVal('#llm-model', s.llm.model);
    setVal('#llm-temp', s.llm.temperature);
    setVal('#r-threshold', s.retrieval.pageFullThreshold);
    setVal('#r-pagetopk', s.retrieval.pageTopK);
    setVal('#r-libtopk', s.retrieval.libraryTopK);
    setVal('#r-maxchars', s.retrieval.maxCommentChars);
    ($('#scope') as HTMLSelectElement).value = s.retrieval.scope;

    const db = await bridgeFetch<DbStatusResponse>('/api/db/status');
    setVal('#db-host', db.config.host);
    setVal('#db-port', db.config.port);
    setVal('#db-name', db.config.database);
    setVal('#db-user', db.config.user);
    setVal('#db-password', db.config.password);
    const dbInputs = ['#db-host', '#db-port', '#db-name', '#db-user', '#db-password'];
    if (db.editable === false) {
      dbInputs.forEach((sel) => (( $(sel) as HTMLInputElement).disabled = true));
      ($('#btn-db-save') as HTMLButtonElement).disabled = true;
    }
    setStatus(
      '#db-status',
      db.connected
        ? '已连接 ' + db.target + '　评论 ' + (db.counts?.comments ?? 0) + ' 条'
        : '未连接' + (db.error ? '：' + db.error : ''),
      db.connected ? 'ok' : 'err',
    );
  } catch (err) {
    setStatus('#db-status', err instanceof Error ? err.message : String(err), 'err');
  }
}

export function initSettings(): void {
  void loadSettings();

  $('#btn-db-save').addEventListener('click', async () => {
    setStatus('#db-status', '连接中…');
    try {
      const res = await bridgeFetch<{ ok: boolean; counts: { comments: number } }>(
        '/api/db/connect',
        {
          method: 'POST',
          body: JSON.stringify({
            host: val('#db-host'),
            port: Number(val('#db-port')) || 3306,
            database: val('#db-name'),
            user: val('#db-user'),
            password: val('#db-password'),
          }),
        },
      );
      setStatus(
        '#db-status',
        '连接成功，数据表已就绪。库内评论 ' + (res.counts?.comments ?? 0) + ' 条',
        'ok',
      );
      await checkBridge();
    } catch (err) {
      setStatus('#db-status', err instanceof Error ? err.message : String(err), 'err');
    }
  });

  $('#btn-test-llm').addEventListener('click', async () => {
    setStatus('#llm-status', '测试中…');
    try {
      const res = await bridgeFetch<{ ok: boolean; sample: string }>('/api/settings/test-llm', {
        method: 'POST',
        body: JSON.stringify({
          llm: {
            baseUrl: val('#llm-url'),
            apiKey: val('#llm-key'),
            model: val('#llm-model'),
            temperature: Number(val('#llm-temp')) || 0.3,
          },
        }),
      });
      setStatus('#llm-status', '接口可用' + (res.sample ? '：' + res.sample.slice(0, 30) : ''), 'ok');
    } catch (err) {
      setStatus('#llm-status', err instanceof Error ? err.message : String(err), 'err');
    }
  });

  $('#btn-llm-save').addEventListener('click', async () => {
    setStatus('#llm-status', '保存中…');
    try {
      await bridgeFetch<SettingsResponse>('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          llm: {
            baseUrl: val('#llm-url'),
            apiKey: val('#llm-key'),
            model: val('#llm-model'),
            temperature: Number(val('#llm-temp')) || 0.3,
          },
        }),
      });
      setStatus('#llm-status', '已保存（同时写入数据库 settings 表）', 'ok');
    } catch (err) {
      setStatus('#llm-status', err instanceof Error ? err.message : String(err), 'err');
    }
  });

  $('#btn-retrieval-save').addEventListener('click', async () => {
    setStatus('#retrieval-status', '保存中…');
    try {
      await bridgeFetch<SettingsResponse>('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          retrieval: {
            scope: ($('#scope') as HTMLSelectElement).value,
            pageFullThreshold: Number(val('#r-threshold')) || 120,
            pageTopK: Number(val('#r-pagetopk')) || 40,
            libraryTopK: Number(val('#r-libtopk')) || 30,
            maxCommentChars: Number(val('#r-maxchars')) || 1200,
          },
        }),
      });
      setStatus('#retrieval-status', '已保存', 'ok');
    } catch (err) {
      setStatus('#retrieval-status', err instanceof Error ? err.message : String(err), 'err');
    }
  });
}

export interface ConnectionControls {
  disconnect: () => Promise<void>;
  recheck: () => Promise<void>;
}

/** 设置页里的「重新检测 / 更换服务地址」由连接门禁模块处理 */
export function bindConnectionControls(controls: ConnectionControls): void {
  $('#btn-test-bridge').addEventListener('click', async () => {
    setStatus('#bridge-status', '检测中…');
    await controls.recheck();
    const ok = await checkBridge();
    setStatus('#bridge-status', ok ? '服务与数据库均正常' : '见顶部提示', ok ? 'ok' : 'err');
  });

  $('#btn-disconnect').addEventListener('click', async () => {
    if (!(await confirmDialog('断开后需要重新填写服务地址并测试连接，确定吗？', { okText: '断开' }))) return;
    await controls.disconnect();
  });
}
