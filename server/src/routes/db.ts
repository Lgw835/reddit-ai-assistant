import type { FastifyInstance } from 'fastify';
import type { RowDataPacket } from 'mysql2';
import { connect, dbStatus, isReady, getPool } from '../db.js';
import {
  loadConfig,
  saveConfig,
  applySettings,
  redact,
  unmask,
  isServerless,
  type DbConfig,
  type RetrievalConfig,
} from '../config.js';
import { stats } from '../store.js';

interface ConnectBody {
  host?: string;
  port?: number | string;
  database?: string;
  user?: string;
  password?: string;
}

export async function dbRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/db/status', async () => {
    const cfg = await loadConfig();
    const status = dbStatus();
    let counts: { comments: number; posts: number } | null = null;
    if (isReady()) {
      try {
        counts = await stats();
      } catch {
        counts = null;
      }
    }
    return { ...status, config: redact(cfg).db, editable: !isServerless(), counts };
  });

  app.post<{ Body: ConnectBody }>('/api/db/connect', async (req, reply) => {
    if (isServerless()) {
      reply.code(400);
      return {
        ok: false,
        error:
          '云端部署的数据库连接信息只能在 Vercel 的环境变量里修改（DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD），改完重新部署即可。',
      };
    }

    const current = await loadConfig();
    const body = req.body ?? {};
    const next: DbConfig = {
      host: (body.host ?? current.db.host).trim(),
      port: Number(body.port ?? current.db.port) || 3306,
      database: (body.database ?? current.db.database).trim(),
      user: (body.user ?? current.db.user).trim(),
      password: unmask(body.password, current.db.password),
    };

    try {
      await connect(next);
    } catch (err) {
      reply.code(400);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    await saveConfig({ db: next });
    await syncSettingsToDb();
    return { ok: true, status: dbStatus(), counts: await stats() };
  });
}

/** 把当前 LLM / 检索配置写入 MySQL 的 settings 表，云端部署时这里就是唯一的持久化位置 */
export async function syncSettingsToDb(): Promise<void> {
  if (!isReady()) return;
  const cfg = await loadConfig();
  const entries: [string, string][] = [
    ['llm.base_url', cfg.llm.baseUrl],
    ['llm.api_key', cfg.llm.apiKey],
    ['llm.model', cfg.llm.model],
    ['llm.temperature', String(cfg.llm.temperature)],
    ['retrieval.scope', cfg.retrieval.scope],
    ['retrieval.page_full_threshold', String(cfg.retrieval.pageFullThreshold)],
    ['retrieval.page_top_k', String(cfg.retrieval.pageTopK)],
    ['retrieval.library_top_k', String(cfg.retrieval.libraryTopK)],
    ['retrieval.max_comment_chars', String(cfg.retrieval.maxCommentChars)],
  ];
  await getPool().query(
    'INSERT INTO settings (`key`, `value`) VALUES ? ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
    [entries],
  );
}

/**
 * 启动时把 settings 表里保存的配置读回内存。
 * 无状态部署没有本地文件，改过的模型配置全靠这张表带回来。
 */
export async function hydrateSettingsFromDb(): Promise<boolean> {
  if (!isReady()) return false;
  const [rows] = await getPool().query<(RowDataPacket & { key: string; value: string })[]>(
    'SELECT `key`, `value` FROM settings',
  );
  if (!rows.length) return false;

  const map = new Map(rows.map((r) => [r.key, r.value]));
  const current = await loadConfig();
  const pick = (key: string, fallback: string): string => {
    const v = map.get(key);
    return v === undefined || v === '' ? fallback : v;
  };
  const pickNum = (key: string, fallback: number): number => {
    const v = Number(map.get(key));
    return Number.isFinite(v) ? v : fallback;
  };

  await applySettings({
    llm: {
      baseUrl: pick('llm.base_url', current.llm.baseUrl),
      apiKey: pick('llm.api_key', current.llm.apiKey),
      model: pick('llm.model', current.llm.model),
      temperature: pickNum('llm.temperature', current.llm.temperature),
    },
    retrieval: {
      scope: pick('retrieval.scope', current.retrieval.scope) as RetrievalConfig['scope'],
      pageFullThreshold: pickNum('retrieval.page_full_threshold', current.retrieval.pageFullThreshold),
      pageTopK: pickNum('retrieval.page_top_k', current.retrieval.pageTopK),
      libraryTopK: pickNum('retrieval.library_top_k', current.retrieval.libraryTopK),
      maxCommentChars: pickNum('retrieval.max_comment_chars', current.retrieval.maxCommentChars),
    },
  });
  return true;
}
