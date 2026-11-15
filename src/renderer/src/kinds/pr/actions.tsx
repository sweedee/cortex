/**
 * PR UI actions: trigger AI review, merge (form → `gh pr merge`, archive with undo, stacked
 * children, linked worktree), rebase (`gh pr update-branch --rebase`, conflicts → the `rebase` skill).
 */
import { Button } from '@dynatrace/strato-components/buttons';
import { dismissToast, showToast } from '@dynatrace/strato-components/notifications';
import { DeleteIcon, ArrowDownRightIcon } from '@dynatrace/strato-icons';
import { codeHost } from '../../data/codehost';
import { gitOps } from '../../data/git';
import { isRealPath, type ItemOf } from '../../domain';
import { getState, insertSkill, itemById, patchData, removeItems } from '../../store';
import { openForm } from '../../ui/form';
import { errorText, runTask } from '../../ui/task';
import { archive, toast } from '../common';
import type { KindCtx } from '../types';
import { hasConflicts, MERGE_METHODS, mergeArgs, mergeWarnings, retargetPlan, stackChildren, worktreeOf } from './logic';

type Pr = ItemOf<'pr'>;

/** The comment that triggers the AI review (config.json `github.aiReviewComment`, mirrored in the store). */
export const aiReviewComment = (): string => getState().settings.aiReviewComment;

export async function triggerAiReview(p: Pr) {
  const body = aiReviewComment();
  await openForm({
    title: `Request AI review on #${p.data.number}?`,
    description: `Posts this comment on ${p.data.repo}#${p.data.number}: “${body}”`,
    fields: [],
    submitLabel: 'Post comment',
    onSubmit: async () => {
      await codeHost(p.data.provider).requestAiReview(p.data.repo, p.data.number);
      toast('AI review requested', `Commented “${body}” on #${p.data.number}`);
    },
  });
}

// ---- merge ---------------------------------------------------------------------------------

export function openMerge(p: Pr, ctx: KindCtx) {
  const warnings = mergeWarnings(p.data);
  return openForm({
    title: `Merge #${p.data.number} into ${p.data.baseBranch}`,
    description: warnings.length ? `Careful: ${warnings.join(', ')}. GitHub may refuse the merge.` : `“${p.title}” is approved, green and mergeable.`,
    danger: warnings.length > 0,
    submitLabel: warnings.length ? 'Merge anyway' : 'Merge',
    fields: [
      { name: 'method', label: 'Merge method', type: 'radio', options: MERGE_METHODS, default: 'squash' },
      { name: 'deleteBranch', label: `Delete the branch${p.data.headBranch ? ` ${p.data.headBranch}` : ''} after merging`, type: 'checkbox', default: true },
    ],
    onSubmit: async (v) => {
      const args = mergeArgs(p.data, v);
      await codeHost(p.data.provider).prMerge(...args);
      afterMerge(p, ctx, args[3].deleteBranch);
    },
  });
}

/** Mark merged, archive with undo, deal with stacked children and offer to remove the worktree. */
function afterMerge(p: Pr, ctx: KindCtx, deletedBranch: boolean) {
  patchData<'pr'>(p, { state: 'merged' }, { notice: undefined });
  const merged = itemById(p.id);
  if (merged) archive([merged], `Merged #${p.data.number} and archived`);

  for (const r of retargetPlan(p.data, stackChildren(getState().items, p.id), deletedBranch)) {
    if (r.automatic) {
      // GitHub retargets PRs whose base branch was deleted by the merge
      patchData<'pr'>(r.child, { baseBranch: r.newBase });
      showToast({ type: 'info', title: `#${r.child.data.number} now targets ${r.newBase}`, message: 'GitHub retargets stacked PRs when the parent branch is deleted.', lifespan: 6000 });
    } else {
      const id = showToast({
        type: 'warning',
        title: `#${r.child.data.number} still targets ${p.data.headBranch}`,
        message: `It was stacked on #${p.data.number}, which is merged now.`,
        lifespan: 20_000,
        actions: (
          <Button
            size="condensed"
            onClick={() => {
              dismissToast(id);
              void retargetPr(r.child, r.newBase);
            }}
          >
            <Button.Prefix>
              <ArrowDownRightIcon />
            </Button.Prefix>
            Retarget onto {r.newBase}
          </Button>
        ),
      });
    }
  }

  const wt = worktreeOf(p, ctx.linked(p.id, 'worktree'), p.projectId ? ctx.inProject(p.projectId, 'worktree') : []);
  if (wt) offerWorktreeRemoval(wt, ctx);
}

