/**
 * PR sidebar, "basically the GitHub PR view": Overview (state, reviews, mergeability, checks,
 * description, comments, stack) · Files (diff) · GitHub (the PR page: GitHub forbids framing, so a link to open it).
 */
import { useEffect, useMemo } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { Chip, ProgressCircle } from '@dynatrace/strato-components/content';
import { CriticalIcon, ExternalLinkIcon, MinusIcon, PendingIcon, PlusIcon, SuccessIcon } from '@dynatrace/strato-icons';
import type { GhCheck, GhPullRequest } from '../../../../shared/integrations/github';
import { userConfig } from '../../data/config';
import { usePr, usePrChecks, usePrDiff } from '../../data/codehost';
import type { ItemOf } from '../../domain';
import { isDesktop } from '../../native';
import { ConnectionsSection, SidebarSection, SidebarTabs, SummarySection } from '../../sidebar';
import { addItem, getState, inspect, makeItem, patchData, select } from '../../store';
import { changes, prPatch } from '../../sync/mapping';
import { agoText } from '../../tones';
import { errorText, openUrl } from '../../ui/task';
import { DiffViewer, Markdown, WebPanel } from '../../components/viewers';
import { toast } from '../common';
import type { KindCtx, SidebarProps } from '../types';
import { retargetPr } from './actions';
import { planBuildSync } from '../../sync/checks';
import { isAiReviewer, isRealRepo, needsRetarget, prUrl } from './logic';
import './pr.css';

type Pr = ItemOf<'pr'>;

const COMMENTS = 5;

/** PR templates are full of HTML comments; the markdown viewer shows raw HTML as text. */
const stripComments = (s: string) => s.replace(/<!--[\s\S]*?-->/g, '').trim();

export function PrSidebar({ item, ctx }: SidebarProps<'pr'>) {
  const real = isRealRepo(item.data.repo) && isDesktop;
  return (
    <SidebarTabs
      rememberAs="pr"
      initial="overview"
      tabs={[
        { id: 'overview', label: 'Overview', render: () => <Overview pr={item} ctx={ctx} real={real} /> },
        {
          id: 'files',
          label: 'Files',
          wide: true,
          badge: item.data.additions != null ? `+${item.data.additions} −${item.data.deletions ?? 0}` : undefined,
          render: () => (real ? <Files pr={item} /> : <NoRepo pr={item} />),
        },
        {
          id: 'github',
          label: 'GitHub',
          wide: true,
          render: () => (real ? <WebPanel src={prUrl(item.data)} onOpenExternal={(u) => void openUrl(u)} /> : <NoRepo pr={item} />),
        },
      ]}
    />
  );
}

// ---- small states --------------------------------------------------------------------------

export function Loading({ what }: { what: string }) {
  return (
    <div className="pr-state">
      <ProgressCircle size="small" aria-label={`Loading ${what}`} />
      <span>Loading {what}…</span>
    </div>
  );
}

export function Failed({ what, error }: { what: string; error: unknown }) {
  return (
    <div className="pr-state is-error" role="alert">
      Could not load {what}: {errorText(error)}
    </div>
  );
}

function NoRepo({ pr }: { pr: Pr }) {
  return (
    <SidebarSection>
      <div className="pr-state">
        {isDesktop ? `${pr.data.repo} is not a GitHub repository Cortex can reach (demo data?). Import the PR as owner/repo#123.` : 'GitHub data needs the Cortex server.'}
      </div>
    </SidebarSection>
  );
}

const go = (id: string) => {
  inspect(id);
  select([id]);
};

// ---- overview ------------------------------------------------------------------------------

function Overview({ pr, ctx, real }: { pr: Pr; ctx: KindCtx; real: boolean }) {
  const q = usePr(real ? pr.data.repo : undefined, pr.data.number, pr.data.provider);
  const view = q.data;

  // write back what the ring needs (the refresher does the same in the background)
  useEffect(() => {
    if (!view) return;
    const cur = getState().items.find((i) => i.id === pr.id);
    if (cur?.kind !== 'pr') return;
    const patch = prPatch(view);
    if (changes(cur.data, patch)) patchData<'pr'>(cur, patch);
  }, [view, pr.id]);

  return (
    <>
      <SummarySection item={pr} ctx={ctx} />
      <Header pr={pr} view={view} />
      {!real ? (
        <NoRepo pr={pr} />
      ) : q.isLoading ? (
        <SidebarSection>
          <Loading what="the pull request" />
        </SidebarSection>
      ) : q.isError ? (
        <SidebarSection>
          <Failed what="the pull request" error={q.error} />
        </SidebarSection>
      ) : null}
      {view && <Reviews view={view} />}
      {real && <Checks pr={pr} ctx={ctx} />}
      {view && (
        <SidebarSection label="Description">
          {stripComments(view.body) ? <Markdown source={stripComments(view.body)} onLinkClick={(h) => void openUrl(h)} className="pr-md" /> : <div className="pr-state">No description.</div>}
        </SidebarSection>
      )}
      {view && <Comments view={view} />}
      <Stack pr={pr} ctx={ctx} />
      <ConnectionsSection item={pr} ctx={ctx} />
    </>
  );
}

