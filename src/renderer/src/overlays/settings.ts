/**
 * Global settings (HUD gear): Claude model / permission mode for new sessions, the AI-review
 * comment, the refresh interval, notifications, plus read-only paths and the Jira mode.
 * Project settings (paths, commands) live on the project bubble instead.
 */
import { loadIntegrationConfig } from '../data/app';
import { toggleDesktop } from '../desktop';
import { native } from '../native';
import { getState, setSettings, setSoundOn, setDesktopNotify } from '../store';
import { openForm, str, type FormValues } from '../ui/form';
import { errorText } from '../ui/task';
import type { Settings } from '../store';

const PERMISSION_MODES: { value: Settings['permissionMode']; label: string }[] = [
  { value: 'default', label: 'CLI default (no flag)' },
  { value: 'manual', label: 'manual: ask before every tool' },
  { value: 'acceptEdits', label: 'acceptEdits: edits run, other tools ask' },
  { value: 'plan', label: 'plan: read-only planning' },
  { value: 'auto', label: 'auto: Claude decides what needs asking' },
  { value: 'dontAsk', label: "dontAsk: deny what isn't pre-approved" },
  { value: 'bypassPermissions', label: 'bypassPermissions: run everything (careful)' },
];

/** Form values → the settings patch (pure, tested). Blank text = unset (CLI / main default). */
export function settingsPatch(v: FormValues): Partial<Settings> {
  const mode = PERMISSION_MODES.find((m) => m.value === str(v, 'permissionMode'))?.value ?? 'default';
  return {
    model: str(v, 'model').trim() || undefined,
    permissionMode: mode,
    aiReviewComment: str(v, 'aiReviewComment').trim() || undefined,
    refreshSec: Math.round(Number(str(v, 'refreshSec'))),
  };
}

export const validRefresh = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 10 && n <= 3600 ? undefined : 'Whole seconds between 10 and 3600';
};

export async function openSettings() {
  const s = getState();
  const [workspacePath, info, config] = await Promise.all([
    native.workspace.path().catch((e: unknown) => `unknown (${errorText(e)})`),
    native.app.info().catch(() => undefined),
    loadIntegrationConfig().catch(() => undefined),
  ]);
  const jira = config ? (config.jira.cli === 'mock' ? `mock (scripts/jira-mock, site ${config.jira.site}); start with CORTEX_JIRA_CLI=acli for the real Atlassian CLI` : `${config.jira.cli} (Atlassian CLI)`) : 'unknown (desktop app only)';
  await openForm({
    title: 'Settings',
    description: 'Apply to new agent sessions and the whole canvas. Project paths and commands are in each project’s own settings.',
    submitLabel: 'Save',
    values: {
      model: s.settings.model ?? '',
      permissionMode: s.settings.permissionMode,
      aiReviewComment: s.settings.aiReviewComment ?? '',
      refreshSec: String(s.settings.refreshSec),
      desktopNotify: s.desktopNotify,
      soundOn: s.soundOn,
      workspacePath,
      userData: info?.userData || '–',
      jira,
    },
    fields: [
      { name: 'model', label: 'Claude model', type: 'text', placeholder: 'CLI default', hint: 'An alias (opus, sonnet) or a full model id. Blank = whatever the claude CLI uses.' },
      { name: 'permissionMode', label: 'Permission mode', type: 'select', options: PERMISSION_MODES, hint: 'claude --permission-mode for new sessions. Tool prompts show up as Allow / Deny on the agent bubble.' },
      { name: 'aiReviewComment', label: 'AI review comment', type: 'text', placeholder: config?.github.aiReviewComment ?? '@claude review', hint: 'Posted on a PR by “Request AI review”. Blank = the default shown.' },
      { name: 'refreshSec', label: 'Background refresh (seconds)', type: 'text', required: true, validate: validRefresh, hint: 'How often git / GitHub / Jira caches on the bubbles refresh (15 s while checks or builds run).' },
      { name: 'desktopNotify', label: 'Desktop notifications when Cortex is in the background', type: 'checkbox' },
      { name: 'soundOn', label: 'Sound for new notices', type: 'checkbox' },
      { name: 'workspacePath', label: 'Workspace file', type: 'info' },
      { name: 'userData', label: 'User data folder', type: 'info', hint: 'Window state, Jira mock data, Claude session list. Use CORTEX_USER_DATA=<dir> for a separate profile.' },
      { name: 'jira', label: 'Jira', type: 'info' },
    ],
    onSubmit: async (v) => {
      setSettings(settingsPatch(v));
      if (v.soundOn !== getState().soundOn) setSoundOn(v.soundOn === true);
      if (v.desktopNotify !== getState().desktopNotify) {
        if (v.desktopNotify === true) await toggleDesktop();
        else setDesktopNotify(false);
      }
    },
  });
}
