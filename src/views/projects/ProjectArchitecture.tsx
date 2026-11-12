import { useEffect, useRef, useState } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { TextInput } from '@dynatrace/strato-components/forms';
import { Menu } from '@dynatrace/strato-components/navigation';
import { Heading, Text } from '@dynatrace/strato-components/typography';
import { ChevronDownIcon, CopyIcon, DeleteIcon, PlusIcon } from '@dynatrace/strato-icons';
import { AutoFocus } from '../../components/AutoFocus';
import { Mermaid } from '../../components/Mermaid';
import type { Diagram, Project } from '../../model/types';
import { relativeTime } from '../../state/derive';
import { addDiagram, deleteDiagram, updateDiagram } from '../../state/projects';
import '../../shell/shell.css';
import './architecture.css';

const TEMPLATES: { label: string; title: string; source: string }[] = [
  {
    label: 'Flowchart of components',
    title: 'Component overview',
    source: `flowchart LR
  client[Client] --> api[API]
  api --> service[Service]
  service --> db[(Database)]
  service --> queue[[Queue]]
  queue --> worker[Worker]
`,
  },
  {
    label: 'Sequence diagram',
    title: 'Request sequence',
    source: `sequenceDiagram
  participant C as Client
  participant A as API
  participant S as Service
  C->>A: Request
  A->>S: Handle
  S-->>A: Result
  A-->>C: Response
`,
  },
  {
    label: 'Container graph (C4-ish)',
    title: 'Containers',
    source: `flowchart TB
  user([User])
  subgraph system[System boundary]
    web[Web app]
    api[API service]
    db[(Database)]
  end
  ext[External system]
  user --> web
  web --> api
  api --> db
  api --> ext
`,
  },
  {
    label: 'ER diagram',
    title: 'Data model',
    source: `erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE_ITEM : contains
  CUSTOMER {
    string id
    string name
  }
  ORDER {
    string id
    date createdAt
  }
`,
  },
];

function DiagramEditor({ projectId, diagram }: { projectId: string; diagram: Diagram }) {
  // keyed by diagram id by the parent, so local state starts fresh per diagram
  const [source, setSource] = useState(diagram.source);
  const [showEditor, setShowEditor] = useState(diagram.source.trim() === '');
  const [title, setTitle] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const pending = useRef<string | null>(null);

  const flush = () => {
    clearTimeout(timer.current);
    if (pending.current !== null) updateDiagram(projectId, diagram.id, { source: pending.current });
    pending.current = null;
  };
  // write out any unsaved typing when switching diagram / unmounting
  useEffect(() => flush, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onSource = (v: string) => {
    setSource(v);
    pending.current = v;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 300);
  };

  const commitTitle = () => {
    if (title !== null && title.trim() && title.trim() !== diagram.title) updateDiagram(projectId, diagram.id, { title: title.trim() });
    setTitle(null);
  };

  const remove = () => {
    if (!window.confirm(`Delete diagram "${diagram.title}"?`)) return;
    pending.current = null;
    clearTimeout(timer.current);
    deleteDiagram(projectId, diagram.id);
  };

  return (
    <div className="cx-ar-main">
      <div className="cx-ar-bar">
        {title !== null ? (
          <AutoFocus style={{ flex: 1, minWidth: 0 }}>
            <TextInput
              aria-label="Diagram title"
              value={title}
              onChange={setTitle}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitTitle();
                if (e.key === 'Escape') setTitle(null);
              }}
            />
          </AutoFocus>
        ) : (
          <Text className="cx-ar-title cx-ellipsis" title="Click to edit" onClick={() => setTitle(diagram.title)}>
            {diagram.title}
          </Text>
        )}
        <Button size="condensed" onClick={() => setShowEditor((v) => !v)}>
          {showEditor ? 'Hide editor' : 'Edit source'}
        </Button>
        <Button size="condensed" onClick={() => void navigator.clipboard?.writeText(source)}>
          <Button.Prefix>
            <CopyIcon />
          </Button.Prefix>
          Copy source
        </Button>
        <Button size="condensed" aria-label="Delete diagram" onClick={remove}>
          <Button.Prefix>
            <DeleteIcon />
          </Button.Prefix>
          Delete
        </Button>
      </div>
      <div className="cx-ar-split">
        {showEditor && (
          <textarea
            className="cx-ar-src"
            aria-label="Mermaid source"
            spellCheck={false}
            value={source}
            onChange={(e) => onSource(e.target.value)}
          />
        )}
        <div className="cx-ar-preview">
          <Mermaid source={source} />
        </div>
      </div>
    </div>
  );
}

export function ProjectArchitecture({ project }: { project: Project }) {
  const [selected, setSelected] = useState<string | undefined>();
  const diagram = project.diagrams.find((d) => d.id === selected) ?? project.diagrams[0];

  const create = (t: (typeof TEMPLATES)[number]) => setSelected(addDiagram(project.id, t.title, t.source));

  const newMenu = (
    <Menu>
      <Menu.Trigger>
        <Button variant="accent" color="primary" size="condensed">
          <Button.Prefix>
            <PlusIcon />
          </Button.Prefix>
          New diagram
          <Button.Suffix>
            <ChevronDownIcon />
          </Button.Suffix>
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        {TEMPLATES.map((t) => (
          <Menu.Item key={t.label} onSelect={() => create(t)}>
            {t.label}
          </Menu.Item>
        ))}
      </Menu.Content>
    </Menu>
  );

  return (
    <div className="cx-ar">
      <aside className="cx-ar-list">
        <div className="cx-ar-list-head">{newMenu}</div>
        <div className="cx-ar-list-body">
          {project.diagrams.map((d) => (
            <button key={d.id} type="button" className="cx-ar-row" aria-current={d.id === diagram?.id} onClick={() => setSelected(d.id)}>
              <Text className="cx-ellipsis" style={{ maxWidth: '100%' }}>
                {d.title}
              </Text>
              <Text textStyle="small" className="cx-tone-neutral">
                {relativeTime(d.updatedAt)}
              </Text>
            </button>
          ))}
        </div>
      </aside>
      {diagram ? (
        <DiagramEditor key={diagram.id} projectId={project.id} diagram={diagram} />
      ) : (
        <div className="cx-ar-empty">
          <Heading level={5}>No diagrams yet</Heading>
          <Text className="cx-tone-neutral">Sketch the architecture in Mermaid. Pick a template to start.</Text>
          {newMenu}
        </div>
      )}
    </div>
  );
}
