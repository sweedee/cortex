import { memo, useCallback, useLayoutEffect, useRef } from 'react';
import type { Link } from '../domain';
import type { ItemView } from '../kinds/registry';
import { positionOf } from '../layout';
import { linkPath, useOnPlace } from './positions';

/**
 * Curved connections between bubbles, drawn in world space beneath them. React renders the
 * elements (which links, their state); the path geometry is written on every layout tick.
 */
export const Links = memo(function Links({
  links,
  views,
  active,
  hidden,
}: {
  links: Link[];
  /** derived views; links to something running animate */
  views: Map<string, ItemView>;
  /** ids of links that touch the hovered/selected bubbles */
  active: Set<string>;
  hidden: Set<string>;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const draw = useCallback(() => {
    const el = svg.current;
    if (!el) return;
    for (const g of el.children) {
      const { from, to } = (g as SVGGElement).dataset;
      const d = from && to ? linkPath(positionOf(from), positionOf(to)) : '';
      for (const p of g.children) p.setAttribute('d', d);
    }
  }, []);
  // after every render (new links) and on every tick (moved bubbles)
  useLayoutEffect(draw);
  useOnPlace(draw);

  const anyActive = active.size > 0;
  return (
    <svg ref={svg} className="links" width="1" height="1" aria-hidden>
      {links.map((l) => {
        if (hidden.has(l.from) || hidden.has(l.to)) return null;
        const isActive = active.has(l.id);
        const live = views.get(l.from)?.running || views.get(l.to)?.running;
        return (
          <g key={l.id} data-from={l.from} data-to={l.to} className={`link ${isActive ? 'is-active' : ''} ${anyActive && !isActive ? 'is-dimmed' : ''} ${live ? 'is-live' : ''}`}>
            <path className="link-path" />
            {live && <path className="link-flow" />}
          </g>
        );
      })}
    </svg>
  );
});
