/**
 * Claude permission modes that let an agent act without asking (`bypassPermissions`, `dontAsk`)
 * are only accepted from the renderer after the user confirmed them in a native dialog in main,
 * once per mode per app run. The renderer renders untrusted content, so it must not be able to
 * switch an agent to "run anything" on its own.
 */
export const UNATTENDED_MODES = ['bypassPermissions', 'dontAsk'] as const;

const unattended = new Set<string>(UNATTENDED_MODES);

export class ModeGate {
  private readonly confirmed = new Set<string>();
  private readonly pending = new Map<string, Promise<boolean>>();
  private readonly ask: (mode: string) => Promise<boolean>;

  /** `ask(mode)` shows the dialog and resolves true when the user agreed */
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
