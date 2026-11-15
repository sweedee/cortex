/**
 * Light / dark theme. The palette lives in index.css as tokens (`:root` = dark, overridden under
 * `[data-theme="light"]`); this module only decides which one applies and sets `data-theme` and
 * `color-scheme` on <html>. Strato's tokens key off the same attribute, so components, viewers
 * (CodeMirror, diff, markdown, log) and mermaid follow along.
 *
 * Strato's AppRoot reads the theme once from the web runtime (runtime.ts → `bootTheme`) and never
 * again, so later changes (an OS switch with "system", or a new preference) are applied here.
 */
import { useLayoutEffect, useSyncExternalStore } from 'react';

export type ThemePref = 'dark' | 'light' | 'system';
export type Theme = 'dark' | 'light';

export const THEME_PREFS: readonly ThemePref[] = ['system', 'dark', 'light'];

/** Anything stored (config, old builds) to a known preference; unknown means "follow the OS". */
export const parseThemePref = (v: unknown): ThemePref => (v === 'dark' || v === 'light' || v === 'system' ? v : 'system');

/** The theme a preference ends up as. */
export const resolveTheme = (pref: ThemePref | undefined, systemDark: boolean): Theme =>
  pref === 'dark' || pref === 'light' ? pref : systemDark ? 'dark' : 'light';

const darkQuery = () => (typeof window !== 'undefined' ? window.matchMedia?.('(prefers-color-scheme: dark)') : undefined);
/** The OS asks for dark (dark-first when unknown). */
export const systemPrefersDark = () => darkQuery()?.matches ?? true;

function subscribeSystem(cb: () => void) {
  const mq = darkQuery();
  mq?.addEventListener('change', cb);
  return () => mq?.removeEventListener('change', cb);
}

/** Set the theme on the document (and on Strato's AppRoot element, which carries its own copy). */
export function applyTheme(theme: Theme, doc: Document = document) {
  const root = doc.documentElement;
  root.setAttribute('data-theme', theme);
  root.style.colorScheme = theme;
  doc.querySelectorAll('[data-dt-component="AppRoot"]').forEach((el) => el.setAttribute('data-theme', theme));
}

/**
 * The user's theme preference: the one place to switch to the `ui.theme` config value once it
 * exists. Until then the app follows the OS.
 */
export function useThemePref(): ThemePref {
  return 'system';
}

/** Theme before React runs (Strato's AppRoot asks for it once at mount). */
export const bootTheme = (): Theme => resolveTheme('system', systemPrefersDark());

/** The active theme; keeps the document in sync with the preference and the OS. */
export function useTheme(): Theme {
  const pref = useThemePref();
  const systemDark = useSyncExternalStore(subscribeSystem, systemPrefersDark, () => true);
  const theme = resolveTheme(pref, systemDark);
  useLayoutEffect(() => applyTheme(theme), [theme]);
  return theme;
}

/** Mount once inside AppRoot. */
export function ThemeSync() {
  useTheme();
  return null;
}
