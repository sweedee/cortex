/** Worktree sidebar: "Changes" (wide diff) and "Stats" tabs. Degrades for demo items (fake paths). */
import { useState, type ReactNode } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { RefreshIcon } from '@dynatrace/strato-icons';
import { DiffViewer } from '../../components/viewers';
import { useGitDiff, useGitDiffStat, useGitLog, useGitStatus } from '../../data/git';
import { invalidate } from '../../data/ops';
import { qk } from '../../data/queryKeys';
import type { ItemOf } from '../../domain';
import { ConnectionsSection, FactsSection, SidebarSection, SidebarTabs, SummarySection } from '../../sidebar';
import { agoText } from '../../tones';
import { errorText } from '../../ui/task';
import type { SidebarProps } from '../types';
import { statusLetter, WORKTREE_HINT } from './model';
import { isAbsolutePath } from '../../../../shared/paths';
import './worktree.css';

type Worktree = ItemOf<'worktree'>;

/** Loading / error / content of a query, never a spinner that runs forever. */
function Q<T>({ q, children }: { q: { isPending: boolean; error: unknown; data: T | undefined; fetchStatus: string }; children: (d: T) => ReactNode }) {
  if (q.error) return <div className="wt-error">{errorText(q.error)}</div>;
  if (q.data === undefined) return <div className="wt-note">{q.isPending && q.fetchStatus !== 'idle' ? 'Loading…' : 'Not available outside the desktop app.'}</div>;
  return <>{children(q.data)}</>;
}

type DiffMode = 'base' | 'uncommitted';

const letterClass = (l: string) => (l === 'A' || l === '?' ? 'new' : l === 'D' ? 'del' : l === 'U' ? 'conflict' : '');

function Changes({ w }: { w: Worktree }) {
  const [mode, setMode] = useState<DiffMode>('base');
  const path = isAbsolutePath(w.data.path) ? w.data.path : undefined;
  // `--merge-base HEAD` = uncommitted (staged + unstaged) changes
  const q = useGitDiff(path, mode === 'base' ? w.data.baseBranch : 'HEAD');
  if (!path) return <div className="wt-note">{WORKTREE_HINT}</div>;
  const tab = (m: DiffMode, label: string) => (
    <Button size="condensed" variant={mode === m ? 'accent' : 'default'} color={mode === m ? 'primary' : 'neutral'} onClick={() => setMode(m)}>
      {label}
    </Button>
  );
  return (
    <>
      <div className="wt-toolbar">
        {tab('base', `vs ${w.data.baseBranch}`)}
        {tab('uncommitted', 'Uncommitted')}
        <span className="grow" />
        <Button size="condensed" onClick={() => void invalidate(qk.git.dir(path))}>
          <Button.Prefix>
            <RefreshIcon />
          </Button.Prefix>
          Refresh
        </Button>
      </div>
      <div className="wt-diff">
        <Q q={q}>
          {(diff) =>
            diff.trim() ? (
              <DiffViewer diff={diff} />
            ) : (
              <div className="wt-note">{mode === 'base' ? `No changes against ${w.data.baseBranch}.` : 'Nothing uncommitted.'} Untracked files only show in Stats.</div>
            )
          }
        </Q>
      </div>
    </>
  );
}

function Stats({ item, ctx }: SidebarProps<'worktree'>) {
  const w = item;
  const path = isAbsolutePath(w.data.path) ? w.data.path : undefined;
  const status = useGitStatus(path);
  const stat = useGitDiffStat(path, w.data.baseBranch);
  const log = useGitLog(path, { range: `${w.data.baseBranch}..HEAD`, limit: 10 });
  const s = status.data;
  const cached = w.data.git;
  const yesNo = (b: boolean) => (b ? 'yes' : 'no');
  const refresh = path && (
    <Button size="condensed" onClick={() => void invalidate(qk.git.dir(path))}>
      <Button.Prefix>
        <RefreshIcon />
      </Button.Prefix>
      Refresh
    </Button>
  );
  return (
    <>
      <SummarySection item={item} ctx={ctx} />
      {!path && <div className="wt-note">{WORKTREE_HINT}</div>}
      <FactsSection
        label="Git"
        facts={[
          ['Branch', s?.branch ?? w.data.branch],
          ['Base', w.data.baseBranch],
          ['Ahead / behind', s ? `${s.ahead} / ${s.behind}${s.upstream ? ` (${s.upstream})` : ' (no upstream)'}` : cached ? `${cached.ahead} / ${cached.behind}` : '–'],
          ['Dirty', s ? yesNo(s.dirty) : cached ? yesNo(cached.dirty) : '–'],
          ...(s?.rebasing ? ([['State', 'rebase in progress']] as [string, string][]) : []),
          ...(cached?.checkedAt ? ([['Checked', agoText(cached.checkedAt)]] as [string, string][]) : []),
        ]}
      />
      {path && (
        <SidebarSection label="Changed files" actions={refresh}>
          <Q q={status}>
            {(st) =>
              st.files.length ? (
                <ul className="wt-files">
                  {st.files.map((f) => {
                    const letter = statusLetter(f);
                    return (
                      <li key={f.path} title={f.origPath ? `${f.origPath} → ${f.path}` : f.path}>
                        <span className={`letter ${letterClass(letter)}`}>{letter}</span>
                        <span className="path">{f.path}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="subdued">Working tree clean.</div>
              )
            }
          </Q>
          <div className="wt-totals subdued">
            {stat.data ? (
              <>
                vs {w.data.baseBranch}: {stat.data.files.length} file{stat.data.files.length === 1 ? '' : 's'} <span className="add">+{stat.data.additions}</span>{' '}
                <span className="del">-{stat.data.deletions}</span>
              </>
            ) : stat.error ? (
              errorText(stat.error)
            ) : null}
          </div>
        </SidebarSection>
      )}
      {path && (
        <SidebarSection label={`Commits since ${w.data.baseBranch}`}>
          <Q q={log}>
            {(entries) =>
              entries.length ? (
                <ul className="wt-commits">
                  {entries.map((c) => (
                    <li key={c.sha} title={`${c.author}, ${c.date}`}>
                      <span className="sha">{c.short}</span>
                      <span className="subject">{c.subject}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="subdued">No commits ahead of {w.data.baseBranch}.</div>
              )
            }
          </Q>
        </SidebarSection>
      )}
      <ConnectionsSection item={item} ctx={ctx} label="Linked ticket, PR, records" />
    </>
  );
}

export function WorktreeSidebar(props: SidebarProps<'worktree'>) {
  const { item } = props;
  return (
    <SidebarTabs
      rememberAs="worktree"
      initial="stats"
      tabs={[
        { id: 'changes', label: 'Changes', wide: true, render: () => <Changes w={item} /> },
        { id: 'stats', label: 'Stats', render: () => <Stats {...props} /> },
      ]}
    />
  );
}
