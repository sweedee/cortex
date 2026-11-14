import { Button } from '@dynatrace/strato-components/buttons';
import { CodeIcon, ExternalLinkIcon, FolderOpenIcon, PlusIcon, SettingIcon } from '@dynatrace/strato-icons';
import { useMemo } from 'react';
import { useRenovatePrs, usePrList } from '../../data/gh';
import { useWorktrees } from '../../data/git';
import type { ItemOf, Tone } from '../../domain';
import { ConnectionsSection, SummarySection } from '../../sidebar';
import { patchData } from '../../store';
import { agoShort } from '../../tones';
import { openInEditor, openPath, openUrl } from '../../ui/task';
import { plural } from '../common';
import { stageLabel, STAGE_TONE } from '../deployment/model';
import { openDeploymentForm } from '../deployment/form';
import type { SidebarProps } from '../types';
import { focusItem, IconBtn, InlineText, mono, Note, QueryNote, Section, ToneChip, ValueRow } from './parts';
import { summarizeOpenPrs } from './prSummary';
import { openProjectSettings } from './settings';
import { addWorktreeBubble, openNewWorktree, ticketForBranch } from './worktreeFlow';
import { hasBaseDir, SET_BASE_HINT, untrackedWorktrees } from './worktreeModel';

type Project = ItemOf<'project'>;

const PR_TONE: Record<string, Tone> = { approved: 'success', 'changes-requested': 'critical', draft: 'neutral', open: 'pending' };
const CHECK_TONE: Record<string, Tone> = { passed: 'success', failed: 'critical', pending: 'running', none: 'neutral' };

function Setup({ item }: { item: Project }) {
  const d = item.data;
  const real = !d.repo.startsWith('unknown/');
  const baseOk = hasBaseDir(d);
  return (
    <Section
      label="Repository"
      actions={
        <Button size="condensed" onClick={() => void openProjectSettings(item)}>
          <Button.Prefix>
            <SettingIcon />
          </Button.Prefix>
          Settings…
        </Button>
      }
    >
      <ValueRow label="Repo" actions={real && <IconBtn label="Open on GitHub" onClick={() => void openUrl(`https://github.com/${d.repo}`)}><ExternalLinkIcon /></IconBtn>}>
        {real ? (
          <a href={`https://github.com/${d.repo}`} onClick={(e) => (e.preventDefault(), void openUrl(`https://github.com/${d.repo}`))} style={{ color: 'var(--tone-primary)' }}>
            {d.repo}
          </a>
        ) : (
          <span style={{ color: 'var(--ink-faint)' }}>not set</span>
        )}
      </ValueRow>
      <ValueRow
        label="Base checkout"
        actions={
          d.baseDir && (
            <>
              <IconBtn label="Open folder" onClick={() => void openPath(d.baseDir!)} disabled={!baseOk}><FolderOpenIcon /></IconBtn>
              <IconBtn label="Open in editor" onClick={() => void openInEditor(d.baseDir!)} disabled={!baseOk}><CodeIcon /></IconBtn>
            </>
          )
        }
      >
        <span style={mono} title={d.baseDir}>{d.baseDir ?? <span style={{ color: 'var(--ink-faint)' }}>not set</span>}</span>
      </ValueRow>
      <ValueRow label="Worktrees" actions={d.worktreesDir && <IconBtn label="Open worktrees folder" onClick={() => void openPath(d.worktreesDir!)} disabled={!hasBaseDir({ baseDir: d.worktreesDir })}><FolderOpenIcon /></IconBtn>}>
        <span style={mono} title={d.worktreesDir}>{d.worktreesDir ?? <span style={{ color: 'var(--ink-faint)' }}>not set</span>}</span>
      </ValueRow>
      <ValueRow label="Default branch">
        <span style={mono}>{d.defaultBranch}</span>
      </ValueRow>
      <ValueRow label="Start command">
        <InlineText key={d.startCommand ?? ""} label="Start command" value={d.startCommand ?? ''} placeholder="npm run dev" onCommit={(v) => patchData<'project'>(item, { startCommand: v || undefined })} />
      </ValueRow>
      <ValueRow label="Test command">
        <InlineText key={d.testCommand ?? ""} label="Test command" value={d.testCommand ?? ''} placeholder="npm test" onCommit={(v) => patchData<'project'>(item, { testCommand: v || undefined })} />
      </ValueRow>
      {!baseOk && <Note>{SET_BASE_HINT}</Note>}
    </Section>
  );
}