function offerWorktreeRemoval(wt: ItemOf<'worktree'>, ctx: KindCtx) {
  const id = showToast({
    type: 'info',
    title: 'Remove the worktree too?',
    message: wt.data.path,
    lifespan: 15_000,
    actions: (
      <Button
        size="condensed"
        onClick={() => {
          dismissToast(id);
          void removeWorktree(wt, ctx);
        }}
      >
        <Button.Prefix>
          <DeleteIcon />
        </Button.Prefix>
        Remove worktree
      </Button>
    ),
  });
}

export async function removeWorktree(wt: ItemOf<'worktree'>, ctx: KindCtx) {
  const baseDir = ctx.projectOf(wt)?.data.baseDir;
  const real = isRealPath(baseDir) && isRealPath(wt.data.path);
  await openForm({
    title: 'Remove worktree?',
    description: real ? `git worktree remove ${wt.data.path}` : "Set the project's base checkout in Settings to remove it with git. Without it, only the bubble is removed.",
    danger: true,
    submitLabel: real ? 'Remove' : 'Remove from canvas',
    fields: real ? [{ name: 'force', label: 'Force (discard uncommitted changes)', type: 'checkbox' }] : [],
    onSubmit: async (v) => {
      if (real && baseDir) await gitOps.worktreeRemove(baseDir, wt.data.path, { force: v.force === true });
      removeItems([wt.id]);
      toast(real ? 'Worktree removed' : 'Removed from the canvas', wt.title);
    },
  });
}

/** `gh pr edit --base`: point a stacked PR at its merged parent's base branch. */
export async function retargetPr(child: Pr, base: string) {
  const ok = await runTask(`Retargeting #${child.data.number} onto ${base}`, codeHost(child.data.provider).prEdit({ repo: child.data.repo, number: child.data.number, base }), {
    success: `#${child.data.number} now targets ${base}`,
  });
  if (ok === undefined) return;
  const cur = itemById(child.id);
  if (cur?.kind === 'pr') patchData<'pr'>(cur, { baseBranch: base });
}

// ---- rebase --------------------------------------------------------------------------------

const rebaseSkill = (p: Pr) => insertSkill('rebase', [p.id]);

export async function rebasePr(p: Pr) {
  if (hasConflicts(p.data)) {
    rebaseSkill(p);
    toast(`#${p.data.number} has conflicts`, 'Inserted /rebase into the chat box: Claude resolves them in the worktree.', 'warning');
    return;
  }
  const r = await runTask(`Rebasing #${p.data.number}`, codeHost(p.data.provider).prUpdateBranch(p.data.repo, p.data.number, { rebase: true }), { quiet: true });
  if (!r) return;
  if (r.ok) {
    toast(`#${p.data.number} rebased onto ${p.data.baseBranch}`, r.message || undefined);
  } else if (r.conflicts) {
    patchData<'pr'>(p, { mergeable: 'CONFLICTING' });
    rebaseSkill(p);
    showToast({
      type: 'warning',
      title: `#${p.data.number} can't be rebased automatically`,
      message: `${r.message ? errorText(r.message) + ' ' : ''}Inserted /rebase into the chat box so Claude resolves the conflicts.`,
      lifespan: 10_000,
    });
  } else {
    showToast({ type: 'warning', title: `Rebase of #${p.data.number} failed`, message: r.message, lifespan: 10_000 });
  }
}
