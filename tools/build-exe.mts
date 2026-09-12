/**
 * 把后端打包成一个单文件 EXE，双击即可运行，目标机器不需要装 Node。
 *
 * 用的是 Node 官方的 Single Executable Application 方案：
 *   1. esbuild 把 TypeScript 与全部依赖打成一个 CommonJS 文件
 *   2. node --experimental-sea-config 生成资源 blob
 *   3. 复制一份 node.exe，用 postject 把 blob 注入进去
 *
 * 运行： npm run build:exe
 */
import * as esbuild from 'esbuild';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = process.cwd();
const WORK = resolve(ROOT, 'build/exe');
const OUT_DIR = resolve(ROOT, 'dist-exe');
const EXE_NAME = 'reddit-collector.exe';

const embedCreds = !process.argv.includes('--no-credentials');

function step(n: number, text: string): void {
  console.log(`\n[${n}/5] ${text}`);
}

/** 把 server/.env 里的配置内置进 exe，这样单独拿走 exe 也能直接用 */
function embeddedConfig(): string {
  const envPath = resolve(ROOT, 'server/.env');
  if (!embedCreds || !existsSync(envPath)) return '';
  const v: Record<string, string> = {};
  for (const l of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) v[m[1]] = m[2];
  }
  if (!v.DB_HOST || !v.DB_USER) return '';
  return JSON.stringify({
    db: {
      host: v.DB_HOST,
      port: Number(v.DB_PORT) || 3306,
      database: v.DB_NAME ?? '',
      user: v.DB_USER,
      password: v.DB_PASSWORD ?? '',
      ssl: v.DB_SSL === 'true',
    },
    llm: {
      baseUrl: v.LLM_BASE_URL ?? '',
      apiKey: v.LLM_API_KEY ?? '',
      model: v.LLM_MODEL ?? '',
      temperature: Number(v.LLM_TEMPERATURE) || 0.2,
    },
  });
}

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

// ---- 1. 打包成单个 CommonJS 文件 ----
step(1, '打包源码与依赖');
const bundlePath = join(WORK, 'server.cjs');
const embedded = embeddedConfig();
const result = await esbuild.build({
  entryPoints: ['server/src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: bundlePath,
  minify: true,
  define: {
    'process.env.RC_PACKAGED': '"1"',
    'process.env.RC_EMBEDDED_CONFIG': JSON.stringify(embedded),
  },
  logLevel: 'silent',
});
for (const w of result.warnings) console.log('   警告：' + w.text);
console.log(
  '   产物 ' + (statSync(bundlePath).size / 1024 / 1024).toFixed(1) + ' MB' +
    (embedded ? '，已内置数据库与模型配置' : '，未内置配置（首次运行请在插件设置页填写）'),
);

// ---- 2. 生成 SEA 配置 ----
step(2, '生成单文件资源配置');
const seaConfig = join(WORK, 'sea-config.json');
const blobPath = join(WORK, 'server.blob');
writeFileSync(
  seaConfig,
  JSON.stringify(
    { main: bundlePath, output: blobPath, disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false },
    null,
    2,
  ),
  'utf8',
);

// ---- 3. 生成 blob ----
step(3, '生成资源 blob');
execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'pipe' });
console.log('   ' + (statSync(blobPath).size / 1024 / 1024).toFixed(1) + ' MB');

// ---- 4. 复制 node 运行时 ----
step(4, '复制 Node 运行时');
// 旧的 exe 正在运行时文件被锁住，这时换个名字输出，不打断用户当前在用的服务
let exePath = join(OUT_DIR, EXE_NAME);
let locked = false;
try {
  rmSync(exePath, { force: true });
} catch {
  locked = true;
  exePath = join(OUT_DIR, EXE_NAME.replace(/.exe$/, '') + '-new.exe');
  rmSync(exePath, { force: true });
}
copyFileSync(process.execPath, exePath);
console.log('   ' + exePath);
if (locked) {
  console.log('   （原文件正被运行中的服务占用，已改名输出）');
}

// ---- 5. 注入 ----
step(5, '注入到可执行文件');
execFileSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['postject', exePath, 'NODE_SEA_BLOB', blobPath, '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'],
  { stdio: 'pipe', shell: process.platform === 'win32' },
);

const mb = (statSync(exePath).size / 1024 / 1024).toFixed(1);
console.log(`\n完成： ${exePath}  (${mb} MB)`);
console.log('双击即可启动，目标机器不需要安装 Node。');
if (locked) {
  console.log('');
  console.log('提示：旧版本正在运行，新文件输出为 ' + EXE_NAME.replace(/.exe$/, '') + '-new.exe。');
  console.log('关掉正在运行的窗口后，删除旧文件并把新文件改回原名即可。');
}
if (embedded) {
  console.log('注意：该 exe 内含你的数据库密码与模型 Key，不要分发给别人。');
}
