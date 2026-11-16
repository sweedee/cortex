/**
 * Feedback for actions: `runTask` for long mutations (spinner toast → success / critical toast),
 * `errorText` to show a failed native call, and the `openUrl` / `openPath` / `openInEditor`
 * helpers that report failures instead of throwing.
 */
import { ProgressCircle } from '@dynatrace/strato-components/content';
import { dismissToast, showToast } from '@dynatrace/strato-components/notifications';
import { useEffect } from 'react';
import { ipcErrorMessage } from '../../../shared/ipcError';
import { native } from '../native';
import { startProgressToast } from './progressToast';

/** A readable message of a failed native call (the server error payload's message when there is one). */
export const errorText = ipcErrorMessage;

export interface TaskOptions<T> {
  /** success toast title (default: the label + " done"); a function gets the result */
  success?: string | ((result: T) => string);
  /** success toast message */
  message?: string | ((result: T) => string | undefined);
  /** no success toast (the caller shows its own) */
  quiet?: boolean;
}

/**
 * Show a spinner toast while `work` runs, then a success toast (or a critical one with the
 * error message). Resolves with the result, or `undefined` when it failed (never rejects).
 *
 *   await runTask('Merging #482', codeHost(provider).prMerge(repo, 482, 'squash'), { success: '#482 merged' });
 */
export async function runTask<T>(label: string, work: Promise<T> | (() => Promise<T>), opts: TaskOptions<T> = {}): Promise<T | undefined> {
  const progress = startProgressToast({
    show: (id) =>
      void showToast({
        id,
        type: 'info',
        title: `${label}…`,
        lifespan: 'infinite',
        message: <TaskProgress label={label} onMount={() => progress.mounted()} />,
      }),
    dismiss: dismissToast,
  });
  try {
    const result = await (typeof work === 'function' ? work() : work);
    progress.finish();
    if (!opts.quiet) {
      const title = typeof opts.success === 'function' ? opts.success(result) : (opts.success ?? `${label} done`);
      const message = typeof opts.message === 'function' ? opts.message(result) : opts.message;
      showToast({ type: 'success', title, message, lifespan: 3500 });
    }
    return result;
  } catch (e) {
    progress.finish();
    console.warn(`[task] ${label} failed`, e);
    showToast({ type: 'critical', title: `${label} failed`, message: errorText(e), lifespan: 10_000 });
    return undefined;
  }
}

/** The spinner toast's content; tells the controller when the (possibly queued) toast is really on screen. */
function TaskProgress({ label, onMount }: { label: string; onMount: () => void }) {
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- once, when the toast appears
  useEffect(onMount, []);
  return (
    <span className="task-progress">
      <ProgressCircle size="small" aria-label={label} />
      <span>Working on it</span>
    </span>
  );
}

const failed = (what: string, error?: string) => showToast({ type: 'warning', title: `Could not open ${what}`, message: error, lifespan: 6000 });

/** Open an http(s) URL in the OS browser. */
export async function openUrl(url: string) {
  if (!url) return failed('the link', 'No URL known.');
  const full = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    await native.shell.openExternal({ url: full });
  } catch (e) {
    failed(full, errorText(e));
  }
}

/** Show a folder / file in the OS (Explorer, Finder). */
export async function openPath(path: string) {
  if (!path) return failed('the folder', 'No path known.');
  const r = await native.shell.openPath({ path }).catch((e: unknown) => ({ ok: false, error: errorText(e) }));
  if (!r.ok) failed(path, r.error);
}

/** Open a folder / file in the editor (`code <path>`, falls back to the OS). */
export async function openInEditor(path: string) {
  if (!path) return failed('the folder', 'No path known.');
  const r = await native.shell.openInEditor({ path }).catch((e: unknown) => ({ ok: false, error: errorText(e) }));
  if (!r.ok) failed(path, r.error);
}
