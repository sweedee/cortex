import { AgentIcon, BlockIcon, ChatIcon, CheckmarkIcon, PauseIcon, PlayIcon, StopIcon, ViewIcon } from '@dynatrace/strato-icons';
import type { AgentData, ItemOf, Segment } from '../../domain';
import { focusChat, insertSkill, inspect, openDialog, patchData } from '../../store';
import { skill, toast } from '../common';
import type { Action, KindModule } from '../types';
import { chooseOption, decidePermission, interruptAgent, openAnswerForm, stopAgent } from './session';

export { answerQuestion } from './session';

type Agent = ItemOf<'agent'>;

export function agentRing({ data }: Agent): Segment[] {
  const act = data.lastActivity;
  switch (data.status) {
    case 'running':
      return [{ tone: 'running', label: act ? `Running · ${act}` : 'Running' }];
    case 'waiting':
      return [{ tone: 'warning', label: 'Waiting for your answer' }];
    case 'idle':
      return [{ tone: 'neutral', label: act ?? 'Idle' }];
    case 'done':
      return [{ tone: 'success', label: act ? `Done · ${act}` : 'Done' }];
    case 'failed':
      return [{ tone: 'critical', label: act ? `Failed · ${act}` : 'Failed' }];
  }
}

const mins = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60_000));
  return m < 60 ? `${m} min` : `${Math.round(m / 60)} h`;
};
const PHRASE: Record<AgentData['status'], string> = { running: 'running', waiting: 'waiting', idle: 'idle', done: 'finished', failed: 'failed' };

export const agent: KindModule<'agent'> = {
  kind: 'agent',
  label: 'Agent session',
  icon: (s) => <AgentIcon size={s} />,
  radius: 34,
  level: 3,

  ring: agentRing,
  waiting: (a) => a.data.status === 'waiting',
  subtitle: ({ data }) => {
    const since = data.status === 'done' || data.status === 'failed' ? data.endedAt : data.startedAt;
    const when = since ? (data.status === 'done' || data.status === 'failed' ? ` ${mins(Date.now() - since)} ago` : ` ${mins(Date.now() - since)}`) : '';
    return [data.model, PHRASE[data.status] + when].filter(Boolean).join(' · ');
  },
  facts: ({ data }) => [
    ['Context', data.usage?.contextPct != null ? `${data.usage.contextPct}%` : '–'],
    ['Cost', data.usage?.costUsd != null ? `$${data.usage.costUsd.toFixed(2)}` : '–'],
    ['Turns', data.usage?.turns != null ? String(data.usage.turns) : '–'],
    ...(data.cwd ? [['Directory', data.cwd] as [string, string]] : []),
  ],

  actions: ([a]) => {
    const { status, pendingQuestion, pendingPermissions, localId } = a.data;
    const waiting = status === 'waiting';
    const real = !!localId;
    const options: Action[] = (pendingQuestion?.questions[0]?.options ?? []).map((o, i) => ({
      id: `answer-${i}`,
      label: o.label,
      type: 'direct',
      icon: <ChatIcon />,
      run: () => chooseOption(a, o.label),
    }));
    const permissions: Action[] = (pendingPermissions ?? []).slice(0, 2).flatMap((p, i): Action[] => [
      { id: `allow-${i}`, label: `Allow ${p.toolName}`, type: 'direct', icon: <CheckmarkIcon />, primary: i === 0 && !pendingQuestion, run: () => void decidePermission(a, p.requestId, true) },
      { id: `deny-${i}`, label: `Deny ${p.toolName}`, type: 'direct', icon: <BlockIcon />, danger: true, run: () => void decidePermission(a, p.requestId, false) },
    ]);
    const view: Action = {
      id: 'view',
      label: waiting && pendingQuestion ? 'Answer' : 'View session',
      type: 'view',
      icon: <ViewIcon />,
      primary: !permissions.length || !!pendingQuestion,
      run: ([x]) => {
        if (!real) return openDialog({ type: 'session', itemId: x.id });
        if (waiting && pendingQuestion) return openAnswerForm(a);
        inspect(x.id);
      },
    };
    const running = status === 'running';
    return [
      view,
      ...options,
      ...permissions,
      skill('continue', 'Continue', 'continue-session', real ? { run: ([x]) => insertSkill(null, [x.id]) } : {}),
      skill('fork', 'Fork session', 'fork-session'),
      ...(running && real ? [{ id: 'interrupt', label: 'Interrupt', type: 'direct', icon: <PauseIcon />, run: () => void interruptAgent(a) } satisfies Action] : []),
      running || (real && waiting)
        ? ({ id: 'stop', label: 'Stop', type: 'direct', icon: <StopIcon />, danger: true, run: () => void stopAgent(a) } satisfies Action)
        : ({
            id: 'resume',
            label: real ? 'Follow up' : 'Resume',
            type: 'direct',
            icon: <PlayIcon />,
            disabled: waiting ? 'Answer the question first' : undefined,
            run: () => {
              if (real) return insertSkill(null, [a.id]);
              patchData<'agent'>(a, { status: 'running', lastActivity: undefined, endedAt: undefined });
              toast('Agent resumed', a.title, 'info');
            },
          } satisfies Action),
    ];
  },

  complete: () => ({ status: 'done', pendingQuestion: undefined }),

  addable: {
    label: 'Start agent session…',
    hint: 'what should the agent do?',
    multiline: true,
    // real sessions start from the chat box (it picks the directory from the mentions)
    open: () => {
      focusChat();
      toast('Describe the task in the chat box', '@mention a worktree or project to choose where the agent works.', 'info');
    },
    create: (v, proj) => ({
      kind: 'agent',
      handle: `agent/${Math.random().toString(36).slice(2, 6)}`,
      title: v.length > 40 ? v.slice(0, 40) + '…' : v,
      data: { cwd: proj?.data.baseDir ?? '', model: 'claude-opus-5-5', status: 'running', startedAt: Date.now() },
    }),
  },
};