const STATE_CHIP: Record<string, { label: string; color: 'success' | 'neutral' | 'primary' | 'critical' }> = {
  open: { label: 'Open', color: 'success' },
  draft: { label: 'Draft', color: 'neutral' },
  merged: { label: 'Merged', color: 'primary' },
  closed: { label: 'Closed', color: 'critical' },
};

function Header({ pr, view }: { pr: Pr; view?: GhPullRequest }) {
  const d = pr.data;
  const st = STATE_CHIP[d.state === 'open' && d.isDraft ? 'draft' : d.state] ?? { label: d.state, color: 'neutral' as const };
  const facts: [string, string][] = [
    ['Number', `#${d.number}`],
    ['Author', view?.author?.login ?? d.author ?? '–'],
    ['Branches', `${d.baseBranch} ← ${d.headBranch || '?'}`],
    ['Mergeable', [view?.mergeable ?? d.mergeable, view?.mergeStateStatus].filter(Boolean).join(' · ').toLowerCase() || '–'],
    ...(view ? ([['Files', `${view.changedFiles} · +${view.additions} −${view.deletions}`]] as [string, string][]) : []),
    ...(view?.createdAt ? ([['Opened', agoText(Date.parse(view.createdAt))]] as [string, string][]) : []),
  ];
  return (
    <SidebarSection
      label={
        <span className="pr-head">
          <Chip size="condensed" color={st.color} variant="emphasized">
            {st.label}
          </Chip>
          <span>{d.repo}</span>
        </span>
      }
      actions={
        <Button size="condensed" variant="default" onClick={() => void openUrl(prUrl(d))} aria-label="Open on GitHub">
          <Button.Prefix>
            <ExternalLinkIcon />
          </Button.Prefix>
          GitHub
        </Button>
      }
    >
      <dl className="sidebar-facts">
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className="pr-wrap">{v}</dd>
          </div>
        ))}
      </dl>
    </SidebarSection>
  );
}

const REVIEW_TONE: Record<string, 'success' | 'warning' | 'neutral'> = { APPROVED: 'success', CHANGES_REQUESTED: 'warning' };

function Reviews({ view }: { view: GhPullRequest }) {
  const decision = view.reviewDecision;
  const requested = (view.reviewRequests ?? []).map((r) => ('login' in r && r.login) || ('slug' in r && r.slug) || ('name' in r && r.name) || '?');
  const latest = view.latestReviews ?? [];
  return (
    <SidebarSection label="Reviews">
      <div className="pr-chips">
        <Chip size="condensed" color={REVIEW_TONE[decision] ?? 'neutral'} variant={decision ? 'emphasized' : undefined}>
          {decision === 'APPROVED' ? 'Approved' : decision === 'CHANGES_REQUESTED' ? 'Changes requested' : decision === 'REVIEW_REQUIRED' ? 'Review required' : 'No review decision'}
        </Chip>
      </div>
      {latest.map((r) => (
        <div key={`${r.author.login}-${r.submittedAt}`} className="pr-line">
          <span className={`pr-dot tone-${r.state === 'APPROVED' ? 'success' : r.state === 'CHANGES_REQUESTED' ? 'warning' : 'neutral'}`} />
          <span className="pr-line-main">{r.author.login}</span>
          <span className="pr-line-side">{r.state.toLowerCase().replace('_', ' ')}</span>
        </div>
      ))}
      {requested.map((n) => (
        <div key={`req-${n}`} className="pr-line">
          <span className="pr-dot tone-pending" />
          <span className="pr-line-main">{n}</span>
          <span className="pr-line-side">requested</span>
        </div>
      ))}
      {!latest.length && !requested.length && <div className="pr-state">No reviewers yet.</div>}
    </SidebarSection>
  );
}

const BUCKET_ICON: Record<GhCheck['bucket'], React.ReactElement> = {
  pass: <SuccessIcon className="tone-text-success" />,
  fail: <CriticalIcon className="tone-text-critical" />,
  cancel: <CriticalIcon className="tone-text-neutral" />,
  pending: <PendingIcon className="tone-text-running" />,
  skipping: <MinusIcon className="tone-text-neutral" />,
};

