/**
 * 在本机模拟 Vercel 的 Serverless 环境，验证 server/api/index.ts 这个入口能正常工作。
 * 运行： npx tsx tools/test-vercel-handler.mts
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// 模拟 Vercel：只有环境变量，没有可写文件系统
process.env.VERCEL = '1';
process.env.ACCESS_TOKEN = process.env.ACCESS_TOKEN ?? 'vercel-test-token';

const envPath = resolve(process.cwd(), 'server/.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const { default: handler } = await import('../server/api/index.ts');

const PORT = 8799;
const server = createServer((req, res) => {
  void handler(req, res);
});

await new Promise<void>((r) => server.listen(PORT, '127.0.0.1', r));
const base = `http://127.0.0.1:${PORT}`;
const token = process.env.ACCESS_TOKEN as string;

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log((ok ? '✓' : '✗') + ' ' + name + (detail ? '  ' + detail : ''));
  if (!ok) failed++;
};

// 1. 健康检查不需要令牌，并且应报告 serverless 模式
const health = await (await fetch(base + '/api/health')).json();
check('健康检查可达', health.ok === true, JSON.stringify(health.db));
check('识别为 serverless 模式', health.mode === 'serverless');
check('要求访问令牌', health.authRequired === true);
check('数据库已连接', health.db?.connected === true, health.db?.error ?? '');

// 2. 无令牌访问受保护接口应 401
const noAuth = await fetch(base + '/api/comments?limit=1');
check('无令牌被拒绝', noAuth.status === 401);

// 3. 带令牌可读数据
const withAuth = await fetch(base + '/api/comments?limit=1', {
  headers: { 'x-rc-token': token },
});
const list = await withAuth.json();
check('带令牌可读收藏库', withAuth.ok && list.ok === true, '共 ' + (list.total ?? '?') + ' 条');

// 4. 云端不允许改数据库连接信息
const connectRes = await fetch(base + '/api/db/connect', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-rc-token': token },
  body: JSON.stringify({ host: 'evil.example.com' }),
});
const connectJson = await connectRes.json();
check('云端拒绝改数据库配置', connectRes.status === 400 && connectJson.ok === false);

// 5. 设置可读，且状态里标记为不可编辑
const status = await (await fetch(base + '/api/db/status', {
  headers: { 'x-rc-token': token },
})).json();
check('数据库配置标记为只读', status.editable === false);

// 6. 模型配置从数据库 settings 表读回来了
const settings = await (await fetch(base + '/api/settings', {
  headers: { 'x-rc-token': token },
})).json();
check('模型配置已加载', Boolean(settings.llm?.baseUrl && settings.llm?.model),
  settings.llm?.model ?? '');

// 7. SSE 流式对话能跑通
const chat = await fetch(base + '/api/chat', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-rc-token': token },
  body: JSON.stringify({ message: 'latte art', scope: 'library' }),
});
const sse = await chat.text();
check('对话接口返回 SSE', sse.includes('event: meta'));
check('对话产生了回答', sse.includes('event: delta') && sse.includes('event: done'));

server.close();
console.log(failed === 0 ? '\n全部通过' : `\n有 ${failed} 项未通过`);
process.exit(failed === 0 ? 0 : 1);
