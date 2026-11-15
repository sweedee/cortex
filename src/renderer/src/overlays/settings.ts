/**
 * Global settings (HUD gear): Claude model / effort / permission mode for new sessions (the chat
 * box's pickers change the same values), the AI-review comment, the refresh interval, notifications.
 * They are saved in `~/.cortex/config.json` (`config:update`, `data/config.ts`); the bubble colour
 * is workspace state. Read-only: paths and the Jira mode. Project settings (paths, commands) live on
 * the project bubble instead. Editor, Claude binary, Jira fields, branch template, ... are edited in
 * config.json itself.
 */
import { loadIntegrationConfig } from '../data/app';
import type { ThemePref } from '../theme';
import { configOps, userConfig } from '../data/config';
import { toggleDesktop } from '../desktop';
import { native } from '../native';
import { getState, setColorBy, setDesktopNotify, type ColorBy } from '../store';
import { openForm, str, type FormValues } from '../ui/form';
import { errorText } from '../ui/task';
import type { Settings } from '../store';
import { EFFORT_LEVELS, type ClaudeCatalog } from '../../../shared/integrations/claude';
import { DEFAULT_USER_CONFIG, type UserConfigPatch, type UserConfigState } from '../../../shared/userConfig';
import { effortChoices, modelChoices, PERMISSION_CHOICES } from '../chat/sessionOptions';

const PERMISSION_MODES: { value: Settings['permissionMode']; label: string }[] = PERMISSION_CHOICES.map((c) => ({
  value: c.value,
  label: c.value === 'default' ? 'CLI default (no flag)' : `${c.label}: ${c.hint}`,
}));
/** select value for "no flag" (a select can't hold '') */
const DEFAULT = 'default';

/** Model select options: the CLI's models (or the aliases) plus the current custom value. */
export const modelOptions = (catalog: ClaudeCatalog | undefined, current?: string) =>
  modelChoices(catalog, current).map((c) => ({ value: c.value || DEFAULT, label: c.value ? `${c.label}${c.hint ? ` — ${c.hint}` : ''}` : 'CLI default (no flag)' }));
const EFFORT_OPTIONS = effortChoices().map((c) => ({ value: c.value || DEFAULT, label: c.value ? `${c.label}: ${c.hint}` : 'CLI default (no flag)' }));

export const THEME_OPTIONS: { value: ThemePref; label: string }[] = [
  { value: 'system', label: 'System (follow the OS)' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
];

export const COLOR_BY: { value: ColorBy; label: string }[] = [
  { value: 'project', label: 'Project (one colour per project and everything linked to it)' },
  { value: 'ticket', label: 'Ticket (one colour per ticket)' },
  { value: 'none', label: 'Gray (no colouring)' },
];

/**
 * Form values → the config.json patch (pure, tested). Blank model / effort = `null` (CLI default),
 * blank AI comment = `null` (removed from the file: the default).
 */
export function settingsPatch(v: FormValues): UserConfigPatch {
  const mode = PERMISSION_MODES.find((m) => m.value === str(v, 'permissionMode'))?.value ?? 'default';
  const model = str(v, 'modelCustom').trim() || str(v, 'model').trim();
  const effort = EFFORT_LEVELS.find((e) => e === str(v, 'effort'));
  return {
    claude: { model: model && model !== DEFAULT ? model : null, effort: effort ?? null, permissionMode: mode },
    github: { aiReviewComment: str(v, 'aiReviewComment').trim() || null },
    refresh: { intervalSec: Math.round(Number(str(v, 'refreshSec'))) },
    ui: { sound: v.soundOn === true, theme: THEME_OPTIONS.find((t) => t.value === str(v, 'theme'))?.value ?? 'system', animations: v.animations !== false },
  };
}

/** The config file line of the dialog: its path, and what in it was not usable. */
export const configFileInfo = (s: UserConfigState | undefined) => (s ? [s.path, ...s.problems].join(' · ') : 'unknown (desktop app only)');

export const validRefresh = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 10 && n <= 3600 ? undefined : 'Whole seconds between 10 and 3600';
};

