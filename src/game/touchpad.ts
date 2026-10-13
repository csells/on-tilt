import type { Action } from './input';
import type { Insets } from './renderer';

const ICONS: Partial<Record<Action, string>> = {
  left: '<path d="M15 5 8 12l7 7"/>',
  right: '<path d="m9 5 7 7-7 7"/>',
  softdrop: '<path d="m5 9 7 7 7-7"/>',
  harddrop: '<path d="m6 6 6 6 6-6M6 13l6 6 6-6"/>',
  ccw: '<path d="M4 4v6h6"/><path d="M5.5 15a7.5 7.5 0 1 0 1.3-8L4 10"/>',
  cw: '<path d="M20 4v6h-6"/><path d="M18.5 15a7.5 7.5 0 1 1-1.3-8L20 10"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  nudgeL: '<path d="M12 6 6 12l6 6M18 6l-6 6 6 6"/>',
  nudgeR: '<path d="m12 6 6 6-6 6M6 6l6 6-6 6"/>',
};

function button(action: Action, cls: string, label?: string, aria = label ?? action): string {
  const icon = ICONS[action];
  const body = icon
    ? `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>${label ? `<span>${label}</span>` : ''}`
    : `<span>${label}</span>`;
  return `<button type="button" class="tp-btn ${cls}" data-action="${action}" aria-label="${aria}">${body}</button>`;
}

/**
 * On-screen controls for touch devices. Buttons report press/release so held buttons get
 * the same DAS/ARR and soft-drop repeat as held keys.
 */
export class TouchPad {
  readonly el: HTMLElement;
  private dpad: HTMLElement;
  private right: HTMLElement[];

  constructor(onAction: (action: Action, down: boolean) => void) {
    this.el = document.createElement('div');
    this.el.id = 'touch-pad';
    this.el.innerHTML = `
      <div class="tp-cluster tp-dpad">
        ${button('nudgeL', 'tp-nudge tp-nl', 'NUDGE', 'Nudge left')}
        ${button('harddrop', 'tp-up', 'DROP')}
        ${button('nudgeR', 'tp-nudge tp-nr', 'NUDGE', 'Nudge right')}
        ${button('left', 'tp-left')}
        ${button('right', 'tp-right')}
        ${button('softdrop', 'tp-down')}
      </div>
      <div class="tp-cluster tp-aux">
        ${button('hold', 'tp-pill', 'HOLD')}
        ${button('pause', 'tp-pill tp-pause')}
      </div>
      <div class="tp-cluster tp-rot">
        ${button('ccw', 'tp-ccw')}
        ${button('cw', 'tp-cw')}
      </div>`;
    document.body.appendChild(this.el);
    this.dpad = this.el.querySelector('.tp-dpad')!;
    this.right = [this.el.querySelector('.tp-aux')!, this.el.querySelector('.tp-rot')!];

    for (const btn of this.el.querySelectorAll<HTMLButtonElement>('.tp-btn')) {
      const action = btn.dataset.action as Action;
      let down = false;
      const release = () => {
        if (!down) return;
        down = false;
        btn.classList.remove('down');
        onAction(action, false);
      };
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        btn.setPointerCapture(e.pointerId);
        if (down) return;
        down = true;
        btn.classList.add('down');
        navigator.vibrate?.(8);
        onAction(action, true);
      });
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('lostpointercapture', release);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  /** Space the board must leave free, measured from the rendered controls. */
  insets(): Insets {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w < h * 0.9) return { top: 0, right: 0, bottom: h - this.el.getBoundingClientRect().top, left: 0 };
    const left = this.dpad.getBoundingClientRect().right;
    const right = w - Math.min(...this.right.map((c) => c.getBoundingClientRect().left));
    return { top: 0, right: right + 8, bottom: 0, left: left + 8 };
  }
}