function Tickets({ item, ctx }: SidebarProps<'project'>) {
  const tickets = ctx
    .inProject(item.id, 'ticket')
    .filter((t) => !t.archived)
    .sort((a, b) => Number(a.data.statusCategory === 'done') - Number(b.data.statusCategory === 'done') || a.data.key.localeCompare(b.data.key));
  const mod = ctx.kind('ticket');
  return (
    <Section label={`Tickets · ${tickets.length}`}>
      {tickets.length === 0 && <Note>No tickets on the canvas for this project. Use “Create ticket” or import one from the Add menu.</Note>}
      {tickets.map((t) => (
        <button key={t.id} className="sidebar-row" onClick={() => focusItem(t.id)} title={t.title}>
          <span className="sidebar-row-icon">{mod.icon(13)}</span>
          <span style={{ flex: 'none', ...mono }}>{t.data.key}</span>
          <span className="sidebar-row-main">{t.title}</span>
          <ToneChip tone={mod.ring(t, ctx)[0]?.tone ?? 'neutral'}>{t.data.status}</ToneChip>
        </button>
      ))}
    </Section>
  );
}

function PullRequests({ item }: { item: Project }) {
  const repo = item.data.repo.startsWith('unknown/') ? undefined : item.data.repo;
  const open = usePrList(repo, { state: 'open', limit: 100 });
  const renovate = useRenovatePrs(repo);
  const sum = useMemo(() => (open.data ? summarizeOpenPrs(open.data) : undefined), [open.data]);
  const renovateCount = renovate.data?.length ?? sum?.renovate;
  return (
    <Section label={sum ? `Open pull requests · ${sum.total}` : 'Open pull requests'}>
      <QueryNote q={open} what="pull requests" offlineHint={repo ? 'Pull requests need the desktop app.' : 'Set the GitHub repo in Settings… to see its pull requests.'} />
      {sum && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
            {sum.byState.approved > 0 && <ToneChip tone="success">{sum.byState.approved} approved</ToneChip>}
            {sum.byState['changes-requested'] > 0 && <ToneChip tone="critical">{sum.byState['changes-requested']} changes requested</ToneChip>}
            {sum.byState.open > 0 && <ToneChip tone="pending">{sum.byState.open} awaiting review</ToneChip>}
            {sum.byState.draft > 0 && <ToneChip tone="neutral">{sum.byState.draft} draft</ToneChip>}
            {sum.failing > 0 && <ToneChip tone="critical">{sum.failing} failing checks</ToneChip>}
            {sum.pending > 0 && <ToneChip tone="running">{sum.pending} checks running</ToneChip>}
            {sum.total === 0 && <Note>No open pull requests.</Note>}
          </div>
          {sum.top.map((pr) => (
            <button key={pr.number} className="sidebar-row" onClick={() => void openUrl(pr.url)} title={`${pr.title} · ${pr.author}`}>
              <span style={{ flex: 'none', ...mono }}>#{pr.number}</span>
              <span className="sidebar-row-main">{pr.title}</span>
              <ToneChip tone={CHECK_TONE[pr.checks]}>{pr.checks === 'none' ? 'no checks' : pr.checks}</ToneChip>
              <ToneChip tone={PR_TONE[pr.state] ?? 'neutral'}>{pr.state}</ToneChip>
              <span className="sidebar-row-rel">{agoShort(Date.parse(pr.updatedAt))}</span>
            </button>
          ))}
          {sum.total > sum.top.length && <Note>and {sum.total - sum.top.length} more on GitHub</Note>}
        </>
      )}
      {renovateCount != null && (
        <div style={{ marginTop: 8, fontSize: 12.5 }}>
          Renovate: <ToneChip tone={renovateCount > 0 ? 'warning' : 'neutral'}>{plural(renovateCount, 'PR')}</ToneChip>
        </div>
      )}
    </Section>
  );
}

