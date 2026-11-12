import { useMemo, useState } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { FormField, Label, TextInput } from '@dynatrace/strato-components/forms';
import { Flex } from '@dynatrace/strato-components/layouts';
import { Menu } from '@dynatrace/strato-components/navigation';
import { Modal } from '@dynatrace/strato-components/overlays';
import { Heading, Text } from '@dynatrace/strato-components/typography';
import { DotMenuIcon, PlusIcon } from '@dynatrace/strato-icons';
import { AutoFocus } from '../components/AutoFocus';
import { LINK_ICONS, LinkIcon, guessIcon } from '../components/linkIcons';
import type { ToolboxLink } from '../model/types';
import { useCortex } from '../state/store';
import { addLink, deleteLink, updateLink } from '../state/toolbox';
import '../shell/shell.css';
import './toolbox.css';

const GENERAL = 'General';

/** Adds https:// when there is no scheme; returns undefined when it is not a usable http(s) URL. */
function normalizeUrl(raw: string): string | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[^/]*:\d+(\/|$)/.test(text) ? text : `https://${text}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : undefined;
  } catch {
    return undefined;
  }
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

function Tile({ link, menu }: { link: ToolboxLink; menu?: React.ReactNode }) {
  return (
    <div className="cx-tile">
      <a className="cx-tile-link" href={link.url} target="_blank" rel="noreferrer noopener" title={link.url}>
        <span className="cx-tile-icon">
          <LinkIcon name={link.icon} />
        </span>
        <span className="cx-tile-text">
          <span className="cx-tile-label cx-ellipsis">{link.label}</span>
          <span className="cx-tile-host cx-ellipsis">{hostOf(link.url)}</span>
        </span>
      </a>
      {menu && (
        <span className="cx-tile-menu" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          {menu}
        </span>
      )}
    </div>
  );
}

/** Read-only tile grid (also used on the project overview). */
export function LinkTiles({ links }: { links: ToolboxLink[] }) {
  return (
    <div className="cx-tiles">
      {links.map((l) => (
        <Tile key={l.id} link={l} />
      ))}
    </div>
  );
}

type Draft = Omit<ToolboxLink, 'id'>;

function LinkModal({ editing, groups, onDismiss }: { editing: ToolboxLink | null; groups: string[]; onDismiss: () => void }) {
  const projects = useCortex((s) => s.projects);
  const [url, setUrl] = useState(editing?.url ?? '');
  const [label, setLabel] = useState(editing?.label ?? '');
  const [group, setGroup] = useState(editing?.group ?? '');
  const [projectId, setProjectId] = useState<string | undefined>(editing?.projectId);
  const [icon, setIcon] = useState(editing?.icon ?? 'link');
  const [iconPicked, setIconPicked] = useState(!!editing);
  const [error, setError] = useState<string>();

  const onUrl = (v: string) => {
    setUrl(v);
    setError(undefined);
    if (!iconPicked) setIcon(guessIcon(v));
  };
  const fillLabel = () => {
    const n = normalizeUrl(url);
    if (n && !label.trim()) setLabel(hostOf(n).replace(/^www\./, ''));
  };

  const save = () => {
    const n = normalizeUrl(url);
    if (!n) {
      setError('Enter a valid http(s) URL.');
      return;
    }
    const data: Draft = {
      url: n,
      label: label.trim() || hostOf(n).replace(/^www\./, ''),
      icon,
      group: group.trim() || undefined,
      projectId,
    };
    if (editing) updateLink(editing.id, data);
    else addLink(data);
    onDismiss();
  };

  return (
    <Modal title={editing ? 'Edit link' : 'Add link'} show onDismiss={onDismiss} size="small">
      <Flex flexDirection="column" gap={16}>
        <FormField>
          <Label>URL</Label>
          <AutoFocus>
            <TextInput
              placeholder="https://…"
              value={url}
              onChange={onUrl}
              onBlur={fillLabel}
              onKeyDown={(e) => e.key === 'Enter' && (fillLabel(), save())}
              controlState={error ? { state: 'error', hint: error } : undefined}
            />
          </AutoFocus>
        </FormField>
        <FormField>
          <Label>Label</Label>
          <TextInput placeholder="Defaults to the hostname" value={label} onChange={setLabel} onKeyDown={(e) => e.key === 'Enter' && save()} />
        </FormField>
        <FormField>
          <Label>Group</Label>
          <TextInput placeholder="General" value={group} onChange={setGroup} onKeyDown={(e) => e.key === 'Enter' && save()} />
        </FormField>
        {groups.length > 0 && (
          <Flex gap={4} flexWrap="wrap" alignItems="center">
            {groups.map((g) => (
              <Button key={g} size="condensed" variant={g === group.trim() ? 'accent' : 'default'} color={g === group.trim() ? 'primary' : 'neutral'} onClick={() => setGroup(g)}>
                {g}
              </Button>
            ))}
          </Flex>
        )}
        <Flex flexDirection="column" gap={4}>
          <Text textStyle="small-emphasized" className="cx-tone-neutral">
            Project (optional)
          </Text>
          <Flex gap={4} flexWrap="wrap">
            <Button size="condensed" variant={!projectId ? 'accent' : 'default'} color={!projectId ? 'primary' : 'neutral'} onClick={() => setProjectId(undefined)}>
              None
            </Button>
            {projects.map((p) => (
              <Button key={p.id} size="condensed" variant={projectId === p.id ? 'accent' : 'default'} color={projectId === p.id ? 'primary' : 'neutral'} onClick={() => setProjectId(p.id)}>
                {p.name}
              </Button>
            ))}
          </Flex>
        </Flex>
        <Flex flexDirection="column" gap={4}>
          <Text textStyle="small-emphasized" className="cx-tone-neutral">
            Icon
          </Text>
          <div className="cx-icon-grid">
            {Object.entries(LINK_ICONS).map(([key, { label: name, icon: Icon }]) => (
              <button
                key={key}
                type="button"
                className="cx-icon-pick"
                title={name}
                aria-label={name}
                aria-pressed={icon === key}
                onClick={() => {
                  setIcon(key);
                  setIconPicked(true);
                }}
              >
                <Icon />
              </button>
            ))}
          </div>
        </Flex>
        <Flex justifyContent="flex-end" gap={8}>
          <Button onClick={onDismiss}>Cancel</Button>
          <Button variant="accent" color="primary" disabled={!url.trim()} onClick={save}>
            {editing ? 'Save' : 'Add'}
          </Button>
        </Flex>
      </Flex>
    </Modal>
  );
}

export function ToolboxView() {
  const toolbox = useCortex((s) => s.toolbox);
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState<{ editing: ToolboxLink | null } | null>(null);

  const groups = useMemo(() => {
    const names = [...new Set(toolbox.map((l) => l.group?.trim()).filter((g): g is string => !!g))];
    return names;
  }, [toolbox]);

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = q ? toolbox.filter((l) => [l.label, l.url, l.group ?? GENERAL].some((t) => t.toLowerCase().includes(q))) : toolbox;
    const map = new Map<string, ToolboxLink[]>();
    for (const l of shown) {
      const g = l.group?.trim() || GENERAL;
      map.set(g, [...(map.get(g) ?? []), l]);
    }
    return [...map.entries()].sort(([a], [b]) => (a === GENERAL ? -1 : b === GENERAL ? 1 : 0));
  }, [toolbox, query]);

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <Flex flexDirection="column" gap={24} padding={24} style={{ maxWidth: 1100, margin: '0 auto' }}>
        <Flex alignItems="baseline" gap={12}>
          <Heading level={3} as="h1">
            Toolbox
          </Heading>
          <Text className="cx-tone-neutral">
            {toolbox.length} link{toolbox.length === 1 ? '' : 's'}
          </Text>
        </Flex>

        <Flex gap={8} alignItems="center">
          <div style={{ flex: 1 }}>
            <TextInput aria-label="Filter links" placeholder="Filter by label, URL or group…" value={query} onChange={setQuery} />
          </div>
          <Button variant="accent" color="primary" onClick={() => setModal({ editing: null })}>
            <Button.Prefix>
              <PlusIcon />
            </Button.Prefix>
            Add link
          </Button>
        </Flex>

        {toolbox.length === 0 && <Text className="cx-tone-neutral">No links yet. Add the pages you open every day.</Text>}
        {toolbox.length > 0 && sections.length === 0 && <Text className="cx-tone-neutral">No links match the filter.</Text>}

        {sections.map(([name, links]) => (
          <section key={name}>
            <Flex paddingBottom={8}>
              <Text textStyle="small-emphasized" className="cx-tone-neutral">
                {name}
              </Text>
            </Flex>
            <div className="cx-tiles">
              {links.map((l) => (
                <Tile
                  key={l.id}
                  link={l}
                  menu={
                    <Menu>
                      <Menu.Trigger>
                        <Button size="condensed" aria-label={`Actions for ${l.label}`}>
                          <Button.Prefix>
                            <DotMenuIcon />
                          </Button.Prefix>
                        </Button>
                      </Menu.Trigger>
                      <Menu.Content>
                        <Menu.Item onSelect={() => setModal({ editing: l })}>Edit</Menu.Item>
                        <Menu.Item onSelect={() => deleteLink(l.id)}>Delete</Menu.Item>
                      </Menu.Content>
                    </Menu>
                  }
                />
              ))}
            </div>
          </section>
        ))}
      </Flex>
      {modal && <LinkModal key={modal.editing?.id ?? 'new'} editing={modal.editing} groups={groups} onDismiss={() => setModal(null)} />}
    </div>
  );
}
