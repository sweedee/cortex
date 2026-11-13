import { CycleIcon, DesktopIcon, PlayIcon, StopIcon } from '@dynatrace/strato-icons';
import type { ItemOf, Segment } from '../../domain';
import { external, placeholder } from '../common';
import type { KindModule } from '../types';

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

  actions: ([a]) => {
    const running = a.data.state === 'running' || a.data.state === 'starting';
    return [
      external('open', 'Open', (i) => (i.kind === 'app' ? (i.data.url ?? '') : ''), { primary: running && !!a.data.url, disabled: a.data.url ? undefined : 'No URL known yet' }),
      running ? placeholder('restart', 'Restart', <CycleIcon />) : placeholder('start', 'Start', <PlayIcon />, { primary: true }),
      ...(running ? [placeholder('stop', 'Stop', <StopIcon />, { danger: true })] : []),
    ];
  },

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