function Worktrees({ item, ctx }: SidebarProps<'project'>) {
  const baseOk = hasBaseDir(item.data);
  const disk = useWorktrees(baseOk ? item.data.baseDir : undefined);
  const onCanvas = ctx.inProject(item.id, 'worktree').filter((w) => !w.archived);
  const untracked = disk.data ? untrackedWorktrees(disk.data, item.data.baseDir, onCanvas.map((w) => w.data.path)) : [];
  const wtMod = ctx.kind('worktree');
  return (
    <Section
      label={`Worktrees · ${onCanvas.length} on canvas${disk.data ? `, ${untracked.length} not added` : ''}`}
      actions={
        <Button size="condensed" onClick={() => void openNewWorktree(item)}>
          <Button.Prefix>
            <PlusIcon />
          </Button.Prefix>
          New
        </Button>
      }
    >
      {!baseOk && <Note>{SET_BASE_HINT}</Note>}
      {baseOk && <QueryNote q={disk} what="worktrees" />}
      {onCanvas.map((w) => (
        <button key={w.id} className="sidebar-row" onClick={() => focusItem(w.id)} title={w.data.path}>
          <span className="sidebar-row-icon">{wtMod.icon(13)}</span>
          <span className="sidebar-row-main">{w.data.branch}</span>
          <ToneChip tone={wtMod.ring(w, ctx)[0]?.tone ?? 'neutral'}>{wtMod.ring(w, ctx)[0]?.label ?? ''}</ToneChip>
        </button>
      ))}
      {untracked.map((w) => (
        <div key={w.path} className="sidebar-row" style={{ cursor: 'default' }} title={w.path}>
          <span className="sidebar-row-icon" style={{ opacity: 0.6 }}>{wtMod.icon(13)}</span>
          <span className="sidebar-row-main" style={{ color: 'var(--ink-subdued)' }}>{w.branch ?? w.path}</span>
          <span className="sidebar-row-rel">on disk</span>
          <Button
            size="condensed"
            onClick={() =>
              addWorktreeBubble(item, {
                path: w.path,
                branch: w.branch ?? w.path.split(/[\\/]/).pop() ?? 'worktree',
                baseBranch: item.data.defaultBranch,
                ticket: w.branch ? ticketForBranch(item.id, w.branch) : undefined,
              })
            }
          >
            Add to canvas
          </Button>
        </div>
      ))}
      {baseOk && disk.data && onCanvas.length === 0 && untracked.length === 0 && <Note>No worktrees besides the main checkout.</Note>}
    </Section>
  );
}

function Deployments({ item, ctx }: SidebarProps<'project'>) {
  const deployments = ctx.inProject(item.id, 'deployment').filter((d) => !d.archived);
  const mod = ctx.kind('deployment');
  return (
    <Section
      label={`Deployments · ${deployments.length}`}
      actions={
        <Button size="condensed" onClick={() => void openDeploymentForm({ project: item })}>
          <Button.Prefix>
            <PlusIcon />
          </Button.Prefix>
          Add deployment
        </Button>
      }
    >
      {deployments.length === 0 && <Note>No deployments yet.</Note>}
      {deployments.map((dep) => (
        <div key={dep.id} style={{ display: 'flex', alignItems: 'center' }}>
          <button className="sidebar-row" onClick={() => focusItem(dep.id)} title={dep.data.url}>
            <span className="sidebar-row-icon">{mod.icon(13)}</span>
            <span className="sidebar-row-main">{dep.title}</span>
            <ToneChip tone={STAGE_TONE[dep.data.stage]}>{stageLabel(dep.data)}</ToneChip>
          </button>
          <IconBtn label={`Open ${dep.data.url}`} onClick={() => void openUrl(dep.data.url)}><ExternalLinkIcon /></IconBtn>
        </div>
      ))}
    </Section>
  );
}

export function ProjectSidebar(props: SidebarProps<'project'>) {
  const { item, ctx } = props;
  return (
    <>
      <SummarySection item={item} ctx={ctx} />
      <Setup item={item} />
      <Tickets {...props} />
      <PullRequests item={item} />
      <Worktrees {...props} />
      <Deployments {...props} />
      <ConnectionsSection item={item} ctx={ctx} />
    </>
  );
}
