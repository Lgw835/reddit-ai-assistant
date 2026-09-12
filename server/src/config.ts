import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = resolve(__dirname, '../data');
const CONFIG_PATH = resolve(DATA_DIR, 'config.json');
const ENV_PATH = resolve(__dirname, '../.env');

/** Vercel 等无状态环境：文件系统只读，配置只能来自环境变量 + 数据库 */
export function isServerless(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

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

function defaults(): AppConfig {
  return {
    db: {
      host: process.env.DB_HOST ?? '',
      port: Number(process.env.DB_PORT ?? 3306),
      database: process.env.DB_NAME ?? '',
      user: process.env.DB_USER ?? '',
      password: process.env.DB_PASSWORD ?? '',
    },
    llm: {
      baseUrl: process.env.LLM_BASE_URL ?? '',
      apiKey: process.env.LLM_API_KEY ?? '',
      model: process.env.LLM_MODEL ?? '',
      temperature: Number(process.env.LLM_TEMPERATURE ?? 0.2),
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
