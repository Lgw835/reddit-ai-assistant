import mysql from 'mysql2/promise';
import type { Pool } from 'mysql2/promise';
import { loadConfig, type DbConfig } from './config.js';

/**
 * Serverless 环境里同一个实例会处理多次请求，模块级变量可能被重新求值，
 * 因此把连接池挂在 globalThis 上复用，避免每次都新建连接（免费版 MySQL 连接数很紧）。
 */
interface PoolCache {
  pool: Pool | null;
  ready: boolean;
  lastError: string | null;
  connectedTo: string | null;
}

const g = globalThis as typeof globalThis & { __rcPool?: PoolCache };
const cache: PoolCache = (g.__rcPool ??= {
  pool: null,
  ready: false,
  lastError: null,
  connectedTo: null,
});

let pool: Pool | null = cache.pool;
let ready = cache.ready;
let lastError: string | null = cache.lastError;
let connectedTo: string | null = cache.connectedTo;

function sync(): void {
  cache.pool = pool;
  cache.ready = ready;
  cache.lastError = lastError;
  cache.connectedTo = connectedTo;
}

export function dbStatus() {
  return {
    connected: ready,
    target: connectedTo,
    error: lastError,
  };
}

export function getPool(): Pool {
  if (!pool || !ready) {
    throw new Error('数据库尚未连接，请在插件设置页填写 MySQL 连接信息并点击「测试并保存」。');
  }
  return pool;
}

export function isReady() {
  return ready;
}

const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS settings (
     \`key\`        VARCHAR(128) NOT NULL PRIMARY KEY,
     \`value\`      TEXT,
     updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS posts (
     id            VARCHAR(32)  NOT NULL PRIMARY KEY,
     subreddit     VARCHAR(128),
     title         VARCHAR(1024),
     author        VARCHAR(128),
     permalink     VARCHAR(768),
     url           VARCHAR(1024),
     body_text     MEDIUMTEXT,
     score         INT DEFAULT 0,
     num_comments  INT DEFAULT 0,
     created_utc   DATETIME NULL,
     saved_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     INDEX idx_posts_subreddit (subreddit),
     INDEX idx_posts_saved_at (saved_at)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS comments (
     id             VARCHAR(32) NOT NULL PRIMARY KEY,
     post_id        VARCHAR(32) NOT NULL,
     parent_id      VARCHAR(32) NULL,
     author         VARCHAR(128),
     body_text      MEDIUMTEXT,
     body_html      MEDIUMTEXT,
     permalink      VARCHAR(768),
     url            VARCHAR(1024),
     depth          INT DEFAULT 0,
     score          INT DEFAULT 0,
     created_utc    DATETIME NULL,
     parent_excerpt VARCHAR(600),
     note           TEXT,
     source         VARCHAR(16) NOT NULL DEFAULT 'manual',
     saved_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     INDEX idx_comments_post (post_id),
     INDEX idx_comments_author (author),
     INDEX idx_comments_saved_at (saved_at),
     FULLTEXT KEY ft_comments_body (body_text)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS tags (
     id    INT AUTO_INCREMENT PRIMARY KEY,
     name  VARCHAR(64) NOT NULL,
     UNIQUE KEY uq_tags_name (name)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS comment_tags (
     comment_id VARCHAR(32) NOT NULL,
     tag_id     INT NOT NULL,
     PRIMARY KEY (comment_id, tag_id),
     INDEX idx_comment_tags_tag (tag_id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS chat_sessions (
     id         VARCHAR(40) NOT NULL PRIMARY KEY,
     title      VARCHAR(255),
     page_url   VARCHAR(1024),
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     INDEX idx_sessions_updated (updated_at)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS chat_messages (
     id         BIGINT AUTO_INCREMENT PRIMARY KEY,
     session_id VARCHAR(40) NOT NULL,
     role       VARCHAR(16) NOT NULL,
     content    MEDIUMTEXT,
     citations  JSON NULL,
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     INDEX idx_messages_session (session_id, id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

export async function ensureSchema(p: Pool): Promise<void> {
  for (const stmt of SCHEMA) {
    await p.query(stmt);
  }
}

export async function connect(cfg: DbConfig): Promise<void> {
  if (!cfg.host || !cfg.user || !cfg.database) {
    throw new Error('MySQL 连接信息不完整（需要 host / user / database）。');
  }
  const next = mysql.createPool({
    host: cfg.host,
    port: cfg.port || 3306,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    waitForConnections: true,
    connectionLimit: 3,
    maxIdle: 1,
    idleTimeout: 30_000,
    enableKeepAlive: true,
    charset: 'utf8mb4_unicode_ci',
    timezone: 'Z',
    dateStrings: true,
    supportBigNumbers: true,
  });

  try {
    const conn = await next.getConnection();
    await conn.ping();
    conn.release();
    await ensureSchema(next);
  } catch (err) {
    await next.end().catch(() => {});
    ready = false;
    lastError = err instanceof Error ? err.message : String(err);
    sync();
    throw err;
  }

  const old = pool;
  pool = next;
  ready = true;
  lastError = null;
  connectedTo = `${cfg.user}@${cfg.host}:${cfg.port || 3306}/${cfg.database}`;
  sync();
  if (old) await old.end().catch(() => {});
}

/** 启动时按已保存的配置自动连接，失败不阻断服务启动 */
export async function autoConnect(log: (msg: string) => void): Promise<void> {
  if (ready && pool) return; // 复用上一次调用留下的连接池（serverless 热实例）
  const cfg = await loadConfig();
  if (!cfg.db.host || !cfg.db.user) {
    log('未找到 MySQL 配置，请在插件设置页填写后保存。');
    return;
  }
  try {
    await connect(cfg.db);
    log(`MySQL 已连接：${connectedTo}，数据表已就绪。`);
  } catch (err) {
    log(`MySQL 连接失败：${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end().catch(() => {});
    pool = null;
    ready = false;
    sync();
  }
}
