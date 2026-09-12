import { bridgeFetch as rawFetch } from '../shared/bridge';
import { getBridgeBase } from '../shared/messages';

export const bridgeFetch = rawFetch;
export const getBridgeBaseSafe = getBridgeBase;

export function $<T extends HTMLElement>(sel: string): T {
  return document.querySelector(sel) as T;
}

export function setStatus(sel: string, text: string, kind: 'ok' | 'err' | '' = ''): void {
  const node = $(sel);
  node.textContent = text;
  node.classList.remove('ok', 'err');
  if (kind) node.classList.add(kind);
}
