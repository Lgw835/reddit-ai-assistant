/**
 * 按 Vercel 的打包方式验证部署入口。
 *
 * Vercel 会把源码打成一个 bundle，仓库根目录没有 "type": "module" 时产物是 CJS，
 * 此时 import.meta 会变成空对象。tsx 直跑是 ESM，发现不了这类问题，所以单独测。
 *
 * 运行： npx tsx tools/test-bundled-entry.mts
 */
import * as esbuild from 'esbuild';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';

const out = mkdtempSync(join(tmpdir(), 'rc-bundle-'));
const bundle = join(out, 'bundle.cjs');

console.log('用 esbuild 打成 CJS…');
const result = await esbuild.build({
  entryPoints: ['api/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: bundle,
  logLevel: 'silent',
});

const metaWarnings = result.warnings.filter((w) => w.text.includes('import.meta'));
if (metaWarnings.length) {
  console.log('✗ CJS 产物里有 import.meta，运行时会在加载阶段崩溃：');
  metaWarnings.forEach((w) => console.log('   ' + w.text));
  process.exit(1);
}
console.log('✓ 没有 import.meta 警告');

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

const requireCjs = createRequire(import.meta.url);
let handler: (req: unknown, res: unknown) => void;
try {
  const mod = requireCjs(bundle);
  handler = mod.default ?? mod;
  console.log('✓ CJS 产物可以加载');
} catch (err) {
  console.log('✗ CJS 产物加载失败：' + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
}

const server = createServer((req, res) => handler(req, res));
await new Promise<void>((r) => server.listen(8802, '127.0.0.1', r));

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log((ok ? '✓' : '✗') + ' ' + name + (detail ? '  ' + detail : ''));
  if (!ok) failed++;
};

const base = 'http://127.0.0.1:8802';
const health = await (await fetch(base + '/api/health')).json();
check('健康检查可达', health.ok === true, JSON.stringify(health.db));
check('识别为 serverless', health.mode === 'serverless');
check('数据库已连接', health.db?.connected === true, health.db?.error ?? '');
check('无令牌被拒', (await fetch(base + '/api/comments?limit=1')).status === 401);

server.close();
console.log(failed === 0 ? '\n全部通过' : `\n有 ${failed} 项未通过`);
process.exit(failed === 0 ? 0 : 1);
