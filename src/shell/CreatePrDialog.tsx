import { useState, type ReactNode } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { Checkbox, Select, TextArea, TextInput } from '@dynatrace/strato-components/forms';
import { Flex } from '@dynatrace/strato-components/layouts';
import { Modal } from '@dynatrace/strato-components/overlays';
import { Text } from '@dynatrace/strato-components/typography';
import { AutoFocus } from '../components/AutoFocus';
import { Md } from '../components/Md';
import type { WorkItem } from '../model/types';
import { closeDialog, createPr } from '../state/actions';
import { headOf, prefillOf } from '../state/derive';
import { useCortex, useWork } from '../state/store';

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <Flex flexDirection="column" gap={4}>
    <Text textStyle="small-emphasized">{label}</Text>
    {children}
  </Flex>
);

/** Rendered once by the shell; opened from anywhere with `openCreatePrDialog(workId)`. */
export function CreatePrDialog() {
  const dialog = useCortex((s) => s.dialog);
  const work = useWork(dialog?.kind === 'create-pr' ? dialog.workId : null);
  // mounted per opening, so every opening starts from the prefilled values
  return work?.worktree ? <CreatePrForm key={work.id} work={work} /> : null;
}

function CreatePrForm({ work }: { work: WorkItem }) {
  const wt = work.worktree!;
  const allWork = useCortex((s) => s.work);
  const defaultBase = useCortex((s) => s.projects.find((p) => p.id === work.repo)?.baseBranch ?? 'main');

  const [form, setForm] = useState(() => prefillOf(work, wt.baseBranch));
  const [reviewers, setReviewers] = useState('');
  const [preview, setPreview] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  // base branches: the default one, plus the branch of every other (unmerged) piece of work in this repo
  const others = allWork.filter((o) => o.id !== work.id && o.repo === work.repo && headOf(o) && headOf(o) !== wt.branch && o.pr?.state !== 'merged');
  const options = [
    { branch: defaultBase, label: `${defaultBase} (default)` },
    ...others.map((o) => ({ branch: headOf(o)!, label: `${headOf(o)}${o.pr ? ` · #${o.pr.number}` : ''}` })),
  ];
  if (!options.some((o) => o.branch === form.base)) options.push({ branch: form.base, label: form.base });
  const parent = others.find((o) => headOf(o) === form.base);
  const stacked = form.base !== defaultBase;

  const logins = reviewers.split(/[\s,]+/).filter(Boolean);
  const valid = form.title.trim().length > 0 && form.base !== wt.branch;
  const submit = () => {
    if (!valid) return;
    void createPr(work.id, { ...form, reviewers: logins });
    closeDialog();
  };

  return (
    <Modal
      title="Create pull request"
      show
      onDismiss={closeDialog}
      size="medium"
      footer={
        <Flex justifyContent="flex-end" gap={8}>
          <Button onClick={closeDialog}>Cancel</Button>
          <Button variant="accent" color="primary" disabled={!valid} onClick={submit}>
            {form.draft ? 'Create draft pull request' : 'Create pull request'}
          </Button>
        </Flex>
      }
    >
      <Flex flexDirection="column" gap={16}>
        <Flex flexDirection="column" gap={2}>
          <Text>
            <span className="cx-mono">{wt.branch}</span>
            <span className="cx-tone-neutral">
              {' · '}
              {wt.ahead} commit{wt.ahead === 1 ? '' : 's'} ahead of {wt.baseBranch}
            </span>
          </Text>
          {wt.ahead === 0 && (
            <Text textStyle="small" className="cx-tone-warning">
              No commits ahead of {wt.baseBranch} — the pull request would be empty.
            </Text>
          )}
          {wt.behind > 0 && (
            <Text textStyle="small" className="cx-tone-warning">
              The branch is {wt.behind} behind {wt.baseBranch}. Consider rebasing first.
            </Text>
          )}
          {wt.dirtyFiles > 0 && (
            <Text textStyle="small" className="cx-tone-warning">
              {wt.dirtyFiles} uncommitted file{wt.dirtyFiles === 1 ? '' : 's'} will not be part of the pull request.
            </Text>
          )}
        </Flex>

        <Field label="Title">
          <AutoFocus>
            <TextInput aria-label="Title" value={form.title} onChange={(title) => set({ title })} />
          </AutoFocus>
        </Field>

        <Field label="Description">
          <Flex gap={4}>
            <Button size="condensed" variant={preview ? 'default' : 'accent'} color={preview ? 'neutral' : 'primary'} onClick={() => setPreview(false)}>
              Edit
            </Button>
            <Button size="condensed" variant={preview ? 'accent' : 'default'} color={preview ? 'primary' : 'neutral'} onClick={() => setPreview(true)}>
              Preview
            </Button>
          </Flex>
          {preview ? (
            <div className="cx-pr-preview">{form.body.trim() ? <Md>{form.body}</Md> : <Text className="cx-tone-neutral">Nothing to preview.</Text>}</div>
          ) : (
            <TextArea aria-label="Description" rows={10} resize="vertical" width="full" value={form.body} onChange={(body) => set({ body })} />
          )}
        </Field>

        <Field label="Base branch">
          <Select<string> value={form.base} onChange={(base) => base && set({ base })} aria-label="Base branch">
            <Select.Trigger width="full" />
            <Select.Content>
              {options.map((o) => (
                <Select.Option key={o.branch} value={o.branch}>
                  {o.label}
                </Select.Option>
              ))}
            </Select.Content>
          </Select>
          {stacked && (
            <Text textStyle="small" className="cx-tone-primary">
              This creates a stacked pull request on top of {parent?.pr ? `#${parent.pr.number} (${form.base})` : form.base}. It can only be merged after its
              parent; afterwards retarget it to {defaultBase}.
            </Text>
          )}
        </Field>

        <Field label="Reviewers (GitHub logins, comma-separated)">
          <TextInput aria-label="Reviewers" placeholder="mila-novak, jonas-becker" value={reviewers} onChange={setReviewers} />
        </Field>

        <Checkbox value={form.draft} onChange={(draft) => set({ draft })}>
          Create as draft
        </Checkbox>
      </Flex>
    </Modal>
  );
}
