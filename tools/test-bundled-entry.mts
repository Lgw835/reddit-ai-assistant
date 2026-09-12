/**
 * 按 Vercel 的打包方式验证部署入口。
 *
 * Vercel 会把源码编译后交给 Node 运行，产物可能是 ESM 也可能是 CJS。
 * 两种格式下的失败方式完全不同（CJS 里 import.meta 为空；ESM 产物被当成
 * CJS 加载会直接语法错误），而 tsx 直跑只覆盖 ESM，发现不了另一半问题。
 * 所以这里两种格式各打一份，分别真实起服务发请求。
 *
 * 运行： npx tsx tools/test-bundled-entry.mts
 */
import * as esbuild from 'esbuild';
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// 产物要放在项目内，external 的依赖才能像在 Vercel 上一样从 node_modules 解析到
const out = resolve(process.cwd(), 'node_modules/.rc-bundle-test');
mkdirSync(out, { recursive: true });

// 用真实凭据模拟 Vercel 的环境变量
process.env.VERCEL = '1';
process.env.ACCESS_TOKEN = 'bundle-test-token';
const envPath = resolve(process.cwd(), 'server/.env');
if (existsSync(envPath)) {
  const vars: Record<string, string> = {};
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) vars[m[1]] = m[2];
  }
  process.env.DATABASE_URL =
    `mysql://${encodeURIComponent(vars.DB_USER)}:${encodeURIComponent(vars.DB_PASSWORD)}` +
    `@${vars.DB_HOST}:${vars.DB_PORT}/${vars.DB_NAME}`;
  process.env.LLM_CONFIG = [vars.LLM_BASE_URL, vars.LLM_API_KEY, vars.LLM_MODEL].join('|');
}

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log((ok ? '  ✓' : '  ✗') + ' ' + name + (detail ? '  ' + detail : ''));
  if (!ok) failed++;
};

async function bundle(format: 'cjs' | 'esm'): Promise<{ file: string; metaWarnings: string[] }> {
  const file = join(out, format === 'cjs' ? 'bundle.cjs' : 'bundle.mjs');
  const result = await esbuild.build({
    entryPoints: ['api/index.ts'],
    bundle: true,
    platform: 'node',
    format,
    target: 'node22',
    // Vercel 不会把 node_modules 打进产物，而是按依赖追踪单独带上，
    // 这里保持一致，否则 Fastify 这类 CJS 依赖被打进 ESM 会误报
    packages: 'external',
    outfile: file,
    logLevel: 'silent',
  });
  return {
    file,
    metaWarnings: result.warnings.filter((w) => w.text.includes('import.meta')).map((w) => w.text),
  };
}

async function run(format: 'cjs' | 'esm', port: number): Promise<void> {
  console.log(`\n[${format.toUpperCase()} 产物]`);
  const { file, metaWarnings } = await bundle(format);

  if (metaWarnings.length) {
    check('打包无 import.meta 告警', false, metaWarnings[0]);
    return;
  }
  check('打包无 import.meta 告警', true);

  let handler: Handler;
  try {
    if (format === 'cjs') {
      const mod = createRequire(import.meta.url)(file);
      handler = mod.default ?? mod;
    } else {
      const mod = await import(pathToFileURL(file).href);
      handler = mod.default;
    }
    check('产物可以加载', typeof handler === 'function');
  } catch (err) {
    check('产物可以加载', false, err instanceof Error ? err.message : String(err));
    return;
  }

  const server = createServer((req, res) => handler(req, res));
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  const base = `http://127.0.0.1:${port}`;

  try {
    const res = await fetch(base + '/api/health');
    const text = await res.text();
    let health: Record<string, any> = {};
    try {
      health = JSON.parse(text);
    } catch {
      check('健康检查返回 JSON', false, text.slice(0, 120));
      return;
    }
    check('健康检查可达', health.ok === true, health.error ?? '');
    check('识别为 serverless', health.mode === 'serverless');
    check('数据库已连接', health.db?.connected === true, health.db?.error ?? '');
    check('模型已配置', health.llmConfigured === true);
    check('无令牌被拒', (await fetch(base + '/api/comments?limit=1')).status === 401);
    check(
      '带令牌可读',
      (
        await (
          await fetch(base + '/api/comments?limit=1', {
            headers: { 'x-rc-token': 'bundle-test-token' },
          })
        ).json()
      ).ok === true,
    );
  } finally {
    server.close();
  }
}

await run('cjs', 8802);
await run('esm', 8803);

console.log(failed === 0 ? '\n两种格式全部通过' : `\n有 ${failed} 项未通过`);
process.exit(failed === 0 ? 0 : 1);
