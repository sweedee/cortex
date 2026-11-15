/**
 * Agent actions. Real sessions (`data.localId`) talk to main through `session.tsx`; demo agents keep
 * their local mock behaviour. `View session` opens the harness in the sidebar for both.
 */
import { BlockIcon, ChatIcon, CheckmarkIcon, PauseIcon, PlayIcon, StopIcon, ViewIcon } from '@dynatrace/strato-icons';
import { isRealPath, type ItemOf } from '../../domain';
import { insertSkill, inspect, patchData } from '../../store';
import { openInEditorAction, openPathAction, skill, toast } from '../common';
import type { Action } from '../types';
import { chooseOption, decidePermission, interruptAgent, needsAnswerForm, openAnswerForm, stopAgent } from './session';

type Agent = ItemOf<'agent'>;

export function agentActions(a: Agent): Action[] {
  const { status, pendingQuestion, pendingPermissions, localId, cwd } = a.data;
  const waiting = status === 'waiting';
  const running = status === 'running';
  const real = !!localId;
  const questions = pendingQuestion?.questions ?? [];

  // one action per option of the first question; several questions / multi-select also get "Answer…"
  const options: Action[] = (questions[0]?.options ?? []).map((o, i) => ({
    id: `answer-${i}`,
    label: o.label,
    type: 'direct',
    icon: <ChatIcon />,
    run: () => chooseOption(a, o.label),
  }));
  const answerAll: Action[] = pendingQuestion && needsAnswerForm(a) ? [{ id: 'answer', label: 'Answer…', type: 'direct', icon: <ChatIcon />, run: () => openAnswerForm(a) }] : [];
  const permissions: Action[] = (pendingPermissions ?? []).slice(0, 2).flatMap((p, i): Action[] => [
    { id: `allow-${i}`, label: `Allow ${p.toolName}`, type: 'direct', icon: <CheckmarkIcon />, primary: i === 0 && !pendingQuestion, run: () => void decidePermission(a, p.requestId, true) },
    { id: `deny-${i}`, label: `Deny ${p.toolName}`, type: 'direct', icon: <BlockIcon />, danger: true, run: () => void decidePermission(a, p.requestId, false) },
  ]);
  const view: Action = {
    id: 'view',
    label: waiting && pendingQuestion ? 'Answer in session' : 'View session',
    type: 'view',
    icon: <ViewIcon />,
    primary: !permissions.length || !!pendingQuestion,
    run: ([x]) => x && inspect(x.id),
  };
  const followUp: Action = real
    ? {
        id: 'follow-up',
        label: 'Send follow-up',
        type: 'direct',
        icon: <ChatIcon />,
        disabled: waiting && pendingQuestion ? 'Answer the question first' : undefined,
        run: () => insertSkill(null, [a.id]),
      }
    : {
        id: 'resume',
        label: 'Resume',
        type: 'direct',
        icon: <PlayIcon />,
        disabled: waiting ? 'Answer the question first' : running ? 'Already running' : undefined,
        run: () => {
          patchData<'agent'>(a, { status: 'running', lastActivity: undefined, endedAt: undefined });
          toast('Agent resumed', a.title, 'info');
        },
      };
  const dir = isRealPath(cwd) ? [openInEditorAction('editor', 'Open folder in editor', () => cwd), openPathAction('folder', 'Show folder', () => cwd)] : [];

  return [
    view,
    ...options,
    ...answerAll,
    ...permissions,
    ...(running && real ? [{ id: 'interrupt', label: 'Interrupt', type: 'direct', icon: <PauseIcon />, run: () => void interruptAgent(a) } satisfies Action] : []),
    ...(running || waiting ? [{ id: 'stop', label: 'Stop', type: 'direct', icon: <StopIcon />, danger: true, run: () => void stopAgent(a) } satisfies Action] : []),
    followUp,
    skill('continue', 'Continue', 'continue-session'),
    skill('fork', 'Fork session', 'fork-session'),
    ...dir,
  ];
}
