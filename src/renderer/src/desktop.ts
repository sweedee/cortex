/**
 * Side effects of new notices: an OS notification (only while the window is in the
 * background; in the foreground the bell and the badge on the bubble already say it) and a
 * chime (unless muted). Clicking an OS notification brings the window back and focuses the
 * bubble. All native access goes through `native.ts`.
 */
import { showToast } from '@dynatrace/strato-components/notifications';
import { camera } from './layout';
import type { Item, Notice } from './model';
import { native, requestNotifyPermission } from './native';
import { chimeFor, playChime } from './sound';
import { getState, itemById, onNotice, select, setDesktopNotify, setSoundOn } from './store';

function show(item: Item, notice: Notice) {
  void native.notify.desktop({ title: `Cortex · @${item.handle}`, body: notice.text, tag: `${item.id}:${notice.text}`, itemId: item.id });
}

native.notify.onClicked(({ itemId }) => {
  window.focus();
  if (!itemId || !itemById(itemId)) return;
  select([itemId]);
  camera.focus([itemId]);
});

onNotice((item, notice) => {
  const s = getState();
  if (s.soundOn) playChime(chimeFor(notice.tone));
  if (!s.desktopNotify) return;
  if (document.visibilityState === 'visible' && document.hasFocus()) return;
  show(item, notice);
});

/** Toggle from the notifications menu; the browser fallback asks for permission the first time. */
export async function toggleDesktop() {
  if (getState().desktopNotify) return setDesktopNotify(false);
  const perm = await requestNotifyPermission();
  if (perm === 'unsupported') return showToast({ type: 'warning', title: 'Desktop notifications are not supported here', lifespan: 3000 });
  if (perm !== 'granted') {
    return showToast({ type: 'warning', title: 'Desktop notifications are blocked', message: 'Allow notifications for this site in the browser settings.', lifespan: 4000 });
  }
  setDesktopNotify(true);
  show({ id: 'test', handle: 'cortex', kind: 'project', title: 'Cortex', status: [] }, { text: 'Desktop notifications are on. You get one when something needs you while Cortex is in the background.', tone: 'primary', ago: 0 });
}

/** Mute / unmute the chimes; unmuting plays one so you hear what you get. */
export function toggleSound() {
  const on = !getState().soundOn;
  setSoundOn(on);
  if (on) playChime('attention');
}
