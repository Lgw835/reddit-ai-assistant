/** 把各种 ISO 时间串转成 MySQL DATETIME（UTC）；无法解析时返回 null */
export function toMysqlDate(input?: string | number | null): string | null {
  if (input === null || input === undefined || input === '') return null;
  let d: Date;
  if (typeof input === 'number') {
    d = new Date(input < 1e12 ? input * 1000 : input);
  } else {
    // Reddit 会输出 2019-06-13T12:58:19.753000+0000 这种六位微秒 + 无冒号时区
    const normalized = input
      .replace(/(\.\d{3})\d+/, '$1')
      .replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
    d = new Date(normalized);
  }
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

export function clampText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v) return null;
  return v.length > max ? v.slice(0, max) : v;
}

export function toInt(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export function excerpt(text: string | null | undefined, max = 400): string | null {
  if (!text) return null;
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  return clean.length > max ? clean.slice(0, max) + '…' : clean;
}

export function randomId(prefix = 's'): string {
  return prefix + '_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function redditUrl(permalink?: string | null): string | null {
  if (!permalink) return null;
  if (/^https?:\/\//.test(permalink)) return permalink;
  return 'https://www.reddit.com' + (permalink.startsWith('/') ? permalink : '/' + permalink);
}
