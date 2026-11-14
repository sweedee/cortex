import { CycleIcon, DesktopIcon, PlayIcon, StopIcon, TerminalIcon } from '@dynatrace/strato-icons';
import type { ItemOf, Segment } from '../../domain';
import { inspect } from '../../store';
import { external, openInEditorAction } from '../common';
import type { Action, KindModule } from '../types';
import { cannotStart, isLive, restartApp, startApp, stopApp } from './ops';
import { AppSidebar, showAppTab } from './Sidebar';

export function appRing({ data }: ItemOf<'app'>): Segment[] {
  switch (data.state) {
    case 'running':
      return [{ tone: 'success', label: data.url ? `Running on ${data.url}` : 'Running' }];
    case 'starting':
      return [{ tone: 'running', label: 'Starting…' }];
    case 'stopped':
      return [{ tone: 'neutral', label: 'Stopped' }];
    case 'crashed':
      return [{ tone: 'critical', label: 'Crashed' }];
  }
}

/** The app's actions for its state (exported for tests). */
export function appActions(a: ItemOf<'app'>): Action[] {
  const live = isLive(a);
  const why = cannotStart(a);
  const showLog: Action = {
    id: 'log',
    label: 'Show log',
    type: 'view',
    icon: <TerminalIcon />,
    primary: a.data.state === 'crashed',
    run: ([x]) => {
      showAppTab('log');
      inspect(x.id);
    },
  };
  return [
    external('open', 'Open in browser', (i) => (i.kind === 'app' ? (i.data.url ?? '') : ''), {
      primary: a.data.state === 'running' && !!a.data.url,
      disabled: !live ? 'Not running' : a.data.url ? undefined : 'No URL detected yet',
    }),
    {
      id: 'preview',
      label: 'Preview',
      type: 'view',
      icon: <DesktopIcon />,
      run: ([x]) => {
        showAppTab('preview');
        inspect(x.id);
      },
    },
    ...(live
      ? [
          { id: 'restart', label: 'Restart', type: 'direct', icon: <CycleIcon />, disabled: why, run: () => void restartApp(a) } satisfies Action,
          { id: 'stop', label: 'Stop', type: 'direct', icon: <StopIcon />, danger: true, run: () => void stopApp(a) } satisfies Action,
        ]
      : [
          {
            id: 'start',
            label: a.data.state === 'crashed' ? 'Restart' : 'Start',
            type: 'direct',
            icon: a.data.state === 'crashed' ? <CycleIcon /> : <PlayIcon />,
            primary: a.data.state === 'stopped',
            disabled: why,
            run: () => void startApp(a),
          } satisfies Action,
        ]),
    showLog,
    ...(why ? [] : [openInEditorAction('editor', 'Open folder in editor', () => a.data.cwd)]),
  ];
}

/** A running instance of a project or worktree (`npm run dev` and friends). */
export const app: KindModule<'app'> = {
  kind: 'app',
  label: 'App',
  icon: (s) => <DesktopIcon size={s} />,
  radius: 30,
  level: 3,

  ring: appRing,
  short: (a) => (a.data.port ? `:${a.data.port}` : undefined),
  subtitle: (a) => a.data.url ?? a.data.command,
  facts: ({ data }, ctx) => {
    const wt = ctx.getAs(data.worktreeId, 'worktree');
    return [
      ['Command', data.command],
      ['Directory', data.cwd],
      ['URL', data.url ?? '–'],
      ...(wt ? [['Worktree', wt.handle] as [string, string]] : []),
      ...(data.procId ? [['Process', data.procId] as [string, string]] : []),
    ];
  },

  actions: ([a]) => appActions(a),
  Sidebar: AppSidebar,

  addable: {
    label: 'Launch app…',
    hint: 'command, e.g. npm run dev',
    create: (v, proj) => ({
      kind: 'app',
      handle: `app/${(proj?.title ?? 'app').toLowerCase()}`,
      title: `${proj?.title ?? 'App'} (${v})`,
      data: { command: v, cwd: proj?.data.baseDir ?? '', state: 'stopped' },
    }),
  },
};
