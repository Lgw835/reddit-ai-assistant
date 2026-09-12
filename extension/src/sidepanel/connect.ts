import {
  DEFAULT_BRIDGE,
  clearEndpoint,
  getEndpoint,
  normalizeBase,
  setEndpoint,
} from '../shared/messages';

export interface HealthInfo {
  ok: boolean;
  version?: string;
  mode?: 'local' | 'serverless';
  authRequired?: boolean;
  publicDeploy?: boolean;
  db?: { connected: boolean; target: string | null; error: string | null };
  llmConfigured?: boolean;
}

export interface ProbeResult {
  ok: boolean;
  info?: HealthInfo;
  error?: string;
  needToken?: boolean;
}

/** 云端域名不在 manifest 的固定权限里，用到时按需申请 */
export async function ensureHostPermission(base: string): Promise<boolean> {
  try {
    const origin = new URL(base).origin + '/*';
    if (await chrome.permissions.contains({ origins: [origin] })) return true;
    return await chrome.permissions.request({ origins: [origin] });
  } catch {
    return false;
  }
}

/** 测试一个服务地址：地址是否可达、是否要令牌、令牌对不对、数据库通不通 */
export async function probe(baseInput: string, token: string): Promise<ProbeResult> {
  const base = normalizeBase(baseInput);
  if (!base) return { ok: false, error: '请填写服务地址' };
  if (!/^https?:\/\//.test(base)) return { ok: false, error: '地址格式不正确' };

  if (!(await ensureHostPermission(base))) {
    return { ok: false, error: '需要授权访问该域名，请在弹出的提示中点「允许」后重试' };
  }

  let health: HealthInfo;
  try {
    const res = await fetch(base + '/api/health', { headers: { 'content-type': 'application/json' } });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, error: '服务返回 HTTP ' + res.status + '：' + text.slice(0, 160) };
    }
    health = JSON.parse(text) as HealthInfo;
  } catch (err) {
    return {
      ok: false,
      error:
        '无法访问该地址。请确认：域名拼写正确、服务已部署成功' +
        (base.startsWith('http://127.0.0.1') || base.startsWith('http://localhost')
          ? '（本地需先运行 npm run server）'
          : '（云端可先在浏览器里直接打开 ' + base + '/api/health 看看）') +
        '。\n' +
        (err instanceof Error ? err.message : String(err)),
    };
  }

  if (!health?.ok) return { ok: false, error: '该地址不是本插件的服务接口' };

  if (health.authRequired) {
    if (!token.trim()) {
      return { ok: false, info: health, needToken: true, error: '该服务要求访问令牌，请填写 ACCESS_TOKEN' };
    }
    const res = await fetch(base + '/api/db/status', {
      headers: { 'content-type': 'application/json', 'x-rc-token': token.trim() },
    });
    if (res.status === 401) {
      return { ok: false, info: health, needToken: true, error: '访问令牌不正确' };
    }
    if (!res.ok) {
      return { ok: false, info: health, error: '服务可达但接口异常：HTTP ' + res.status };
    }
  } else if (health.publicDeploy) {
    return {
      ok: false,
      info: health,
      error: '该服务部署在公网但没有设置 ACCESS_TOKEN，任何人拿到域名都能读你的数据。请先在 Vercel 环境变量里加上 ACCESS_TOKEN 并重新部署。',
    };
  }

  if (!health.db?.connected) {
    return {
      ok: false,
      info: health,
      error:
        '服务正常，但数据库没连上' +
        (health.db?.error ? '：' + health.db.error : '') +
        (health.mode === 'serverless'
          ? '。请检查 Vercel 环境变量里的 DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD。'
          : '。请在设置页填写 MySQL 连接信息。'),
    };
  }

  return { ok: true, info: health };
}

function $<T extends HTMLElement>(sel: string): T {
  return document.querySelector(sel) as T;
}

function describe(info: HealthInfo): string {
  const parts = [
    info.mode === 'serverless' ? '云端部署' : '本地服务',
    'v' + (info.version ?? '?'),
    info.db?.connected ? '数据库已连接' : '数据库未连接',
    info.llmConfigured ? '模型已配置' : '模型未配置',
  ];
  return parts.join('　·　');
}

/**
 * 连接门禁：验证通过前不进入对话界面。
 * onConnected 在验证成功后调用，用来解锁其余标签页。
 */
export function initConnect(onConnected: () => void): {
  refresh: () => Promise<void>;
  disconnect: () => Promise<void>;
} {
  const gate = $('#view-connect');
  const status = $('#connect-status');
  const baseInput = $('#connect-base') as HTMLInputElement;
  const tokenInput = $('#connect-token') as HTMLInputElement;
  const btn = $('#btn-connect') as HTMLButtonElement;
  const btnLocal = $('#btn-connect-local') as HTMLButtonElement;

  const setStatus = (text: string, kind: 'ok' | 'err' | '' = '') => {
    status.textContent = text;
    status.classList.remove('ok', 'err');
    if (kind) status.classList.add(kind);
  };

  const showGate = (show: boolean) => {
    document.body.classList.toggle('locked', show);
    gate.classList.toggle('view--active', show);
  };

  async function connect(): Promise<void> {
    btn.disabled = true;
    setStatus('正在测试连接…');
    const base = normalizeBase(baseInput.value);
    baseInput.value = base;
    const token = tokenInput.value.trim();

    const res = await probe(base, token);
    if (!res.ok) {
      setStatus(res.error ?? '连接失败', 'err');
      if (res.needToken) tokenInput.focus();
      btn.disabled = false;
      return;
    }

    await setEndpoint({ base, token, verified: true });
    setStatus('连接成功：' + describe(res.info as HealthInfo), 'ok');
    btn.disabled = false;
    showGate(false);
    onConnected();
  }

  btn.addEventListener('click', () => void connect());
  btnLocal.addEventListener('click', () => {
    baseInput.value = DEFAULT_BRIDGE;
    tokenInput.value = '';
    void connect();
  });
  for (const input of [baseInput, tokenInput]) {
    input.addEventListener('keydown', (ev) => {
      if ((ev as KeyboardEvent).key === 'Enter') void connect();
    });
  }

  async function refresh(): Promise<void> {
    const ep = await getEndpoint();
    baseInput.value = ep.base || '';
    tokenInput.value = ep.token || '';
    if (!ep.base || !ep.verified) {
      showGate(true);
      setStatus(ep.base ? '请重新测试连接' : '');
      return;
    }
    // 已保存过的地址启动时再验一次，服务挂掉时不至于进去才发现
    setStatus('正在检查已保存的服务…');
    const res = await probe(ep.base, ep.token);
    if (res.ok) {
      showGate(false);
      setStatus('已连接：' + describe(res.info as HealthInfo), 'ok');
      onConnected();
    } else {
      await setEndpoint({ verified: false });
      showGate(true);
      setStatus(res.error ?? '连接已失效，请重新测试', 'err');
    }
  }

  async function disconnect(): Promise<void> {
    await clearEndpoint();
    baseInput.value = '';
    tokenInput.value = '';
    showGate(true);
    setStatus('已断开，请重新填写服务地址');
  }

  return { refresh, disconnect };
}
