import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { Switch } from '@dynatrace/strato-components/forms';
import { Flex } from '@dynatrace/strato-components/layouts';
import { Overlay, useOverlayWithTrigger } from '@dynatrace/strato-components/overlays';
import { Heading, Text } from '@dynatrace/strato-components/typography';
import { CheckmarkIcon, CriticalIcon, InformationIcon, NotificationActiveIcon, NotificationIcon, WarningIcon } from '@dynatrace/strato-icons';
import type { CortexNotification, NotificationTone } from '../model/types';
import { openNotification } from '../state/actions';
import { relativeTime } from '../state/derive';
import { clearNotifications, desktopEnabled, desktopSupported, markAllNotificationsRead, setDesktopEnabled } from '../state/notifications';
import { useCortex } from '../state/store';

const TONE_ICON: Record<NotificationTone, ReactNode> = {
  success: <CheckmarkIcon />,
  warning: <WarningIcon />,
  critical: <CriticalIcon />,
  primary: <InformationIcon />,
  neutral: <InformationIcon />,
};

/** "Today" / "Yesterday" / "Earlier", by calendar day. */
function dayLabel(iso: string): string {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(new Date(iso))) / 86_400_000);
  return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : 'Earlier';
}

function Row({ n, onOpen }: { n: CortexNotification; onOpen: () => void }) {
  return (
    <button type="button" className="cx-nt-row" data-unread={!n.read || undefined} onClick={onOpen}>
      <span className={`cx-nt-icon cx-tone-${n.tone}`}>{TONE_ICON[n.tone]}</span>
      <span className="cx-nt-body">
        <span className="cx-nt-line">
          <Text textStyle="base-emphasized" className="cx-ellipsis">
            {n.title}
          </Text>
          <Text textStyle="small" className="cx-tone-neutral cx-nt-time">
            {relativeTime(n.at)}
          </Text>
        </span>
        <Text textStyle="small" className="cx-tone-neutral cx-ellipsis" style={{ display: 'block' }}>
          {[n.subject, n.detail].filter(Boolean).join(' · ')}
        </Text>
      </span>
      <span className="cx-nt-dot" aria-label={n.read ? undefined : 'Unread'} />
    </button>
  );
}

/** Opt-in browser notifications: asks for permission only when switched on. Renders nothing where the API is missing. */
function DesktopToggle() {
  const [on, setOn] = useState(desktopEnabled);
  const [blocked, setBlocked] = useState(false);
  if (!desktopSupported()) return null;
  return (
    <div className="cx-nt-desktop">
      <Switch
        value={on}
        onChange={(v) => {
          void setDesktopEnabled(v).then((now) => {
            setOn(now);
            setBlocked(v && !now);
          });
        }}
      >
        Desktop notifications
      </Switch>
      <Text textStyle="small" className={blocked ? 'cx-tone-warning' : 'cx-tone-neutral'}>
        {blocked ? 'The browser blocked them. Allow notifications for this site first.' : 'Shown by your browser while this window is not in focus.'}
      </Text>
    </div>
  );
}

function Panel({ onClose }: { onClose: () => void }) {
  const list = useCortex((s) => s.notifications);
  const unread = list.filter((n) => !n.read).length;

  const groups: { label: string; items: CortexNotification[] }[] = [];
  for (const n of list) {
    const label = dayLabel(n.at);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(n);
    else groups.push({ label, items: [n] });
  }

  return (
    <div className="cx-nt-panel" role="dialog" aria-label="Notifications">
      <Flex alignItems="center" gap={8} className="cx-nt-head">
        <Heading level={6} as="h2">
          Notifications
        </Heading>
        {unread > 0 && (
          <Text textStyle="small" className="cx-tone-neutral">
            {unread} unread
          </Text>
        )}
        <span style={{ marginLeft: 'auto' }} />
        <Button size="condensed" disabled={unread === 0} onClick={markAllNotificationsRead}>
          Mark all read
        </Button>
        <Button size="condensed" disabled={list.length === 0} onClick={clearNotifications}>
          Clear
        </Button>
      </Flex>
      <div className="cx-nt-list">
        {list.length === 0 ? (
          <div className="cx-nt-empty">
            <NotificationIcon />
            <Text textStyle="base-emphasized">You are all caught up</Text>
            <Text textStyle="small" className="cx-tone-neutral">
              Failed builds, reviews on your PRs and Claude asking for input will show up here.
            </Text>
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.label}>
              <div className="cx-group-label cx-nt-group">{g.label}</div>
              {g.items.map((n) => (
                <Row
                  key={n.id}
                  n={n}
                  onOpen={() => {
                    openNotification(n.id);
                    onClose();
                  }}
                />
              ))}
            </div>
          ))
        )}
      </div>
      <DesktopToggle />
    </div>
  );
}

/** The bell in the sidebar header: unread badge, and the notification list in an overlay under it. */
export function NotificationBell() {
  const unread = useCortex((s) => s.notifications).filter((n) => !n.read).length;
  const { overlayState, overlayProps, overlayContainerProps, overlayTriggerProps, overlayRef, triggerRef, targetRef } = useOverlayWithTrigger({
    placement: 'bottom-end',
    placementFallbacks: ['bottom-start', 'bottom'],
    offset: 4,
    shouldCloseOnBlur: false,
  });
  const open = overlayState.isOpen;
  // keep the "x ago" labels honest while the panel is open
  const [, tick] = useState(0);
  useEffect(() => {
    if (!open) return;
    const t = window.setInterval(() => tick((x) => x + 1), 30_000);
    return () => window.clearInterval(t);
  }, [open]);

  return (
    <>
      <span
        className="cx-nt-bell"
        ref={(el) => {
          triggerRef(el);
          // the panel hangs from the whole sidebar header, so it stays inside the sidebar
          targetRef(el?.closest<HTMLElement>('.cx-sb-head') ?? el);
        }}
      >
        <Button size="condensed" aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'} {...overlayTriggerProps}>
          <Button.Prefix>{unread > 0 ? <NotificationActiveIcon /> : <NotificationIcon />}</Button.Prefix>
        </Button>
        {unread > 0 && (
          <span className="cx-nt-badge" aria-hidden>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </span>
      <Overlay isOpen={open} overlayProps={overlayProps} overlayContainerProps={overlayContainerProps} ref={overlayRef}>
        <Panel onClose={overlayState.close} />
      </Overlay>
    </>
  );
}
