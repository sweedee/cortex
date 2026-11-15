/**
 * Agent bubble ↔ its Claude Code session in main (`data.localId`): answering
 * AskUserQuestion, tool permissions, stop / interrupt. Demo agents (no `localId`) keep the
 * old local behaviour. Status updates come back through `claude:state` (sync/live.ts).
 */
import type { ClaudeAnswers } from '../../../../shared/integrations/claude';
import { claudeOps } from '../../data/claude';
import type { ItemOf } from '../../domain';
import { patchData, patchItem } from '../../store';
import { openForm, type FormFieldSpec, type FormValues } from '../../ui/form';
import { errorText, runTask } from '../../ui/task';
import { toast } from '../common';

type Agent = ItemOf<'agent'>;
type Question = NonNullable<Agent['data']['pendingQuestion']>['questions'][number];

/** Does answering need the dialog (several questions, or a multi-select)? */
export const needsAnswerForm = (a: Agent) => {
  const qs = a.data.pendingQuestion?.questions ?? [];
  return qs.length > 1 || qs.some((q) => q.multiSelect);
};

/** Send answers (question text → label(s) or free text). A plain string answers the first question. */
export async function answerQuestion(a: Agent, answer: string | ClaudeAnswers) {
  const pq = a.data.pendingQuestion;
  const answers: ClaudeAnswers = typeof answer === 'string' ? (pq ? { [pq.questions[0]?.question ?? '']: answer } : {}) : answer;
  const shown = Object.values(answers)
    .map((v) => (Array.isArray(v) ? v.join(', ') : v))
    .join(' · ');
  if (!a.data.localId || !pq) {
    // demo agent: just move on locally
    patchData<'agent'>(a, { status: 'running', pendingQuestion: undefined, lastActivity: 'continuing with your answer' }, { notice: undefined });
    toast('Answer sent', shown);
    return;
  }
  try {
    patchData<'agent'>(a, { status: 'running', pendingQuestion: undefined, lastActivity: 'Continuing with your answer' }, { notice: undefined });
    await claudeOps.answer(a.data.localId, pq.toolUseId, answers);
    toast('Answer sent', shown);
  } catch (e) {
    patchData<'agent'>(a, { status: 'waiting', pendingQuestion: pq });
    toast('Could not send the answer', errorText(e), 'critical');
  }
}

const fieldName = (qi: number, oi?: number) => (oi == null ? `q${qi}` : `q${qi}o${oi}`);

/** The fields for all open questions: radio (single) or one checkbox per option (multi), plus "other". */
export function answerFields(questions: Question[]): FormFieldSpec[] {
  return questions.flatMap((q, qi): FormFieldSpec[] => {
    const title = q.header ? `${q.header}: ${q.question}` : q.question;
    const other: FormFieldSpec = { name: `${fieldName(qi)}other`, label: questions.length > 1 ? 'Or your own answer' : 'Or type an answer', type: 'text', placeholder: 'Optional' };
    if (q.multiSelect)
      return [
        ...q.options.map((o, oi): FormFieldSpec => ({ name: fieldName(qi, oi), label: oi === 0 ? `${title} — ${o.label}` : o.label, type: 'checkbox', hint: o.description })),
        other,
      ];
    return [{ name: fieldName(qi), label: title, type: 'radio', options: q.options.map((o) => ({ value: o.label, label: o.label, hint: o.description })) }, other];
  });
}

/** Form values → answers; every question needs an option or its own text. Throws with a message otherwise. */
export function answersFrom(questions: Question[], v: FormValues): ClaudeAnswers {
  const out: ClaudeAnswers = {};
  questions.forEach((q, qi) => {
    const other = String(v[`${fieldName(qi)}other`] ?? '').trim();
    if (q.multiSelect) {
      const picked = q.options.filter((_, oi) => v[fieldName(qi, oi)] === true).map((o) => o.label);
      if (other) picked.push(other);
      if (picked.length) out[q.question] = picked;
    } else {
      const picked = other || String(v[fieldName(qi)] ?? '');
      if (picked) out[q.question] = picked;
    }
    if (!(q.question in out)) throw new Error(`Answer “${q.header || q.question}” first.`);
  });
  return out;
}

/** Dialog with every open question; `preset` pre-selects an option of the first question. */
export function openAnswerForm(a: Agent, preset?: string) {
  const qs = a.data.pendingQuestion?.questions ?? [];
  if (!qs.length) return;
  const values: FormValues = {};
  if (preset) {
    const oi = (qs[0]?.options ?? []).findIndex((o) => o.label === preset);
    if (qs[0]?.multiSelect && oi >= 0) values[fieldName(0, oi)] = true;
    else values[fieldName(0)] = preset;
  }
  void openForm({
    title: `${a.title} is asking`,
    fields: answerFields(qs),
    values,
    submitLabel: 'Send answer',
    onSubmit: (v) => answerQuestion(a, answersFrom(qs, v)),
  });
}

/** One option's action: answers directly for a single plain question, else opens the dialog. */
export function chooseOption(a: Agent, label: string) {
  if (needsAnswerForm(a)) openAnswerForm(a, label);
  else void answerQuestion(a, label);
}

/** Allow / deny a pending tool permission. */
export async function decidePermission(a: Agent, requestId: string, allow: boolean) {
  if (!a.data.localId) return;
  const rest = (a.data.pendingPermissions ?? []).filter((p) => p.requestId !== requestId);
  const perm = a.data.pendingPermissions?.find((p) => p.requestId === requestId);
  patchData<'agent'>(a, { pendingPermissions: rest.length ? rest : undefined, ...(rest.length || a.data.pendingQuestion ? {} : { status: 'running' as const }) });
  patchItem(a.id, { notice: undefined });
  try {
    await claudeOps.permission(a.data.localId, requestId, allow ? { behavior: 'allow' } : { behavior: 'deny', message: 'The user denied this in Cortex.' });
    toast(allow ? `Allowed ${perm?.toolName ?? 'tool'}` : `Denied ${perm?.toolName ?? 'tool'}`, perm?.summary, allow ? 'success' : 'info');
  } catch (e) {
    toast('Could not send the decision', errorText(e), 'critical');
  }
}

export async function stopAgent(a: Agent) {
  if (!a.data.localId) {
    patchData<'agent'>(a, { status: 'idle', lastActivity: 'Stopped by you', endedAt: Date.now() });
    toast('Agent stopped', a.title, 'info');
    return;
  }
  await runTask(`Stopping ${a.title}`, claudeOps.stop(a.data.localId), { success: 'Agent stopped' });
}

export async function interruptAgent(a: Agent) {
  if (!a.data.localId) return;
  // a single control message, no need for a progress toast
  try {
    const sent = await claudeOps.interrupt(a.data.localId);
    toast(sent ? 'Interrupted' : 'Nothing to interrupt', sent ? 'The session stays open; send a follow-up.' : 'The session has no running process.', 'info');
  } catch (e) {
    toast('Could not interrupt', errorText(e), 'critical');
  }
}
