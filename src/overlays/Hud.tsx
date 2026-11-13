/** The few fixed controls around the canvas edge. */
import { Button } from '@dynatrace/strato-components/buttons';
import { Menu } from '@dynatrace/strato-components/navigation';
import { Tooltip } from '@dynatrace/strato-components/overlays';
import { MinusIcon, NotificationActiveIcon, NotificationIcon, PlusIcon, ZoomToFitIcon } from '@dynatrace/strato-icons';
import { camera } from '../layout';
import { KIND_LABEL, type Kind } from '../model';
import { select, toggleKind, useStore } from '../store';
import { KIND_ACCENT, KIND_ICON, TONE_COLOR } from '../visual';

const KINDS: Kind[] = ['project', 'ticket', 'worktree', 'agent', 'pr', 'build', 'plan'];
const ago = (m: number) => (m < 60 ? `${m}m` : `${Math.round(m / 60)}h`);

export function Hud() {
  const items = useStore((s) => s.items);
  const hidden = useStore((s) => s.hiddenKinds);
  const notices = items.filter((i) => i.notice).sort((a, b) => a.notice!.ago - b.notice!.ago);

  return (
    <>
      <div className="hud hud-brand">
        <img src="/brand/cortex-mark.svg" alt="" width={22} height={22} />
        <div>
          <div className="hud-title">Cortex</div>
          <div className="hud-sub">canvas · experimental</div>
        </div>
      </div>

      <div className="hud hud-top-right">
        <Menu>
          <Menu.Trigger>
            <Button variant="default" aria-label="Notifications" className="hud-bell">
              <Button.Prefix>{notices.length ? <NotificationActiveIcon /> : <NotificationIcon />}</Button.Prefix>
              {notices.length > 0 && <span className="hud-bell-count">{notices.length}</span>}
            </Button>
          </Menu.Trigger>
          <Menu.Content side="bottom" alignment="end">
            <Menu.Group>
              <Menu.Label>Needs your attention</Menu.Label>
              {notices.length === 0 && <Menu.Item disabled onSelect={() => {}}>All caught up</Menu.Item>}
              {notices.map((i) => (
                <Menu.Item
                  key={i.id}
                  onSelect={() => {
                    camera.focus([i.id]);
                    select([i.id]);
                  }}
                >
                  <Menu.Prefix>
                    <span className="notice-dot" style={{ background: TONE_COLOR[i.notice!.tone] }} />
                  </Menu.Prefix>
                  <span className="notice-item">
                    <span className="notice-item-handle">@{i.handle}</span>
                    <span>{i.notice!.text}</span>
                  </span>
                  <Menu.Suffix>
                    <span className="notice-ago">{ago(i.notice!.ago)}</span>
                  </Menu.Suffix>
                </Menu.Item>
              ))}
            </Menu.Group>
          </Menu.Content>
        </Menu>
      </div>

      <div className="hud hud-legend" role="toolbar" aria-label="Show or hide bubble types">
        {KINDS.map((k) => {
          const n = items.filter((i) => i.kind === k).length;
          const off = hidden.includes(k);
          return (
            <Tooltip key={k} text={`${off ? 'Show' : 'Hide'} ${KIND_LABEL[k].toLowerCase()}s`}>
              <button className={`legend-item ${off ? 'is-off' : ''}`} style={{ ['--accent' as string]: KIND_ACCENT[k] }} onClick={() => toggleKind(k)}>
                {KIND_ICON[k](14)}
                <span>{n}</span>
              </button>
            </Tooltip>
          );
        })}
      </div>

      <div className="hud hud-zoom">
        <Tooltip text="Zoom out">
          <Button variant="default" size="condensed" onClick={() => camera.zoom(1 / 1.25)} aria-label="Zoom out">
            <Button.Prefix>
              <MinusIcon />
            </Button.Prefix>
          </Button>
        </Tooltip>
        <Tooltip text="Fit everything (F)">
          <Button variant="default" size="condensed" onClick={() => camera.fit()} aria-label="Fit everything">
            <Button.Prefix>
              <ZoomToFitIcon />
            </Button.Prefix>
          </Button>
        </Tooltip>
        <Tooltip text="Zoom in">
          <Button variant="default" size="condensed" onClick={() => camera.zoom(1.25)} aria-label="Zoom in">
            <Button.Prefix>
              <PlusIcon />
            </Button.Prefix>
          </Button>
        </Tooltip>
      </div>
    </>
  );
}
