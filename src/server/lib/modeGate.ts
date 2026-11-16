/**
 * Claude permission modes that let an agent act without asking (`bypassPermissions`, `dontAsk`)
 * are only accepted from the renderer once `ask(mode)` agreed, once per mode per server run. The
 * renderer renders untrusted content, so it must not be able to switch an agent to "run anything"
 * on its own. The server has no UI of its own, so the answer comes from outside the page:
 * `allowedUnattendedModes` (CORTEX_ALLOW_UNATTENDED, set by the person who starts the server).
 */
export const UNATTENDED_MODES = ['bypassPermissions', 'dontAsk'] as const;

const unattended = new Set<string>(UNATTENDED_MODES);

export class ModeGate {
  private readonly confirmed = new Set<string>();
  private readonly pending = new Map<string, Promise<boolean>>();
  private readonly ask: (mode: string) => Promise<boolean>;

  /** `ask(mode)` resolves true when the user agreed (it may also reject with its own reason) */
  constructor(ask: (mode: string) => Promise<boolean>) {
    this.ask = ask;
  }

  /** resolves when `mode` may be used; throws when the user declined */
  async require(mode: string | undefined): Promise<void> {
    if (!mode || !unattended.has(mode) || this.confirmed.has(mode)) return;
    // concurrent starts (several agents resuming) share one dialog
    let p = this.pending.get(mode);
    if (!p) {
      p = this.ask(mode).finally(() => this.pending.delete(mode));
      this.pending.set(mode, p);
    }
    if (await p) this.confirmed.add(mode);
    else throw new Error(`Permission mode "${mode}" was not confirmed`);
  }
}

/**
 * `ask` for ModeGate from `CORTEX_ALLOW_UNATTENDED=bypassPermissions,dontAsk` (comma-separated; `all`
 * for both): a listed mode is allowed, anything else is refused with a hint how to allow it.
 */
export function allowedUnattendedModes(env: NodeJS.ProcessEnv): (mode: string) => Promise<boolean> {
  const raw = (env['CORTEX_ALLOW_UNATTENDED'] ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  const allowed = new Set<string>(raw.includes('all') ? UNATTENDED_MODES : raw);
  return async (mode) => {
    if (allowed.has(mode)) return true;
    throw new Error(`Permission mode "${mode}" is not allowed: start the Cortex server with CORTEX_ALLOW_UNATTENDED=${mode} to let agents run in it`);
  };
}
