import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Vercel 等无状态环境：文件系统只读，配置只能来自环境变量 + 数据库 */
export function isServerless(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

/**
 * 定位 server/ 目录。
 *
 * 打包器把 ESM 转成 CJS 时 import.meta 会变成空对象，直接用
 * fileURLToPath(import.meta.url) 会在模块加载阶段抛错，整个函数起不来。
 * 这里兜底回退到 cwd —— 这几个路径只在本地运行时才会真正用到。
 */
function serverDir(): string {
  try {
    const url = import.meta?.url;
    if (typeof url === 'string' && url) return resolve(dirname(fileURLToPath(url)), '..');
  } catch {
    /* 落到下面的 cwd */
  }
  return process.cwd();
}

export const DATA_DIR = resolve(serverDir(), 'data');
const CONFIG_PATH = resolve(DATA_DIR, 'config.json');
const ENV_PATH = resolve(serverDir(), '.env');

// 本地有 server/.env 就先加载，作为下面默认值的来源（Node >= 20.12）
if (!isServerless() && existsSync(ENV_PATH) && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(ENV_PATH);
  } catch {
    /* .env 格式有问题时忽略，仍可在设置页填写 */
  }
}

export interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
}

export interface RetrievalConfig {
  /** 默认检索范围 */
  scope: 'page' | 'page+library' | 'library';
  /** 当前页评论数超过该值时启用页内 BM25 精选 */
  pageFullThreshold: number;
  /** 页内精选保留条数 */
  pageTopK: number;
  /** 收藏库检索保留条数 */
  libraryTopK: number;
  /** 单条评论送入模型的最大字符数 */
  maxCommentChars: number;
}

export interface AppConfig {
  db: DbConfig;
  llm: LlmConfig;
  retrieval: RetrievalConfig;
}

/**
 * 解析一条 MySQL 连接串，省得在部署平台上一个个填。
 * 形如 mysql://用户:密码@主机:端口/库名
 */
export function parseDatabaseUrl(raw: string | undefined): Partial<DbConfig> {
  const v = (raw ?? '').trim();
  if (!v) return {};
  try {
    const u = new URL(v.replace(/^mysql2:\/\//i, 'mysql://'));
    const database = decodeURIComponent(u.pathname.replace(/^\//, ''));
    return {
      host: u.hostname,
      port: Number(u.port) || 3306,
      database,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
    };
  } catch {
    return {};
  }
}

/**
 * 解析一条大模型配置，支持两种写法：
 *   base_url|api_key|model[|temperature]
 *   {"baseUrl":"...","apiKey":"...","model":"..."}
 */
export function parseLlmConfig(raw: string | undefined): Partial<LlmConfig> {
  const v = (raw ?? '').trim();
  if (!v) return {};

  if (v.startsWith('{')) {
    try {
      const j = JSON.parse(v) as Record<string, unknown>;
      const pick = (...keys: string[]): string | undefined => {
        for (const k of keys) {
          const val = j[k];
          if (typeof val === 'string' && val.trim()) return val.trim();
        }
        return undefined;
      };
      const out: Partial<LlmConfig> = {};
      const baseUrl = pick('baseUrl', 'base_url', 'url');
      const apiKey = pick('apiKey', 'api_key', 'key');
      const model = pick('model');
      if (baseUrl) out.baseUrl = baseUrl;
      if (apiKey) out.apiKey = apiKey;
      if (model) out.model = model;
      const t = Number(j.temperature);
      if (Number.isFinite(t)) out.temperature = t;
      return out;
    } catch {
      return {};
    }
  }

  // URL 里带 // 和 :，所以只用 | 或换行分隔，不用逗号
  const parts = v.split(/[|\n]/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 3) return {};
  const out: Partial<LlmConfig> = {
    baseUrl: parts[0],
    apiKey: parts[1],
    model: parts[2],
  };
  const t = Number(parts[3]);
  if (Number.isFinite(t)) out.temperature = t;
  return out;
}

/** 单独设置的 DB_* / LLM_* 变量优先级更高，可以覆盖连接串里的某一项 */
function pickEnv(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v.trim() === '' ? fallback : v.trim();
}

function defaults(): AppConfig {
  const dbUrl = parseDatabaseUrl(process.env.DATABASE_URL ?? process.env.MYSQL_URL);
  const llmBundle = parseLlmConfig(process.env.LLM_CONFIG);

  return {
    db: {
      host: pickEnv('DB_HOST', dbUrl.host ?? ''),
      port: Number(pickEnv('DB_PORT', String(dbUrl.port ?? 3306))) || 3306,
      database: pickEnv('DB_NAME', dbUrl.database ?? ''),
      user: pickEnv('DB_USER', dbUrl.user ?? ''),
      password: pickEnv('DB_PASSWORD', dbUrl.password ?? ''),
    },
    llm: {
      baseUrl: pickEnv('LLM_BASE_URL', llmBundle.baseUrl ?? ''),
      apiKey: pickEnv('LLM_API_KEY', llmBundle.apiKey ?? ''),
      model: pickEnv('LLM_MODEL', llmBundle.model ?? ''),
      temperature: Number(pickEnv('LLM_TEMPERATURE', String(llmBundle.temperature ?? 0.2))) || 0.2,
    },
    retrieval: {
      scope: 'page+library',
      pageFullThreshold: 120,
      pageTopK: 40,
      libraryTopK: 30,
      maxCommentChars: 1200,
    },
  };
}

let cache: AppConfig | null = null;

function merge(base: AppConfig, patch: Partial<AppConfig>): AppConfig {
  return {
    db: { ...base.db, ...(patch.db ?? {}) },
    llm: { ...base.llm, ...(patch.llm ?? {}) },
    retrieval: { ...base.retrieval, ...(patch.retrieval ?? {}) },
  };
}

export async function loadConfig(): Promise<AppConfig> {
  if (cache) return cache;
  cache = defaults();
  // 无状态环境不读本地文件，配置来自环境变量与数据库 settings 表
  if (!isServerless() && existsSync(CONFIG_PATH)) {
    try {
      const raw = await readFile(CONFIG_PATH, 'utf8');
      cache = merge(cache, JSON.parse(raw) as Partial<AppConfig>);
    } catch {
      /* 文件损坏时退回默认值 */
    }
  }
  return cache;
}

export async function saveConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
  const current = await loadConfig();
  const next = merge(current, patch);
  cache = next;
  if (!isServerless()) {
    if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
    await writeFile(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8');
  }
  return next;
}

/** 把数据库 settings 表里的值并入内存配置（不落盘，用于无状态部署） */
export async function applySettings(patch: Partial<AppConfig>): Promise<AppConfig> {
  const current = await loadConfig();
  cache = merge(current, patch);
  return cache;
}

/** 对外返回时隐去敏感字段 */
export function redact(cfg: AppConfig) {
  return {
    db: { ...cfg.db, password: cfg.db.password ? '********' : '' },
    llm: { ...cfg.llm, apiKey: cfg.llm.apiKey ? '********' : '' },
    retrieval: cfg.retrieval,
  };
}

/** 表单回传的掩码值表示"不修改" */
export const MASK = '********';
export function unmask(incoming: string | undefined, existing: string): string {
  if (incoming === undefined) return existing;
  if (incoming === MASK) return existing;
  return incoming;
}
