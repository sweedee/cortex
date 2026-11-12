import { useEffect, useRef } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { dismissToast, showToast, ToastContainer } from '@dynatrace/strato-components/notifications';
import type { CortexNotification, NotificationTone } from '../model/types';
import { openNotification } from '../state/actions';
import { showDesktopNotification } from '../state/notifications';
import { useCortex } from '../state/store';

const TOAST_TYPE: Record<NotificationTone, 'info' | 'warning' | 'critical' | 'success'> = {
  success: 'success',
  warning: 'warning',
  critical: 'critical',
  primary: 'info',
  neutral: 'info',
};

/** A burst of events shows this many toasts; the rest is one summary (all of them are in the bell). */
const MAX_TOASTS = 2;
const LIFESPAN_MS = 9000;

/**
 * Shows a toast (and, if switched on and the window is in the background, a desktop notification) for every
 * notification that is added to the store while the app runs. Notifications that were already stored
 * (restored from localStorage) are not announced again.
 */
export function NotificationToasts() {
  const list = useCortex((s) => s.notifications);
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Set(list.map((n) => n.id));
      return;
    }
    const fresh: CortexNotification[] = list.filter((n) => !seen.current!.has(n.id));
    if (fresh.length === 0) return;
    fresh.forEach((n) => seen.current!.add(n.id));

    // newest first in the list; show the most recent ones
    fresh.slice(0, MAX_TOASTS).forEach((n) => {
      showToast({
        id: n.id,
        type: TOAST_TYPE[n.tone],
        title: n.title,
        message: [n.subject, n.detail].filter(Boolean).join(' · ') || undefined,
        lifespan: LIFESPAN_MS,
        position: 'bottom-right',
        actions: (
          <Button
            size="condensed"
            onClick={() => {
              openNotification(n.id);
              dismissToast(n.id);
            }}
          >
            Open
          </Button>
        ),
      });
    });
    if (fresh.length > MAX_TOASTS) {
      showToast({ type: 'info', title: `${fresh.length - MAX_TOASTS} more notifications`, message: 'See the bell in the sidebar.', lifespan: LIFESPAN_MS, position: 'bottom-right' });
    }
    fresh.slice(0, MAX_TOASTS).forEach((n) => showDesktopNotification(n, () => openNotification(n.id)));
  }, [list]);

  return <ToastContainer />;
}
