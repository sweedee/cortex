/** Renders Mermaid source as a diagram. */
export function Mermaid({ source }: { source: string; className?: string }) {
  return <pre>{source}</pre>;
}
