/** Add / edit form of a deployment (URL, stage incl. a custom label, title, project). */
import type { ItemOf } from '../../domain';
import { addItem, addLink, getState, makeItem, patchData, select, setState } from '../../store';
import { openForm, str } from '../../ui/form';
import { toast } from '../common';
import { deploymentFields, guessStage, stageLabel } from './model';

type Deployment = ItemOf<'deployment'>;
type Project = ItemOf<'project'>;

const NONE = 'none';
const slug = (s: string) => s.trim().toLowerCase().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'app';

function uniqueHandle(base: string) {
  const taken = new Set(getState().items.map((i) => i.handle.toLowerCase()));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

const hostOf = (url: string) => url.replace(/^https?:\/\//i, '').split(/[/:?#]/)[0] ?? '';

/** Re-point the "deploys" link from the old project to the new one. */
function relink(d: Deployment, projectId: string | undefined) {
  if (d.projectId === projectId) return;
  setState((s) => ({ ...s, links: s.links.filter((l) => !(l.label === 'deploys' && l.from === d.id && l.to === d.projectId)) }));
  if (projectId) addLink(d.id, projectId, 'deploys');
}

/**
 * Edit `deployment`, or add one (no `deployment`) to `project`. Resolves with the item (null = cancelled).
 */
export async function openDeploymentForm(opts: { deployment?: Deployment; project?: Project }): Promise<Deployment | null> {
  const d = opts.deployment;
  const projects = getState().items.filter((i): i is Project => i.kind === 'project' && !i.archived);
  let autoStage = d ? d.data.stage : '';
  let result: Deployment | null = null;
  await openForm({
    title: d ? `Edit ${d.title}` : opts.project ? `Add deployment to ${opts.project.title}` : 'Add deployment',
    submitLabel: d ? 'Save' : 'Add deployment',
    fields: [
      { name: 'url', label: 'URL', type: 'text', required: true, placeholder: 'https://dev.example.com' },
      {
        name: 'stage',
        label: 'Stage',
        type: 'select',
        required: true,
        options: [
          { value: 'dev', label: 'dev' },
          { value: 'staging', label: 'staging' },
          { value: 'prod', label: 'prod' },
          { value: 'custom', label: 'custom…' },
        ],
      },
      { name: 'stageLabel', label: 'Stage label', type: 'text', placeholder: 'perf', when: (v) => v.stage === 'custom', required: true },
      { name: 'title', label: 'Title', type: 'text', hint: 'Defaults to "<project> <stage>".' },
      { name: 'projectId', label: 'Project', type: 'select', options: [{ value: NONE, label: 'No project' }, ...projects.map((p) => ({ value: p.id, label: p.title }))] },
    ],
    values: {
      url: d?.data.url,
      stage: d?.data.stage ?? 'dev',
      stageLabel: d?.data.stageLabel,
      title: d?.title,
      projectId: d?.projectId ?? opts.project?.id ?? NONE,
    },
    onChange: (name, v) => {
      // a new deployment guesses its stage from the URL until the user picks one
      if (name === 'url' && !d && (!autoStage || v.stage === autoStage)) {
        autoStage = guessStage(str(v, 'url'));
        return { stage: autoStage };
      }
      if (name === 'stage') autoStage = '';
    },
    onSubmit: (v) => {
      const f = deploymentFields({ url: str(v, 'url'), stage: str(v, 'stage'), stageLabel: str(v, 'stageLabel') });
      const projectId = str(v, 'projectId') === NONE ? undefined : str(v, 'projectId');
      const project = projects.find((p) => p.id === projectId);
      const title = str(v, 'title') || `${project?.title ?? hostOf(f.url)} ${stageLabel(f)}`;
      if (d) {
        patchData<'deployment'>(d, f, { title, projectId });
        relink(d, projectId);
        result = d;
        toast('Deployment saved', title);
        return;
      }
      const item = makeItem({
        kind: 'deployment',
        handle: uniqueHandle(`${slug(project?.title ?? hostOf(f.url))}-${slug(stageLabel(f))}`),
        title,
        projectId,
        data: { ...f, health: 'unknown' },
      }) as Deployment;
      addItem(item, projectId ? [{ from: item.id, to: projectId, label: 'deploys' }] : []);
      select([item.id]);
      result = item;
      toast('Deployment added', title);
    },
  });
  return result;
}