function Checks({ pr, ctx }: { pr: Pr; ctx: KindCtx }) {
  const q = usePrChecks(pr.data.repo, pr.data.number, pr.data.provider);
  const checks = q.data;
  const plan = useMemo(() => (checks ? planBuildSync(ctx.items, pr, checks) : undefined), [checks, ctx.items, pr]);

  // keep existing build bubbles of this PR in step with its checks
  useEffect(() => {
    for (const u of plan?.updates ?? []) patchData<'build'>(u.id, u.patch);
  }, [plan]);

  const addBuilds = () => {
    if (!plan?.creates.length) return;
    for (const n of plan.creates) {
      const it = makeItem(n);
      addItem(it, [{ from: it.id, to: pr.id, label: 'checks' }]);
    }
    toast(`Added ${plan.creates.length} build${plan.creates.length === 1 ? '' : 's'}`, `Checks of #${pr.data.number}`, 'info');
  };

  const failing = checks?.filter((c) => c.bucket === 'fail').length ?? 0;
  return (
    <SidebarSection
      label={checks ? `Checks · ${checks.length}${failing ? ` · ${failing} failing` : ''}` : 'Checks'}
      actions={
        plan?.creates.length ? (
          <Button size="condensed" onClick={addBuilds} aria-label="Add the checks as build bubbles">
            <Button.Prefix>
              <PlusIcon />
            </Button.Prefix>
            Add {plan.creates.length} to canvas
          </Button>
        ) : undefined
      }
    >
      {q.isLoading ? (
        <Loading what="checks" />
      ) : q.isError ? (
        <Failed what="checks" error={q.error} />
      ) : !checks?.length ? (
        <div className="pr-state">No checks reported.</div>
      ) : (
        [...checks]
          .sort((a, b) => ORDER[a.bucket] - ORDER[b.bucket] || a.name.localeCompare(b.name))
          .map((c) => (
            <button key={`${c.workflow}/${c.name}`} className="sidebar-row" title={c.link || undefined} disabled={!c.link} onClick={() => void openUrl(c.link)}>
              <span className="pr-check-icon">{BUCKET_ICON[c.bucket]}</span>
              <span className="sidebar-row-main">
                {c.workflow && c.workflow !== c.name ? <span className="subdued">{c.workflow} / </span> : null}
                {c.name}
              </span>
              <span className="sidebar-row-rel">{c.description || c.state.toLowerCase()}</span>
            </button>
          ))
      )}
    </SidebarSection>
  );
}

const ORDER: Record<GhCheck['bucket'], number> = { fail: 0, cancel: 1, pending: 2, pass: 3, skipping: 4 };

function Comments({ view }: { view: GhPullRequest }) {
  const all = view.comments ?? [];
  const shown = all.slice(-COMMENTS);
  const bot = userConfig().github.aiReviewBot;
  return (
    <SidebarSection label={`Comments${all.length ? ` · ${all.length}` : ''}`}>
      {all.length > shown.length && (
        <button className="pr-more" onClick={() => void openUrl(view.url)}>
          {all.length - shown.length} older on GitHub
        </button>
      )}
      {shown.map((c) => (
        <div key={c.id} className="pr-comment">
          <div className="pr-comment-head">
            <strong>{c.author.login}</strong>
            {isAiReviewer(c.author.login, bot) && <Chip size="condensed">AI review</Chip>}
            <span className="subdued">{agoText(Date.parse(c.createdAt))}</span>
          </div>
          <Markdown source={c.body} onLinkClick={(h) => void openUrl(h)} className="pr-md" />
        </div>
      ))}
      {!all.length && <div className="pr-state">No comments.</div>}
    </SidebarSection>
  );
}

function Stack({ pr, ctx }: { pr: Pr; ctx: KindCtx }) {
  const parent = ctx.getAs(pr.data.stackedOn, 'pr');
  const children = ctx.items.filter((i): i is Pr => i.kind === 'pr' && i.data.stackedOn === pr.id);
  if (!parent && !children.length) return null;
  const row = (p: Pr, rel: string) => (
    <button key={p.id} className="sidebar-row" onClick={() => go(p.id)}>
      <span className="sidebar-row-icon">{ctx.kind('pr').icon(13)}</span>
      <span className="sidebar-row-main">
        #{p.data.number} {p.title}
      </span>
      <span className="sidebar-row-rel">
        {rel} · {p.data.state === 'open' && p.data.isDraft ? 'draft' : p.data.state}
      </span>
    </button>
  );
  return (
    <SidebarSection label="Stack">
      {parent && row(parent, 'stacked on')}
      {parent && needsRetarget(pr.data, parent.data) && (
        <div className="pr-state is-warning">
          #{parent.data.number} is merged, but this PR still targets {pr.data.baseBranch}.{' '}
          <Button size="condensed" variant="emphasized" onClick={() => void retargetPr(pr, parent.data.baseBranch)}>
            Retarget onto {parent.data.baseBranch}
          </Button>
        </div>
      )}
      {children.map((c) => row(c, 'stacked on this'))}
    </SidebarSection>
  );
}

// ---- files ---------------------------------------------------------------------------------

function Files({ pr }: { pr: Pr }) {
  const q = usePrDiff(pr.data.repo, pr.data.number, pr.data.provider);
  if (q.isPending) return <Loading what="the diff" />;
  if (q.isError) return <Failed what="the diff" error={q.error} />;
  if (!q.data.trim()) return <div className="pr-state">No changes.</div>;
  return <DiffViewer diff={q.data} />;
}
