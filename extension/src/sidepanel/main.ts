import { initChat, refreshContextBar } from './chat';
import { initLibrary, reload as reloadLibrary } from './library';
import { checkBridge, initSettings, bindConnectionControls } from './settings';
import { initConnect } from './connect';

type TabName = 'chat' | 'library' | 'settings';

let current: TabName = 'chat';
let unlocked = false;
let started = false;

function show(tab: TabName): void {
  if (!unlocked) return;
  current = tab;
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.tab')) {
    btn.classList.toggle('tab--active', btn.dataset.tab === tab);
  }
  for (const view of document.querySelectorAll<HTMLElement>('.view')) {
    view.classList.toggle('view--active', view.id === 'view-' + tab);
  }
  if (tab === 'library') void reloadLibrary();
  else if (tab === 'chat') void refreshContextBar();
}

function initTabs(): void {
  document.querySelector('#tabs')?.addEventListener('click', (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;
    const name = target.dataset.tab as TabName | undefined;
    if (name && (name !== current || !document.querySelector('.view--active#view-' + name))) {
      show(name);
    }
  });
}

/** 连接验证通过后才初始化对话、收藏库和设置 */
function onConnected(): void {
  unlocked = true;
  if (!started) {
    started = true;
    initChat();
    initLibrary();
    initSettings();
  }
  show(current);
  void checkBridge();
}

const gate = initConnect(onConnected);

bindConnectionControls({
  disconnect: async () => {
    unlocked = false;
    for (const view of document.querySelectorAll<HTMLElement>('.view')) {
      view.classList.remove('view--active');
    }
    await gate.disconnect();
  },
  recheck: () => gate.refresh(),
});

initTabs();
void gate.refresh();
