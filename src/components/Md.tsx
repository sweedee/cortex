import { Markdown } from '@dynatrace/strato-components/content';

/** Markdown as used everywhere in Cortex. */
export function Md({ children }: { children: string }) {
  return <Markdown>{children}</Markdown>;
}
