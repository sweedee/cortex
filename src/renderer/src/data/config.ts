/**
 * The user config (`~/.cortex/config.json`, `config:*`): a query hook, a synchronous getter for pure
 * helpers and actions, the update op, and the store mirror.
 *
 * The store keeps the settings the UI reads every frame (`settings.model`, `soundOn`, …). They mirror
 * config.json both ways: `config:changed` (also edits of the file in an editor) → store, and store
 * changes (chat box pickers, HUD toggles) → `config:update`. The gear dialog writes through `configOps`.
 */
import { useQuery } from '@tanstack/react-query';
import { showToast } from '@dynatrace/strato-components/notifications';
import { shallow } from 'zustand/shallow';
import { DEFAULT_USER_CONFIG, repoUrl, type UserConfig, type UserConfigPatch, type UserConfigState } from '../../../shared/userConfig';
import { native, notifyPermitted } from '../native';
import { appStore, setState, type State } from '../store';
import { queryClient } from './queryClient';
import { qk } from './queryKeys';

/** config.json as main sees it (path, problems included). */
export function useUserConfig() {
  return useQuery({ queryKey: qk.app.userConfig(), queryFn: () => native.config.get(), staleTime: Infinity });
}

/** The effective config outside React (defaults until it is loaded). */
export const userConfig = (): UserConfig => queryClient.getQueryData<UserConfigState>(qk.app.userConfig())?.config ?? DEFAULT_USER_CONFIG;

/** Web URL of a repo (or a path in it) on the configured GitHub host: the one place that builds them. */
export const repoWebUrl = (repo: string, path = ''): string => repoUrl(userConfig().github.host, repo, path);

/** The config values the store mirrors. */
export interface MirroredPrefs {
  model?: string;
  effort?: NonNullable<UserConfig['claude']['effort']>;
  permissionMode: UserConfig['claude']['permissionMode'];
  aiReviewComment: string;
  refreshSec: number;
  desktopNotify: boolean;
  soundOn: boolean;
}

export const mirrorOfConfig = (c: UserConfig): MirroredPrefs => ({
  model: c.claude.model ?? undefined,
  effort: c.claude.effort ?? undefined,
  permissionMode: c.claude.permissionMode,
  aiReviewComment: c.github.aiReviewComment,
  refreshSec: c.refresh.intervalSec,
  desktopNotify: c.ui.notifications,
  soundOn: c.ui.sound,
});

export const mirrorOfState = (s: State): MirroredPrefs => ({
  model: s.settings.model,
  effort: s.settings.effort,
  permissionMode: s.settings.permissionMode,
  aiReviewComment: s.settings.aiReviewComment,
  refreshSec: s.settings.refreshSec,
  desktopNotify: s.desktopNotify,
  soundOn: s.soundOn,
});

/** What changed between two mirrors, as a config patch (`undefined` = nothing). Unset model / effort → `null`. */
export function configPatchOf(prev: MirroredPrefs, next: MirroredPrefs): UserConfigPatch | undefined {
  const p: { claude?: Record<string, unknown>; github?: Record<string, unknown>; refresh?: Record<string, unknown>; ui?: Record<string, unknown> } = {};
  const set = (section: keyof typeof p, key: string, a: unknown, b: unknown) => {
    if (a !== b) (p[section] ??= {})[key] = b ?? null;
  };
  set('claude', 'model', prev.model, next.model);
  set('claude', 'effort', prev.effort, next.effort);
  set('claude', 'permissionMode', prev.permissionMode, next.permissionMode);
  set('github', 'aiReviewComment', prev.aiReviewComment, next.aiReviewComment);
  set('refresh', 'intervalSec', prev.refreshSec, next.refreshSec);
  set('ui', 'notifications', prev.desktopNotify, next.desktopNotify);
  set('ui', 'sound', prev.soundOn, next.soundOn);
  return Object.keys(p).length ? (p as UserConfigPatch) : undefined;
}

/** Two patches as one (later wins; keeps `null`s, unlike `mergePatch` into a file). */
export function combinePatches(a: UserConfigPatch | undefined, b: UserConfigPatch): UserConfigPatch {
  const out: Record<string, Record<string, unknown>> = {};
  for (const p of [a ?? {}, b]) for (const [section, values] of Object.entries(p)) out[section] = { ...out[section], ...(values as Record<string, unknown>) };
  return out as UserConfigPatch;
}

let applying = false;

/** A config state from main → the query cache and the store mirror (without writing it back). */
function apply(state: UserConfigState) {
  queryClient.setQueryData(qk.app.userConfig(), state);
  const m = mirrorOfConfig(state.config);
  applying = true;
  try {
    setState((s) => ({
      ...s,
      // desktop notifications also need the OS / browser permission
      desktopNotify: m.desktopNotify && notifyPermitted(),
      soundOn: m.soundOn,
      settings: { ...s.settings, model: m.model, effort: m.effort, permissionMode: m.permissionMode, aiReviewComment: m.aiReviewComment, refreshSec: m.refreshSec },
    }));
  } finally {
    applying = false;
  }
}

/** Writes (validated in main: only the gear-dialog settings, never `editor` / `claude.bin`). */
export const configOps = {
  async update(patch: UserConfigPatch, opts: { ifUnset?: boolean } = {}): Promise<UserConfigState> {
    const s = await native.config.update({ patch, ifUnset: opts?.ifUnset });
    apply(s);
    return s;
  },
};

let started = false;

/**
 * Load config.json into the store and keep both in sync. `movedPrefs`: settings a v3 workspace still
 * held (`parseWorkspace`), written once, only where config.json doesn't set them yet. Call after
 * `loadWorkspace`, before `startSync` (the refresher and record discovery read the config).
 */
export async function startConfigSync(movedPrefs?: UserConfigPatch): Promise<void> {
  if (started) return;
  started = true;
  if (movedPrefs) await native.config.update({ patch: movedPrefs, ifUnset: true }).catch((e: unknown) => console.warn('[config] could not move the workspace settings to config.json', e));
  try {
    apply(await native.config.get());
  } catch (e) {
    console.warn('[config] config:get failed, using the defaults', e);
  }
  native.config.onChanged(apply);

  // store → config.json, coalesced (a slider or several toggles in a row make one write)
  let pending: UserConfigPatch | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    const patch = pending;
    pending = undefined;
    if (!patch) return;
    configOps.update(patch).catch((e: unknown) => {
      console.warn('[config] could not save settings', e);
      showToast({ type: 'warning', title: 'Settings not saved', message: e instanceof Error ? e.message : String(e), lifespan: 8000 });
    });
  };
  appStore.subscribe(
    mirrorOfState,
    (next, prev) => {
      if (applying) return;
      const patch = configPatchOf(prev, next);
      if (!patch) return;
      pending = combinePatches(pending, patch);
      clearTimeout(timer);
      timer = setTimeout(flush, 300);
    },
    { equalityFn: shallow },
  );
  window.addEventListener('beforeunload', () => {
    if (timer) flush();
  });
}
