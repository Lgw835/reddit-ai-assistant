import { buildApp } from './app.js';
import { closePool, dbStatus } from './db.js';
import { join } from 'node:path';
import { loadConfig, DATA_DIR } from './config.js';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';

/** 打包成 EXE 双击运行时，窗口不能一闪而过，出错要让人看清 */
const PACKAGED = process.env.RC_PACKAGED === '1';

const NL = String.fromCharCode(10);

function line(text = ''): void {
  process.stdout.write(text + '\n');
}

async function pauseIfPackaged(): Promise<void> {
  if (!PACKAGED || !process.stdin.isTTY) return;
  line();
  line('按回车键关闭此窗口…');
  await new Promise<void>((r) => {
    process.stdin.resume();
    process.stdin.once('data', () => r());
  });
}

/** 端口被占时，先看看占用者是不是本服务的另一个实例 */
async function probeExisting(): Promise<boolean> {
  try {
    const res = await fetch(`http://${HOST}:${PORT}/api/health`, {
      signal: AbortSignal.timeout(3000),
    });
    const j = (await res.json()) as { ok?: boolean };
    return j?.ok === true;
  } catch {
    return false;
  }
}

function banner(cfg: Awaited<ReturnType<typeof loadConfig>>): void {
  const db = dbStatus();
  line();
  line('  Reddit 收集器 · 本地服务');
  line('  ' + '─'.repeat(46));
  line('  服务地址   http://' + HOST + ':' + PORT);
  line('  数据库     ' + (db.connected ? '已连接  ' + db.target : '未连接  ' + (db.error ?? '')));
  line('  大模型     ' + (cfg.llm.baseUrl && cfg.llm.model ? cfg.llm.model : '未配置'));
  if (PACKAGED) line('  配置文件   ' + join(DATA_DIR, 'config.json'));
  line('  ' + '─'.repeat(46));
  line('  在插件侧边栏点「用本地服务」即可连接，访问令牌留空。');
  line('  关闭此窗口即停止服务。');
  line();
}

async function main(): Promise<void> {
  const app = await buildApp(!PACKAGED);

  try {
    await app.listen({ port: PORT, host: HOST });
    banner(await loadConfig());
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === 'EADDRINUSE') {
      const mine = await probeExisting();
      line();
      line(
        mine
          ? '  服务已经在运行了，不用重复启动。' + NL + '  地址： http://' + HOST + ':' + PORT
          : '  端口 ' + PORT + ' 被别的程序占用了。' + NL +
            '  可以关掉那个程序，或设置环境变量 PORT 换一个端口再启动。',
      );
      await pauseIfPackaged();
      process.exit(mine ? 0 : 1);
    }
    line('  启动失败：' + (err instanceof Error ? err.message : String(err)));
    await pauseIfPackaged();
    process.exit(1);
  }

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, async () => {
      await app.close().catch(() => {});
      await closePool();
      process.exit(0);
    });
  }
}

main().catch(async (err) => {
  line('  启动失败：' + (err instanceof Error ? err.message : String(err)));
  await pauseIfPackaged();
  process.exit(1);
});
