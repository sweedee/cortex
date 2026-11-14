/** The few fixed controls around the canvas edge. */
import { useEffect, useRef, useState } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { Menu } from '@dynatrace/strato-components/navigation';
import { Tooltip } from '@dynatrace/strato-components/overlays';
import {
  CheckmarkIcon,
  DeleteIcon,
  FilterIcon,
  MinusIcon,
  NotificationActiveIcon,
  NotificationIcon,
  NotificationOffIcon,
  PlusIcon,
  ResetIcon,
  SettingIcon,
  UndoIcon,
  VolumeIcon,
  VolumeOffIcon,
  XmarkIcon,
  ZoomToFitIcon,
} from '@dynatrace/strato-icons';
import { useAppInfo } from '../data/app';
import { openSettings } from './settings';
import { toggleDesktop, toggleSound } from '../desktop';
import { camera } from '../layout';
import { asset } from '../native';
import { STATUS_GROUPS, type Item } from '../domain';
import { ArchiveIcon } from '../kinds/icons';
import { KINDS, kindIcon, kindLabel, useViews } from '../kinds/registry';
import { agoShort, TONE_COLOR } from '../tones';
import {
  activeFilterCount,
  clearNotices,
  markRead,
  resetFilter,
  select,
  setArchived,
  setColorBy,
  setFilter,
  toggleKind,
  useStore,
  useVisible,
  type ColorBy,
} from '../store';
import { accentOf, useItemColors } from '../visual';

const COLOR_BY: [ColorBy, string][] = [
  ['none', 'Gray'],
  ['project', 'Project'],
  ['ticket', 'Ticket'],
];

