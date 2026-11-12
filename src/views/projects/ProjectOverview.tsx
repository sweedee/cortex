import { useMemo, useState, type ReactNode } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { Chip } from '@dynatrace/strato-components/content';
import { FormField, Label, NumberInput, TextInput } from '@dynatrace/strato-components/forms';
import { Flex } from '@dynatrace/strato-components/layouts';
import { Modal } from '@dynatrace/strato-components/overlays';
import { Heading, Text } from '@dynatrace/strato-components/typography';
import { DeleteIcon, ExternalLinkIcon, PlusIcon } from '@dynatrace/strato-icons';
import type { Project, Ticket } from '../../model/types';
import { deleteProject, updateProject } from '../../state/projects';
import { useCortex } from '../../state/store';
import { openToolbox } from '../../state/toolbox';
import { LinkTiles } from '../ToolboxView';
import './projects.css';
import '../../shell/shell.css';

interface Draft {
  name: string;
  description: string;
  owner: string;
  repo: string;
  baseBranch: string;
  localPath: string;
  worktreeRoot: string;
  startCommand: string;
  port: number | null;
  projectKey: string;
  labels: string;
  ticketKeys: string[];
}

const toDraft = (p: Project): Draft => ({
  name: p.name,
  description: p.description ?? '',
  owner: p.github.owner,
  repo: p.github.repo,
  baseBranch: p.baseBranch,
  localPath: p.localPath,
  worktreeRoot: p.worktreeRoot,
  startCommand: p.startCommand,
  port: p.port ?? null,
  projectKey: p.jira.projectKey,
  labels: p.jira.labels.join(', '),
  ticketKeys: p.jira.ticketKeys,
});

const splitLabels = (s: string) => s.split(',').map((l) => l.trim()).filter(Boolean);
const KEY = /^[A-Z][A-Z0-9]+-\d+$/;

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'cx-pj-wide' : undefined}>
      <FormField>
        <Label>{label}</Label>
        {children}
      </FormField>
    </div>
  );
}