export async function openSettings() {
  const s = getState();
  const [workspacePath, info, config, catalog, configState] = await Promise.all([
    native.workspace.path().catch((e: unknown) => `unknown (${errorText(e)})`),
    native.app.info().catch(() => undefined),
    loadIntegrationConfig().catch(() => undefined),
    native.claude.catalog().catch(() => undefined),
    native.config.get().catch(() => undefined),
  ]);
  const cfg = configState?.config ?? userConfig();
  const models = modelOptions(catalog, s.settings.model);
  const jira = config
    ? [config.jira.cli === 'mock' ? 'mock (scripts/jira-mock)' : 'Atlassian CLI (acli)', config.jira.site && `site ${config.jira.site}`, config.jira.note].filter(Boolean).join(' · ')
    : 'unknown (desktop app only)';
  await openForm({
    title: 'Settings',
    description: 'Apply to new agent sessions and the whole canvas. Project paths and commands are in each project’s own settings.',
    submitLabel: 'Save',
    values: {
      colorBy: s.colorBy,
      model: cfg.claude.model ?? DEFAULT,
      modelCustom: '',
      effort: cfg.claude.effort ?? DEFAULT,
      permissionMode: cfg.claude.permissionMode,
      // the default shows as the placeholder: blank keeps following it
      aiReviewComment: cfg.github.aiReviewComment === DEFAULT_USER_CONFIG.github.aiReviewComment ? '' : cfg.github.aiReviewComment,
      refreshSec: String(cfg.refresh.intervalSec),
      desktopNotify: s.desktopNotify,
      soundOn: cfg.ui.sound,
      theme: cfg.ui.theme,
      animations: cfg.ui.animations,
      configPath: configFileInfo(configState),
      workspacePath,
      userData: info?.userData || '–',
      jira,
    },
    fields: [
      { name: 'colorBy', label: 'Bubble colour', type: 'select', options: COLOR_BY, hint: 'What the colour of a bubble stands for on the canvas.' },
      {
        name: 'model',
        label: 'Claude model',
        type: 'select',
        options: models,
        hint: 'claude --model for new sessions (also the model picker under the chat box). A running session changes its model from its own composer.',
      },
      { name: 'modelCustom', label: 'Or a full model id', type: 'text', placeholder: 'e.g. claude-opus-5-5', hint: 'Overrides the selection above when filled.' },
      { name: 'effort', label: 'Effort', type: 'select', options: EFFORT_OPTIONS, hint: 'claude --effort for new sessions. Low to xhigh also change live in a running session; max only at start.' },
      {
        name: 'permissionMode',
        label: 'Permission mode',
        type: 'select',
        options: PERMISSION_MODES,
        hint: 'claude --permission-mode for new sessions (changes live in a running session). Tool prompts show up as Allow / Deny on the agent bubble.',
      },
      {
        name: 'aiReviewComment',
        label: 'AI review comment',
        type: 'text',
        placeholder: DEFAULT_USER_CONFIG.github.aiReviewComment,
        hint: 'Posted on a PR by “Request AI review”. Blank = the default shown.',
      },
      {
        name: 'refreshSec',
        label: 'Background refresh (seconds)',
        type: 'text',
        required: true,
        validate: validRefresh,
        hint: 'How often git / GitHub / Jira caches on the bubbles refresh (15 s while checks or builds run).',
      },
      { name: 'desktopNotify', label: 'Desktop notifications when Cortex is in the background', type: 'checkbox' },
      { name: 'soundOn', label: 'Sound for new notices', type: 'checkbox' },
      { name: 'theme', label: 'Theme', type: 'select', options: THEME_OPTIONS },
      { name: 'animations', label: 'Animations (backdrop particles, floating bubbles)', type: 'checkbox', hint: 'The OS setting “reduce motion” always turns them off.' },
      {
        name: 'configPath',
        label: 'Config file',
        type: 'info',
        hint: 'These settings are saved there. Editor, Claude binary, Jira custom fields, branch template, records folder and more are set in the file itself (they apply right away; claude.bin and jira.cli after a restart).',
      },
      { name: 'workspacePath', label: 'Workspace file', type: 'info', hint: 'The canvas: items, links, bubble colour, filter, sidebar width.' },
      { name: 'userData', label: 'User data folder', type: 'info', hint: 'Config, window state, Jira mock data, Claude session list. Use CORTEX_USER_DATA=<dir> for a separate profile.' },
      { name: 'jira', label: 'Jira', type: 'info' },
    ],
    onSubmit: async (v) => {
      // config.json (validated in main; an error keeps the dialog open)
      await configOps.update(settingsPatch(v));
      const by = COLOR_BY.find((c) => c.value === str(v, 'colorBy'))?.value;
      if (by && by !== getState().colorBy) setColorBy(by);
      // needs the OS / browser permission first; the store change goes to config.json (data/config.ts)
      if (v.desktopNotify !== getState().desktopNotify) {
        if (v.desktopNotify === true) await toggleDesktop();
        else setDesktopNotify(false);
      }
    },
  });
}
