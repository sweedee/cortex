/** Focus helpers: first field on open, focus back to the opener on close, IME-safe Enter. */
import { useCallback, useEffect, useRef } from 'react';

const FIELD = 'input:not([type=hidden]):not([disabled]), textarea:not([disabled])';

/** Focus the first text field in (or at) `el`. */
export function focusFirstField(el: HTMLElement | null) {
  const target = el?.matches(FIELD) ? el : el?.querySelector<HTMLElement>(FIELD);
  target?.focus({ preventScroll: true });
}

/**
 * Callback ref that focuses the first field inside the element as soon as it is attached.
 * Strato inputs have no `autoFocus`; a callback ref runs in the commit, before the modal's own
 * focus scope looks for something to focus (it keeps focus that is already inside). Pass a `key`
 * to focus again when it changes (e.g. the field is swapped for another type).
 */
export function useAutoFocus<T extends HTMLElement>(key?: unknown) {
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- `key` only re-creates the ref
  return useCallback((el: T | null) => focusFirstField(el), [key]);
}

/**
 * While `open`, remember what had focus when it opened; when it closes (or unmounts) and focus
 * was lost with it (it sat inside the closed panel, now on <body>), put focus back there, or on
 * `fallback()` if the opener is gone. Focus that moved somewhere real meanwhile is left alone.
 */
export function useReturnFocus(open: boolean, fallback?: () => HTMLElement | null | undefined) {
  const fb = useRef(fallback);
  useEffect(() => {
    fb.current = fallback;
  });
  useEffect(() => {
    if (!open) return;
    const a = document.activeElement;
    const opener = a instanceof HTMLElement && a !== document.body ? a : null;
    return () => {
      // passive cleanup: the panel is out of the DOM by now, so lost focus sits on <body>
      const now = document.activeElement;
      if (now && now !== document.body && now.isConnected) return;
      const target = opener?.isConnected ? opener : fb.current?.();
      target?.focus({ preventScroll: true });
    };
  }, [open]);
}

/** An IME composition is in progress: Enter confirms the composition, it must not submit. */
export const isComposing = (e: { nativeEvent?: { isComposing?: boolean }; isComposing?: boolean; keyCode?: number }) =>
  !!(e.nativeEvent?.isComposing ?? e.isComposing) || e.keyCode === 229;
