/**
 * Lifecycle of a `runTask` spinner toast, kept free of React / Strato so it can be tested.
 *
 * Why: Strato's toasts are react-toastify with `limit: 5`. A toast shown while five are open is
 * queued, and `dismissToast(id)` only removes toasts that are on screen, not queued ones. A spinner
 * toast (lifespan infinite) dismissed while queued would therefore pop up later and never close.
 * So the spinner (1) is only shown when the work takes longer than `delayMs`, and (2) renders a
 * content component that calls `mounted()` when it really appears: if the work has finished by then
 * it dismisses itself right away.
 */
export interface ProgressToastApi {
  /** show the spinner toast with this id */
  show(id: string): void;
  dismiss(id: string): void;
  setTimeout?(fn: () => void, ms: number): unknown;
  clearTimeout?(t: unknown): void;
}

export interface ProgressToast {
  id: string;
  /** the spinner's content mounted, i.e. the toast is on screen now */
  mounted(): void;
  /** the work is over: dismiss the spinner now, or as soon as it shows */
  finish(): void;
  readonly shown: boolean;
  readonly done: boolean;
}

let seq = 0;

export function startProgressToast(api: ProgressToastApi, delayMs = 400): ProgressToast {
  const id = `task-${++seq}`;
  const set = api.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const clear = api.clearTimeout ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  let shown = false;
  let done = false;
  const timer = set(() => {
    if (done) return;
    shown = true;
    api.show(id);
  }, delayMs);
  return {
    id,
    get shown() {
      return shown;
    },
    get done() {
      return done;
    },
    mounted() {
      if (done) api.dismiss(id);
    },
    finish() {
      if (done) return;
      done = true;
      clear(timer);
      if (shown) api.dismiss(id);
    },
  };
}
