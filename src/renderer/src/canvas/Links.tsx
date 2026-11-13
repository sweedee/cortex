import type { Item, Link } from '../model';
import { positionOf } from '../layout';

/** Curved connections between bubbles, drawn in world space beneath them. */
export function Links({
  links,
  items,
  active,
  hidden,
}: {
  links: Link[];
  items: Map<string, Item>;
  /** ids of links that touch the hovered/selected bubbles */
  active: Set<string>;
  hidden: Set<string>;
}) {
  const anyActive = active.size > 0;
  return (
    <svg className="links" width="1" height="1" aria-hidden>
      {links.map((l) => {
        if (hidden.has(l.from) || hidden.has(l.to)) return null;
        const a = positionOf(l.from);
        const b = positionOf(l.to);
        if (!a || !b || a.x == null || b.x == null) return null;
        const ax = a.x!,
          ay = a.y!,
          bx = b.x!,
          by = b.y!;
        const dx = bx - ax,
          dy = by - ay;
        const len = Math.hypot(dx, dy) || 1;
        // bend a little, perpendicular to the line
        const bend = Math.min(len * 0.12, 40);
        const cx = (ax + bx) / 2 - (dy / len) * bend;
        const cy = (ay + by) / 2 + (dx / len) * bend;
        const isActive = active.has(l.id);
        const live = items.get(l.from)?.flags?.running || items.get(l.to)?.flags?.running;
        return (
          <g key={l.id} className={`link ${isActive ? 'is-active' : ''} ${anyActive && !isActive ? 'is-dimmed' : ''} ${live ? 'is-live' : ''}`}>
            <path d={`M${ax},${ay} Q${cx},${cy} ${bx},${by}`} className="link-path" />
            {live && <path d={`M${ax},${ay} Q${cx},${cy} ${bx},${by}`} className="link-flow" />}
          </g>
        );
      })}
    </svg>
  );
}
