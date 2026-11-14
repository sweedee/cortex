import { AiIcon, CheckmarkIcon, CycleIcon, ArrowDownRightIcon } from '@dynatrace/strato-icons';
import { external, skill } from '../common';
import { PullRequestIcon } from '../icons';
import type { Action, KindModule } from '../types';
import { openMerge, rebasePr, retargetPr, triggerAiReview } from './actions';
import { ghBlocked, hasConflicts, isMergeable, mergeBlocked, needsRetarget, prRing, prUrl } from './logic';
import { PrSidebar } from './Sidebar';

export { isMergeable, prRing } from './logic';

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

  actions: ([p], ctx) => {
    const blocked = ghBlocked(p.data);
    const conflicted = hasConflicts(p.data);
    const parent = ctx.getAs(p.data.stackedOn, 'pr');
    const retarget: Action[] =
      parent && needsRetarget(p.data, parent.data)
        ? [
            {
              id: 'retarget',
              label: `Retarget onto ${parent.data.baseBranch}`,
              type: 'direct',
              icon: <ArrowDownRightIcon />,
              primary: !blocked,
              disabled: blocked,
              run: () => void retargetPr(p, parent.data.baseBranch),
            },
          ]
        : [];
    const merge: Action = {
      id: 'merge',
      label: 'Merge…',
      type: 'direct',
      icon: <CheckmarkIcon />,
      primary: isMergeable(p),
      disabled: mergeBlocked(p.data),
      run: () => void openMerge(p, ctx),
    };
    const rebase: Action = {
      id: 'rebase',
      label: conflicted ? 'Rebase (resolve conflicts)' : 'Rebase',
      type: conflicted ? 'skill' : 'direct',
      ...(conflicted ? { skill: 'rebase' } : {}),
      icon: <CycleIcon />,
      primary: conflicted && !blocked,
      disabled: blocked,
      run: () => void rebasePr(p),
    };
    return [
      ...retarget,
      merge,
      rebase,
      {
        id: 'ai-review',
        label: 'Request AI review…',
        type: 'direct',
        icon: <AiIcon />,
        disabled: blocked,
        run: () => void triggerAiReview(p),
      },
      skill('address', 'Address review', 'address-review', { primary: p.data.reviewDecision === 'CHANGES_REQUESTED' }),
      skill('review', 'Review PR', 'review-pr'),
      skill('describe', 'Write description', 'describe-pr'),
      external('github', 'Open on GitHub', (i) => (i.kind === 'pr' ? prUrl(i.data) : '')),
    ];
  },

  Sidebar: PrSidebar,

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

