import { AgentIcon, ChatIcon, PlayIcon, StopIcon, ViewIcon } from '@dynatrace/strato-icons';
import type { AgentData, ItemOf, Segment } from '../../domain';
import { openDialog, patchData } from '../../store';
import { skill, toast } from '../common';
import type { Action, KindModule } from '../types';

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

/** Answer the open AskUserQuestion (mock until the claude CLI integration sends it back). */
export function answerQuestion(a: Agent, answer: string) {
  patchData<'agent'>(a, { status: 'running', pendingQuestion: undefined, lastActivity: 'continuing with your answer' }, { notice: undefined });
  toast('Answer sent', answer);
}

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
    const { status, pendingQuestion } = a.data;
    const waiting = status === 'waiting';
    const options: Action[] = (pendingQuestion?.questions[0]?.options ?? []).map((o, i) => ({
      id: `answer-${i}`,
      label: o.label,
      type: 'direct',
      icon: <ChatIcon />,
      run: () => answerQuestion(a, o.label),
    }));
    return [
      { id: 'view', label: waiting ? 'Answer' : 'View session', type: 'view', icon: <ViewIcon />, primary: true, run: ([x]) => openDialog({ type: 'session', itemId: x.id }) },
      ...options,
      skill('continue', 'Continue', 'continue-session'),
      skill('fork', 'Fork session', 'fork-session'),
      status === 'running'
        ? {
            id: 'stop',
            label: 'Stop',
            type: 'direct',
            icon: <StopIcon />,
            danger: true,
            run: () => {
              patchData<'agent'>(a, { status: 'idle', lastActivity: 'Stopped by you', endedAt: Date.now() });
              toast('Agent stopped', a.title, 'info');
            },
          }
        : {
            id: 'resume',
            label: 'Resume',
            type: 'direct',
            icon: <PlayIcon />,
            disabled: waiting ? 'Answer the question first' : undefined,
            run: () => {
              patchData<'agent'>(a, { status: 'running', lastActivity: undefined, endedAt: undefined });
              toast('Agent resumed', a.title, 'info');
            },
          },
    ];
  },

  complete: () => ({ status: 'done', pendingQuestion: undefined }),

  addable: {
    label: 'Start agent session…',
    hint: 'what should the agent do?',
    multiline: true,
    create: (v, proj) => ({
      kind: 'agent',
      handle: `agent/${Math.random().toString(36).slice(2, 6)}`,
      title: v.length > 40 ? v.slice(0, 40) + '…' : v,
      data: { cwd: proj?.data.baseDir ?? '', model: 'claude-opus-5-5', status: 'running', startedAt: Date.now() },
    }),
  },
};
