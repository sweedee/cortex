import { AiIcon, CheckmarkIcon, CycleIcon } from '@dynatrace/strato-icons';
import type { ItemOf, Segment } from '../../domain';
import { openDialog, patchData } from '../../store';
import { external, placeholder, skill, toast } from '../common';
import { PullRequestIcon } from '../icons';
import type { KindModule } from '../types';

type Pr = ItemOf<'pr'>;

export const isMergeable = ({ data: d }: Pr) =>
  d.state === 'open' && !d.isDraft && d.reviewDecision === 'APPROVED' && d.mergeable === 'MERGEABLE' && (d.checks?.state ?? 'success') === 'success';

export function prRing(pr: Pr): Segment[] {
  const d = pr.data;
  if (d.state === 'merged') return [{ tone: 'success', label: 'Merged' }];
  if (d.state === 'closed') return [{ tone: 'neutral', label: 'Closed' }];
  if (isMergeable(pr)) return [{ tone: 'success', label: 'Approved, checks green, mergeable' }];
  const out: Segment[] = [];
  if (d.isDraft) out.push({ tone: 'neutral', label: 'Draft' });
  else if (d.reviewDecision === 'APPROVED') out.push({ tone: 'success', label: d.reviews ? `Approved (${d.reviews.approved} / ${d.reviews.requested})` : 'Approved' });
  else if (d.reviewDecision === 'CHANGES_REQUESTED') out.push({ tone: 'warning', label: 'Changes requested' });
  else out.push({ tone: 'pending', label: d.reviews ? `Review pending (${d.reviews.requested} reviewer${d.reviews.requested === 1 ? '' : 's'})` : 'Review pending' });
  if (d.mergeable === 'CONFLICTING') out.push({ tone: 'warning', label: 'Merge conflict' });
  if (d.checks?.state === 'failure') out.push({ tone: 'critical', label: d.checks.failed ? `${d.checks.failed} check${d.checks.failed === 1 ? '' : 's'} failing` : 'Checks failing' });
  else if (d.checks?.state === 'pending') out.push({ tone: 'running', label: 'Checks running' });
  return out;
}

const repoName = (repo: string) => repo.split('/').pop() ?? repo;

export const pr: KindModule<'pr'> = {
  kind: 'pr',
  label: 'Pull request',
  icon: (s) => <PullRequestIcon size={s} />,
  radius: 36,
  level: 3,

  ring: prRing,
  short: (p) => `#${p.data.number}`,
  subtitle: ({ data }) => `${repoName(data.repo)} · ${data.author?.endsWith('[bot]') ? data.author : data.isDraft ? 'draft' : data.state} → ${data.baseBranch}`,
  facts: ({ data }, ctx) => {
    const stacked = ctx.getAs(data.stackedOn, 'pr');
    return [
      ['Reviews', data.reviews ? `${data.reviews.approved} / ${data.reviews.requested}${data.reviewDecision === 'APPROVED' ? ' approved' : ''}` : '–'],
      ['Checks', data.checks ? (data.checks.state === 'failure' ? `${data.checks.failed ?? 1} failed` : data.checks.state === 'pending' ? 'running' : data.checks.state === 'success' ? 'passed' : 'none') : '–'],
      ['Diff', data.additions != null ? `+${data.additions} −${data.deletions ?? 0}` : '–'],
      ...(data.headBranch ? [['Branch', data.headBranch] as [string, string]] : []),
      ...(stacked ? [['Stacked on', stacked.handle] as [string, string]] : []),
    ];
  },

  actions: ([p]) => {
    const mergeable = isMergeable(p);
    const conflicted = p.data.mergeable === 'CONFLICTING';
    return [
      external('github', 'Open in GitHub', (i) => (i.kind === 'pr' ? `github.com/${i.data.repo}/pull/${i.data.number}` : '')),
      {
        id: 'merge',
        label: 'Merge',
        type: 'direct',
        icon: <CheckmarkIcon />,
        primary: mergeable,
        disabled: mergeable ? undefined : conflicted ? 'Has merge conflicts' : 'Not approved or checks not green',
        run: () =>
          openDialog({
            type: 'confirm',
            title: `Merge #${p.data.number}?`,
            body: `Squash-merge “${p.title}” into ${p.data.baseBranch} and delete the branch.`,
            confirm: 'Squash and merge',
            onConfirm: () => {
              patchData<'pr'>(p, { state: 'merged' });
              toast(`#${p.data.number} merged`, p.title);
            },
          }),
      },
      conflicted ? skill('conflicts', 'Resolve conflicts', 'resolve-conflicts', { primary: true }) : placeholder('rebase', 'Rebase', <CycleIcon />),
      placeholder('ai-review', 'Request AI review', <AiIcon />),
      skill('address', 'Address review', 'address-review'),
      skill('review', 'Review PR', 'review-pr'),
      skill('describe', 'Write description', 'describe-pr'),
    ];
  },

  addable: {
    label: 'Import pull request…',
    hint: 'owner/repo#123 or a GitHub URL',
    detect: (v) => /\/pull\/\d+|#\d+$/.test(v),
    create: (v, proj) => {
      const num = Number(v.match(/(\d+)\s*$/)?.[1] ?? 0) || 1;
      const repo = v.match(/([\w.-]+\/[\w.-]+)(?:\/pull\/|#)\d+/)?.[1] ?? proj?.data.repo ?? 'unknown/repo';
      return {
        kind: 'pr',
        handle: `PR-${num}`,
        title: `Pull request #${num}`,
        data: { repo, number: num, headBranch: '', baseBranch: proj?.data.defaultBranch ?? 'main', state: 'open', isDraft: false, reviewDecision: 'REVIEW_REQUIRED', checks: { state: 'pending' } },
      };
    },
  },
};
