/**
 * OS notifications for new notices. Only fired while the tab is in the background (in the
 * foreground the bell and the badge on the bubble already say it); clicking one brings
 * the tab back and focuses the bubble.
 */
import { showToast } from '@dynatrace/strato-components/notifications';
import { camera } from './layout';
import type { Item, Notice } from './model';
import { getState, onNotice, select, setDesktopNotify } from './store';

export const desktopSupported = () => typeof window !== 'undefined' && 'Notification' in window;

function show(item: Item, notice: Notice) {
  const n = new Notification(`Cortex · @${item.handle}`, { body: notice.text, icon: '/brand/cortex-mark.svg', tag: `${item.id}:${notice.text}` });
  n.onclick = () => {
    window.focus();
    select([item.id]);
    camera.focus([item.id]);
    n.close();
  };
}

onNotice((item, notice) => {
  if (!getState().desktopNotify || !desktopSupported() || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible' && document.hasFocus()) return;
  show(item, notice);
});

/** Toggle from the notifications menu; asks for permission the first time. */
export async function toggleDesktop() {
  if (getState().desktopNotify) return setDesktopNotify(false);
  if (!desktopSupported()) return showToast({ type: 'warning', title: 'Desktop notifications are not supported here', lifespan: 3000 });
  const perm = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  if (perm !== 'granted') {
    return showToast({ type: 'warning', title: 'Desktop notifications are blocked', message: 'Allow notifications for this site in the browser settings.', lifespan: 4000 });
  }
  setDesktopNotify(true);
  show({ id: 'test', handle: 'cortex', kind: 'project', title: 'Cortex', status: [] }, { text: 'Desktop notifications are on. You get one when something needs you while Cortex is in the background.', tone: 'primary', ago: 0 });
}