export function ProjectOverview({ project }: { project: Project }) {
  const saved = useMemo(() => toDraft(project), [project]);
  const [draft, setDraft] = useState<Draft>(saved);
  const [newKey, setNewKey] = useState('');
  const [keyError, setKeyError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const work = useCortex((s) => s.work);
  const backlog = useCortex((s) => s.backlog);
  const links = useCortex((s) => s.toolbox).filter((l) => l.projectId === project.id);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const text = (k: keyof Draft) => ({ value: draft[k] as string, onChange: (v: string) => set(k, v as never) });

  const save = () => {
    updateProject(project.id, {
      name: draft.name.trim() || project.id,
      description: draft.description.trim() || undefined,
      github: { owner: draft.owner.trim(), repo: draft.repo.trim() },
      baseBranch: draft.baseBranch.trim(),
      localPath: draft.localPath.trim(),
      worktreeRoot: draft.worktreeRoot.trim(),
      startCommand: draft.startCommand.trim(),
      port: draft.port ?? undefined,
      jira: { projectKey: draft.projectKey.trim().toUpperCase(), labels: splitLabels(draft.labels), ticketKeys: draft.ticketKeys },
    });
  };

  const addKey = () => {
    const key = newKey.trim().toUpperCase();
    if (!key) return;
    if (!KEY.test(key)) return setKeyError('Use the format ABC-123');
    if (draft.ticketKeys.includes(key)) return setKeyError(`${key} is already linked`);
    set('ticketKeys', [...draft.ticketKeys, key]);
    setNewKey('');
    setKeyError('');
  };

  const known = (key: string): Ticket | undefined => work.find((w) => w.ticket?.key === key)?.ticket ?? backlog.find((t) => t.key === key);
  const onBoard = work.filter((w) => w.repo === project.id).length;

  return (
    <div className="cx-pj-scroll">
      <div className="cx-pj-page">
        <section className="cx-pj-section">
          <Heading level={5} as="h2">
            General
          </Heading>
          <div className="cx-pj-form">
            <Field label="Name">
              <TextInput {...text('name')} />
            </Field>
            <Field label="Description" wide>
              <TextInput {...text('description')} />
            </Field>
          </div>
        </section>

        <section className="cx-pj-section">
          <Flex alignItems="center" gap={12}>
            <Heading level={5} as="h2">
              GitHub
            </Heading>
            <a href={`https://github.com/${draft.owner}/${draft.repo}`} target="_blank" rel="noreferrer" className="cx-tone-primary">
              Open on GitHub <ExternalLinkIcon size="small" />
            </a>
          </Flex>
          <div className="cx-pj-form">
            <Field label="Owner">
              <TextInput {...text('owner')} />
            </Field>
            <Field label="Repository">
              <TextInput {...text('repo')} />
            </Field>
            <Field label="Base branch">
              <TextInput {...text('baseBranch')} />
            </Field>
          </div>
        </section>

        <section className="cx-pj-section">
          <Heading level={5} as="h2">
            Local
          </Heading>
          <div className="cx-pj-form">
            <Field label="Main checkout path">
              <TextInput {...text('localPath')} />
            </Field>
            <Field label="Worktree root">
              <TextInput {...text('worktreeRoot')} />
            </Field>
            <Field label="Start command">
              <TextInput {...text('startCommand')} />
            </Field>
            <Field label="Port (optional)">
              <NumberInput value={draft.port} onChange={(v) => set('port', v ?? null)} />
            </Field>
          </div>
        </section>

        <section className="cx-pj-section">
          <Heading level={5} as="h2">
            Jira
          </Heading>
          <div className="cx-pj-form">
            <Field label="Project key">
              <TextInput {...text('projectKey')} />
            </Field>
            <Field label="Labels (comma separated)">
              <TextInput {...text('labels')} />
            </Field>
          </div>
          <Text textStyle="small-emphasized" className="cx-tone-neutral">
            Linked tickets
          </Text>
          <div>
            {draft.ticketKeys.length === 0 && <Text className="cx-tone-neutral">No tickets linked by hand.</Text>}
            {draft.ticketKeys.map((key) => {
              const t = known(key);
              return (
                <div key={key} className="cx-pj-ticketrow">
                  <Text className="cx-mono">{key}</Text>
                  <Text className={`cx-ellipsis${t ? '' : ' cx-tone-neutral'}`}>{t ? t.summary : 'Not loaded'}</Text>
                  {t ? <Chip size="condensed">{t.status}</Chip> : <span />}
                  <Button
                    size="condensed"
                    aria-label={`Remove ${key}`}
                    onClick={() => set('ticketKeys', draft.ticketKeys.filter((k) => k !== key))}
                  >
                    <Button.Prefix>
                      <DeleteIcon />
                    </Button.Prefix>
                  </Button>
                </div>
              );
            })}
          </div>
          <Flex gap={8} alignItems="center">
            <TextInput
              aria-label="Link ticket"
              placeholder="ABC-123 (Enter to add)"
              value={newKey}
              onChange={(v) => {
                setNewKey(v.toUpperCase());
                setKeyError('');
              }}
              onKeyDown={(e) => e.key === 'Enter' && addKey()}
              style={{ width: 220 }}
            />
            <Button size="condensed" disabled={!newKey.trim()} onClick={addKey}>
              <Button.Prefix>
                <PlusIcon />
              </Button.Prefix>
              Link
            </Button>
            {keyError && (
              <Text textStyle="small" className="cx-tone-critical" role="alert">
                {keyError}
              </Text>
            )}
          </Flex>
        </section>

        <section className="cx-pj-section">
          <Flex alignItems="center" gap={12}>
            <Heading level={5} as="h2">
              Links
            </Heading>
            <Button size="condensed" onClick={openToolbox}>
              Open toolbox
            </Button>
          </Flex>
          {links.length === 0 ? (
            <Text className="cx-tone-neutral">No toolbox links are assigned to this project. Assign one in the toolbox.</Text>
          ) : (
            <LinkTiles links={links} />
          )}
        </section>

        <section className="cx-pj-section">
          <Heading level={5} as="h2">
            Danger zone
          </Heading>
          <Flex alignItems="center" gap={12}>
            <Button color="critical" onClick={() => setConfirmDelete(true)}>
              <Button.Prefix>
                <DeleteIcon />
              </Button.Prefix>
              Delete project
            </Button>
            <Text className="cx-tone-neutral">Removes the configuration, roadmap and diagrams. Work items and the GitHub repo are not touched.</Text>
          </Flex>
        </section>

        {dirty && (
          <div className="cx-pj-savebar" role="status">
            <Text className="cx-tone-warning">Unsaved changes</Text>
            <span style={{ marginLeft: 'auto' }} />
            <Button onClick={() => setDraft(saved)}>Discard</Button>
            <Button variant="accent" color="primary" onClick={save}>
              Save
            </Button>
          </div>
        )}
      </div>

      <Modal
        title={`Delete ${project.name}?`}
        show={confirmDelete}
        onDismiss={() => setConfirmDelete(false)}
        size="small"
        footer={
          <Flex gap={8} justifyContent="flex-end">
            <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="accent" color="critical" onClick={() => deleteProject(project.id)}>
              Delete
            </Button>
          </Flex>
        }
      >
        <Text>
          This removes the project, its {project.roadmap.length} milestone(s) and {project.diagrams.length} diagram(s).{' '}
          {onBoard > 0
            ? `${onBoard} work item${onBoard > 1 ? 's' : ''} on the board still reference "${project.id}" and will stay, but no longer belong to a project.`
            : 'No work items on the board reference it.'}
        </Text>
      </Modal>
    </div>
  );
}
