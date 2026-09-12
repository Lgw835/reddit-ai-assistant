/**
 * 面板内的确认 / 输入 / 提示对话框。
 *
 * Chrome 侧边栏里 window.confirm / prompt / alert 不会弹出，调用后直接返回
 * false 或 null，导致删除、改标签这类操作看起来"点了没反应"。
 * 官方建议用自定义 UI 代替，这里用 <dialog> 实现一套等价的异步接口。
 */

function ensureHost(): HTMLDialogElement {
  let dlg = document.querySelector<HTMLDialogElement>('#rc-dialog');
  if (dlg) return dlg;

  dlg = document.createElement('dialog');
  dlg.id = 'rc-dialog';
  dlg.className = 'dlg';
  dlg.innerHTML = `
    <form method="dialog" class="dlg__form">
      <p class="dlg__msg" id="rc-dialog-msg"></p>
      <input class="dlg__input" id="rc-dialog-input" hidden />
      <div class="dlg__actions">
        <button class="mini" value="cancel" id="rc-dialog-cancel" type="submit">取消</button>
        <button class="primary" value="ok" id="rc-dialog-ok" type="submit">确定</button>
      </div>
    </form>`;
  document.body.appendChild(dlg);
  return dlg;
}

interface OpenOptions {
  message: string;
  okText?: string;
  cancelText?: string;
  danger?: boolean;
  input?: { value: string; placeholder?: string } | null;
}

function open(opts: OpenOptions): Promise<string | null> {
  const dlg = ensureHost();
  const msg = dlg.querySelector('#rc-dialog-msg') as HTMLParagraphElement;
  const input = dlg.querySelector('#rc-dialog-input') as HTMLInputElement;
  const ok = dlg.querySelector('#rc-dialog-ok') as HTMLButtonElement;
  const cancel = dlg.querySelector('#rc-dialog-cancel') as HTMLButtonElement;

  msg.textContent = opts.message;
  ok.textContent = opts.okText ?? '确定';
  cancel.textContent = opts.cancelText ?? '取消';
  ok.classList.toggle('primary--danger', opts.danger === true);

  if (opts.input) {
    input.hidden = false;
    input.value = opts.input.value;
    input.placeholder = opts.input.placeholder ?? '';
  } else {
    input.hidden = true;
    input.value = '';
  }

  return new Promise((resolve) => {
    const done = () => {
      dlg.removeEventListener('close', done);
      resolve(dlg.returnValue === 'ok' ? (opts.input ? input.value : '') : null);
    };
    dlg.addEventListener('close', done);
    dlg.returnValue = 'cancel';
    dlg.showModal();
    (opts.input ? input : ok).focus();
    if (opts.input) input.select();
  });
}

/** 确认框，确定返回 true */
export async function confirmDialog(
  message: string,
  opts: { okText?: string; danger?: boolean } = {},
): Promise<boolean> {
  return (await open({ message, okText: opts.okText, danger: opts.danger })) !== null;
}

/** 输入框，取消返回 null */
export async function promptDialog(
  message: string,
  value = '',
  placeholder = '',
): Promise<string | null> {
  return open({ message, input: { value, placeholder } });
}

/** 只有一个按钮的提示 */
export async function alertDialog(message: string): Promise<void> {
  await open({ message, okText: '知道了', cancelText: '' });
}

/** 右下角一闪而过的轻提示，用于操作成功的反馈 */
export function toast(message: string, kind: 'ok' | 'err' = 'ok'): void {
  const node = document.createElement('div');
  node.className = 'rc-toast' + (kind === 'err' ? ' rc-toast--err' : '');
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.classList.add('rc-toast--out'), 2200);
  setTimeout(() => node.remove(), 2600);
}
