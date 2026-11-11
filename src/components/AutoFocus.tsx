import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';

/** Focuses the first input inside shortly after mount (Strato inputs do not take `autoFocus`). */
export function AutoFocus({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Deferred: when opened from a menu, the menu hands focus back to its trigger as it closes.
    const timer = setTimeout(() => ref.current?.querySelector<HTMLElement>('input, textarea')?.focus(), 150);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div ref={ref} style={style}>
      {children}
    </div>
  );
}
