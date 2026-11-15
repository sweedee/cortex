import { Suspense, lazy, type ComponentType } from 'react';

/** Lazy-load a heavy viewer and hide the Suspense plumbing: callers use it like a normal component. */
export function lazyViewer<P extends object>(load: () => Promise<{ default: ComponentType<P> }>, name: string): ComponentType<P> {
  const Inner = lazy(load) as unknown as ComponentType<P>;
  const Wrapped = (props: P) => (
    <Suspense
      fallback={
        <div className="cxv-loading" role="status">
          Loading {name}…
        </div>
      }
    >
      <Inner {...props} />
    </Suspense>
  );
  Wrapped.displayName = `Lazy(${name})`;
  return Wrapped;
}
