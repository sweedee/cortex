import { AgentIcon } from '@dynatrace/strato-icons';
import type { AgentData } from '../../domain';
import { focusChat } from '../../store';
import { toast } from '../common';
import type { KindModule } from '../types';
import { agentActions } from './actions';
import { agentRing } from './ring';
import { AgentSidebar } from './Sidebar';
import { tokens } from './usage';

export { answerQuestion } from './session';
export { agentRing } from './ring';

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
  // running subagents show as a chip on the bubble
  badge: ({ data }) => (data.subagents?.running && data.status === 'running' ? { label: data.subagents.running === 1 ? '1 subagent' : `${data.subagents.running} subagents`, tone: 'running' } : undefined),
  subtitle: ({ data }) => {
    const since = data.status === 'done' || data.status === 'failed' ? data.endedAt : data.startedAt;
    const when = since ? (data.status === 'done' || data.status === 'failed' ? ` ${mins(Date.now() - since)} ago` : ` ${mins(Date.now() - since)}`) : '';
    const subs = data.subagents?.total ? `${data.subagents.total} subagent${data.subagents.total === 1 ? '' : 's'}` : '';
    return [data.model?.replace(/^claude-/, ''), PHRASE[data.status] + when, subs].filter(Boolean).join(' · ');
  },
  facts: ({ data }) => [
    ['Context', data.usage?.contextPct != null ? `${data.usage.contextPct}%${data.usage.contextTokens ? ` (${tokens(data.usage.contextTokens)}${data.usage.contextWindow ? ` of ${tokens(data.usage.contextWindow)}` : ''})` : ''}` : '–'],
    ...(data.subagents?.total ? [['Subagents', data.subagents.running ? `${data.subagents.running} running of ${data.subagents.total}` : `${data.subagents.total} done`] as [string, string]] : []),
    ...(data.effort || (data.permissionMode && data.permissionMode !== 'default') ? [['Mode', [data.effort && `effort ${data.effort}`, data.permissionMode !== 'default' && data.permissionMode].filter(Boolean).join(' · ')] as [string, string]] : []),
    ['Cost', data.usage?.costUsd != null ? `$${data.usage.costUsd.toFixed(2)}` : '–'],
    ['Turns', data.usage?.turns != null ? String(data.usage.turns) : '–'],
    ...(data.cwd ? [['Directory', data.cwd] as [string, string]] : []),
  ],

  actions: ([a]) => agentActions(a),
  Sidebar: AgentSidebar,

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
