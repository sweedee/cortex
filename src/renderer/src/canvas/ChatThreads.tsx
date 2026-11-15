/** Dashed threads from the chat box to every bubble the draft @mentions. */
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { positionOf } from '../layout';
import { accentOf } from '../visual';
import { threadPath, useOnPlace } from './positions';

type Rect = { left: number; top: number; width: number };

/**
 * The chat box's screen rect, measured only when it can have changed (its size, the window
 * size or the sidebar space changed), never per render or per frame.
 */
function useChatboxRect(): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);
  useEffect(() => {
    let el: Element | null = null;
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el ??= document.querySelector('.chatbox');
        if (!el) return;
        const r = el.getBoundingClientRect();
        setRect((cur) => (cur && cur.left === r.left && cur.top === r.top && cur.width === r.width ? cur : { left: r.left, top: r.top, width: r.width }));
      });
    };
    const ro = new ResizeObserver(measure);
    // the chat box mounts next to the canvas; give it a frame if it is not there yet
    const attach = () => {
      el = document.querySelector('.chatbox');
      if (el) ro.observe(el);
    };
    attach();
    if (!el) requestAnimationFrame(() => (attach(), measure()));
    // the dock moves (without resizing) when the details sidebar opens: it sets --sidebar-space
    const mo = new MutationObserver(measure);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    window.addEventListener('resize', measure);
    measure();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);
  return rect;
}

export const ChatThreads = memo(function ChatThreads({ ids, colors, cam }: { ids: string[]; colors: Map<string, string[]>; cam: { x: number; y: number; k: number } }) {
  const chat = useChatboxRect();
  const svg = useRef<SVGSVGElement>(null);
  const draw = () => {
    const el = svg.current;
    if (!el || !chat) return;
    const n = el.children.length;
    [...el.children].forEach((path, i) => {
      const p = positionOf((path as SVGPathElement).dataset.id!);
      if (p?.x == null || p.y == null) return path.setAttribute('d', '');
      const ox = chat.left + chat.width / 2 + (i - (n - 1) / 2) * 26;
      path.setAttribute('d', threadPath(ox, chat.top, p.x * cam.k + cam.x, p.y * cam.k + cam.y));
    });
  };
  useLayoutEffect(draw);
  useOnPlace(draw);
  if (!chat || !ids.length) return null;
  return (
    <svg ref={svg} className="chat-threads" width="100%" height="100%" aria-hidden>
      {ids.map((id) => (
        <path key={id} data-id={id} style={{ stroke: accentOf(colors, id) }} />
      ))}
    </svg>
  );
});
