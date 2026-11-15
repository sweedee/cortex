/**
 * Project settings form: the real paths and commands the integrations need (repo, base checkout,
 * worktrees folder, default branch, start / test commands). Opened from the project's
 * "Settings…" action and from the canvas "Add → Project" flow. Picking the base checkout detects
 * the GitHub repo (`git:remoteRepo`), the current branch, a worktrees folder next to it and
 * npm scripts from `package.json`.
 */
import { userConfig } from '../../data/config';
import { gitOps } from '../../data/git';
import type { ItemOf } from '../../domain';
import { place } from '../../layout';
import { native } from '../../native';
import { addItem, makeItem, patchData, select } from '../../store';
import { openForm, str, type FormValues } from '../../ui/form';
import { baseName } from '../../../../shared/paths';
import { toast } from '../common';
import { slug, uniqueHandle } from '../handles';
import { worktreesDirFor } from './worktreeModel';

type Project = ItemOf<'project'>;

const REPO = /^[\w.-]+\/[\w.-]+$/;
const sep = (p: string) => (p.includes('\\') && !p.includes('/') ? '\\' : '/');

/** What a picked base checkout tells us (only fills fields that are still empty / defaults). */
export async function detectFromBaseDir(dir: string, v: FormValues): Promise<Partial<FormValues>> {
  const patch: Partial<FormValues> = {};
  const name = str(v, 'name') || baseName(dir);
  if (!str(v, 'name')) patch.name = name;
  const { worktreesDir, defaultBranch } = userConfig().git;
  if (!str(v, 'worktreesDir')) patch.worktreesDir = worktreesDirFor(dir, worktreesDir, name);
  const git = await gitOps.detect(dir).catch(() => null);
  if (git?.repo && (!str(v, 'repo') || !REPO.test(str(v, 'repo')) || str(v, 'repo').startsWith('unknown/'))) patch.repo = git.repo;
  if (git?.branch && (!str(v, 'defaultBranch') || str(v, 'defaultBranch') === defaultBranch)) patch.defaultBranch = git.branch;
  try {
    const pkg = JSON.parse(await native.fs.readText({ path: `${dir}${sep(dir)}package.json` })) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts ?? {};
    if (!str(v, 'startCommand')) patch.startCommand = scripts.dev ? 'npm run dev' : scripts.start ? 'npm start' : '';
    if (!str(v, 'testCommand') && scripts.test) patch.testCommand = 'npm test';
  } catch {
    /* not a node project, or no fs (browser) */
  }
  return patch;
}

/**
 * Edit a project's settings, or create a project (no `project`; placed at `at`).
 * Resolves with the project (null when cancelled).
 */
export async function openProjectSettings(project?: Project, at?: { x: number; y: number }): Promise<Project | null> {
  const d = project?.data;
  let result: Project | null = null;
  await openForm({
    title: project ? `${project.title} settings` : 'Add project',
    description: project ? undefined : 'Pick the main checkout: the GitHub repo, branch and commands are detected from it.',
    submitLabel: project ? 'Save' : 'Add project',
    fields: [
      { name: 'baseDir', label: 'Base checkout', type: 'directory', hint: 'The main clone of the repo; agents and git run here.' },
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'repo', label: 'GitHub repo', type: 'text', required: true, placeholder: 'owner/name', validate: (x) => (REPO.test(String(x)) ? undefined : 'Use owner/name') },
      { name: 'defaultBranch', label: 'Default branch', type: 'text', required: true, default: userConfig().git.defaultBranch },
      { name: 'worktreesDir', label: 'Worktrees folder', type: 'directory', hint: 'New worktrees are created in here.' },
      { name: 'startCommand', label: 'Start command', type: 'text', placeholder: 'npm run dev', hint: 'Runs in a shell, from the checkout or worktree.' },
      { name: 'testCommand', label: 'Test command', type: 'text', placeholder: 'npm test' },
    ],
    values: {
      name: project?.title,
      repo: d?.repo.startsWith('unknown/') ? '' : d?.repo,
      baseDir: d?.baseDir,
      worktreesDir: d?.worktreesDir,
      defaultBranch: d?.defaultBranch,
      startCommand: d?.startCommand,
      testCommand: d?.testCommand,
    },
    onChange: (name, v) => (name === 'baseDir' && str(v, 'baseDir') ? detectFromBaseDir(str(v, 'baseDir'), v) : undefined),
    onSubmit: (v) => {
      const data = {
        repo: str(v, 'repo'),
        baseDir: str(v, 'baseDir') || undefined,
        worktreesDir: str(v, 'worktreesDir') || undefined,
        defaultBranch: str(v, 'defaultBranch'),
        startCommand: str(v, 'startCommand') || undefined,
        testCommand: str(v, 'testCommand') || undefined,
      };
      if (project) {
        patchData<'project'>(project, data, { title: str(v, 'name') });
        result = project;
        toast('Project saved', str(v, 'name'));
        return;
      }
      const item = makeItem({ kind: 'project', handle: uniqueHandle(slug(str(v, 'name'), 'project')), title: str(v, 'name'), data }) as Project;
      if (at) place.seed(item.id, at);
      addItem(item);
      select([item.id]);
      result = item;
      toast('Project added', `${item.title} · ${data.repo}`);
    },
  });
  return result;
}