export function Hud() {
  const items = useStore((s) => s.items);
  const filter = useStore((s) => s.filter);
  const colorBy = useStore((s) => s.colorBy);
  const desktopNotify = useStore((s) => s.desktopNotify);
  const soundOn = useStore((s) => s.soundOn);
  const visible = useVisible();
  const [filterOpen, setFilterOpen] = useState(false);

  const notices = items
    .filter((i) => i.notice && !i.archived)
    .sort((a, b) => Number(!!a.notice!.read) - Number(!!b.notice!.read) || b.notice!.at - a.notice!.at);
  const unread = notices.filter((i) => !i.notice!.read).length;
  const nFilters = activeFilterCount(filter);
  const live = items.filter((i) => !i.archived);

  return (
    <>
      <div className="hud hud-brand">
        <img src={asset('brand/cortex-mark.svg')} alt="" width={22} height={22} />
        <div>
          <div className="hud-title">Cortex</div>
          <div className="hud-sub">canvas · experimental</div>
        </div>
      </div>

      <div className="hud hud-top-right">
        <div className="hud-colorby" role="radiogroup" aria-label="Colour bubbles by">
          <span className="hud-colorby-label">Colour</span>
          {COLOR_BY.map(([v, label]) => (
            <button key={v} role="radio" aria-checked={colorBy === v} className={`hud-colorby-opt ${colorBy === v ? 'is-on' : ''}`} onClick={() => setColorBy(v)}>
              {label}
            </button>
          ))}
        </div>
        <Menu>
          <Menu.Trigger>
            <Button variant="default" aria-label={`Notifications, ${unread} unread`} className="hud-bell">
              <Button.Prefix>{unread ? <NotificationActiveIcon /> : <NotificationIcon />}</Button.Prefix>
              {unread > 0 && <span className="hud-bell-count">{unread}</span>}
            </Button>
          </Menu.Trigger>
          <Menu.Content side="bottom" alignment="end">
            <Menu.Group>
              <Menu.Label>{unread ? `${unread} unread` : 'Notifications'}</Menu.Label>
              {notices.length === 0 && (
                <Menu.Item disabled onSelect={() => {}}>
                  All caught up
                </Menu.Item>
              )}
              {notices.map((i) => (
                <Menu.Item
                  key={i.id}
                  className={i.notice!.read ? 'notice-read' : undefined}
                  onSelect={() => {
                    camera.focus([i.id]);
                    select([i.id]);
                  }}
                >
                  <Menu.Prefix>
                    <span className="notice-dot" style={{ background: i.notice!.read ? 'transparent' : TONE_COLOR[i.notice!.tone], borderColor: TONE_COLOR[i.notice!.tone] }} />
                  </Menu.Prefix>
                  <span className="notice-item">
                    <span className="notice-item-handle">@{i.handle}</span>
                    <span>{i.notice!.text}</span>
                  </span>
                  <Menu.Suffix>
                    <span className="notice-ago">{agoShort(i.notice!.at)}</span>
                  </Menu.Suffix>
                </Menu.Item>
              ))}
            </Menu.Group>
            <Menu.Group>
              <Menu.Item disabled={!unread} onSelect={() => markRead()}>
                <Menu.Prefix>
                  <CheckmarkIcon />
                </Menu.Prefix>
                Mark all as read
              </Menu.Item>
              <Menu.Item disabled={!notices.length} onSelect={() => clearNotices()}>
                <Menu.Prefix>
                  <DeleteIcon />
                </Menu.Prefix>
                Clear all
              </Menu.Item>
              <Menu.Item onSelect={() => void toggleDesktop()}>
                <Menu.Prefix>{desktopNotify ? <NotificationActiveIcon /> : <NotificationOffIcon />}</Menu.Prefix>
                Desktop notifications
                <Menu.Suffix>
                  <span className={`menu-toggle ${desktopNotify ? 'is-on' : ''}`}>{desktopNotify ? 'On' : 'Off'}</span>
                </Menu.Suffix>
              </Menu.Item>
              <Menu.Item onSelect={() => toggleSound()}>
                <Menu.Prefix>{soundOn ? <VolumeIcon /> : <VolumeOffIcon />}</Menu.Prefix>
                Sound
                <Menu.Suffix>
                  <span className={`menu-toggle ${soundOn ? 'is-on' : ''}`}>{soundOn ? 'On' : 'Muted'}</span>
                </Menu.Suffix>
              </Menu.Item>
            </Menu.Group>
            <AppVersion />
          </Menu.Content>
        </Menu>
        <Tooltip text="Settings">
          <Button variant="default" aria-label="Settings" className="hud-bell" onClick={() => void openSettings()}>
            <Button.Prefix>
              <SettingIcon />
            </Button.Prefix>
          </Button>
        </Tooltip>
      </div>

      <div className="hud hud-legend" role="toolbar" aria-label="Filter bubbles">
        <Tooltip text="Filter by type, status, project…">
          <button className={`legend-item legend-filter ${filterOpen ? 'is-open' : ''} ${nFilters ? 'is-active' : ''}`} onClick={() => setFilterOpen((o) => !o)} aria-expanded={filterOpen}>
            <FilterIcon />
            <span>Filter</span>
            {nFilters > 0 && <span className="legend-badge">{nFilters}</span>}
          </button>
        </Tooltip>
        <span className="legend-sep" />
        {KINDS.map((k) => {
          const n = live.filter((i) => i.kind === k).length;
          const off = filter.hiddenKinds.includes(k);
          // 11 kinds: the legend only lists the ones on the canvas (the filter panel has all)
          if (!n && !off) return null;
          return (
            <Tooltip key={k} text={`${off ? 'Show' : 'Hide'} ${kindLabel(k).toLowerCase()}s`}>
              <button className={`legend-item ${off ? 'is-off' : ''}`} onClick={() => toggleKind(k)}>
                {kindIcon(k, 14)}
                <span>{n}</span>
              </button>
            </Tooltip>
          );
        })}
        {nFilters > 0 && (
          <span className="legend-shown">
            {visible.size} of {live.length}
            <button className="legend-clear" onClick={resetFilter} aria-label="Clear filters">
              <XmarkIcon />
            </button>
          </span>
        )}
      </div>
      {filterOpen && <FilterPanel onClose={() => setFilterOpen(false)} />}

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

/** Footer of the notifications menu: which build is running (via the `useAppInfo` query). */
function AppVersion() {
  const { data } = useAppInfo();
  if (!data) return null;
  return (
    <Menu.Group>
      <Menu.Label>
        Cortex {data.version}
        {data.electron ? ` · Electron ${data.electron}` : ''} · {data.platform}
      </Menu.Label>
    </Menu.Group>
  );
}

/** Filter popover above the legend: text, type, status, project, notifications, archive. */
function FilterPanel({ onClose }: { onClose: () => void }) {
  const items = useStore((s) => s.items);
  const f = useStore((s) => s.filter);
  const colors = useItemColors();
  const views = useViews();
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!ref.current?.contains(t) && !t.closest('.legend-filter')) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', down);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);

  const live = items.filter((i) => !i.archived);
  const archived = items.filter((i) => i.archived);
  const projects = items.filter((i) => i.kind === 'project' && !i.archived);
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const unread = live.filter((i) => i.notice && !i.notice.read).length;

  const reveal = (it: Item) => {
    setFilter({ showArchived: true });
    select([it.id]);
    camera.focus([it.id]);
  };

  return (
    <div className="hud filter-panel" ref={ref} role="dialog" aria-label="Filter bubbles">
      <div className="filter-head">
        <span className="filter-title">Filter</span>
        <button className="filter-reset" onClick={resetFilter} disabled={!activeFilterCount(f)}>
          <ResetIcon /> Reset
        </button>
      </div>

      <input
        ref={input}
        className="filter-search"
        value={f.query}
        onChange={(e) => setFilter({ query: e.target.value })}
        placeholder="Name, key, branch…"
        spellCheck={false}
        aria-label="Filter by text"
      />

      <div className="filter-label">Type</div>
      <div className="filter-chips">
        {KINDS.map((k) => {
          const on = !f.hiddenKinds.includes(k);
          return (
            <button key={k} className={`filter-chip ${on ? 'is-on' : ''}`} aria-pressed={on} onClick={() => toggleKind(k)}>
              {kindIcon(k, 13)}
              {kindLabel(k)}
              <span className="filter-n">{live.filter((i) => i.kind === k).length}</span>
            </button>
          );
        })}
      </div>

      <div className="filter-label">Status {f.status.length === 0 && <span className="filter-any">any</span>}</div>
      <div className="filter-chips">
        {STATUS_GROUPS.map((g) => {
          const on = f.status.includes(g.id);
          const n = live.filter((i) => g.test(views.get(i.id)?.ring ?? [])).length;
          return (
            <button key={g.id} className={`filter-chip ${on ? 'is-on' : ''}`} aria-pressed={on} disabled={!n && !on} onClick={() => setFilter({ status: toggle(f.status, g.id) })}>
              <span className="filter-dot" style={{ background: TONE_COLOR[g.tone] }} />
              {g.label}
              <span className="filter-n">{n}</span>
            </button>
          );
        })}
      </div>

      <div className="filter-label">Project {f.projects.length === 0 && <span className="filter-any">any</span>}</div>
      <div className="filter-chips">
        {projects.map((p) => {
          const on = f.projects.includes(p.id);
          return (
            <button key={p.id} className={`filter-chip ${on ? 'is-on' : ''}`} aria-pressed={on} onClick={() => setFilter({ projects: toggle(f.projects, p.id) })}>
              <span className="filter-dot" style={{ background: accentOf(colors, p.id) }} />
              {p.title}
            </button>
          );
        })}
      </div>

      <div className="filter-label">Show</div>
      <label className="filter-check">
        <input type="checkbox" checked={f.unreadOnly} onChange={(e) => setFilter({ unreadOnly: e.target.checked })} />
        Only with unread notifications <span className="filter-n">{unread}</span>
      </label>
      <label className="filter-check">
        <input type="checkbox" checked={f.showArchived} onChange={(e) => setFilter({ showArchived: e.target.checked })} />
        Archived items on the canvas <span className="filter-n">{archived.length}</span>
      </label>

      {archived.length > 0 && (
        <>
          <div className="filter-label">
            <ArchiveIcon size={12} /> Archive
          </div>
          <div className="filter-archive">
            {archived.map((a) => (
              <div key={a.id} className="archive-row">
                <button className="archive-main" onClick={() => reveal(a)} title="Show on the canvas">
                  <span className="rel-row-icon" style={{ ['--accent' as string]: accentOf(colors, a.id) }}>
                    {kindIcon(a.kind, 12)}
                  </span>
                  <span className="archive-text">
                    <span className="archive-handle">{a.handle}</span>
                    <span className="archive-title">{a.title}</span>
                  </span>
                </button>
                <Tooltip text="Unarchive">
                  <button className="archive-restore" onClick={() => setArchived([a.id], false)} aria-label={`Unarchive ${a.handle}`}>
                    <UndoIcon />
                  </button>
                </Tooltip>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
