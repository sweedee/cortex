/** Floating pixel particles in brand colours and the faint logo mark, with a little parallax. */
import { useEffect, useRef } from 'react';
import { asset } from '../native';

/** particle grid size in css px */
const PX = 2;

const COLORS = ['#1496FF', '#6F2DA8', '#B455B6', '#73BE28', '#B4DC00', '#00A1B2'];

/** ~30 fps is plenty for slow drifting pixels (half the work of the display rate). */
const FRAME_MS = 1000 / 30;
/** particle speeds are per 60 fps frame */
const BASE_FRAME_MS = 1000 / 60;
/** stop animating after this long without input; the last frame stays on screen */
const IDLE_MS = 60_000;

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  c: string;
  depth: number;
  phase: number;
}

export function Backdrop({ cam }: { cam: React.MutableRefObject<{ x: number; y: number; k: number }> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const logo = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w = 0,
      h = 0,
      raf = 0,
      last = 0,
      lastInput = performance.now();
    let ps: P[] = [];

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round((w * h) / 16000);
      ps = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.12,
        vy: -0.03 - Math.random() * 0.1,
        r: 1 + Math.floor(Math.random() * Math.random() * 3), // 1-3 grid cells, mostly 1
        c: COLORS[Math.floor(Math.random() * COLORS.length)],
        depth: 0.05 + Math.random() * 0.25,
        phase: Math.random() * Math.PI * 2,
      }));
    };
    resize();
    window.addEventListener('resize', resize);

    const draw = (t: number) => {
      raf = 0;
      if (document.hidden) return; // resumes on visibilitychange
      if (t - lastInput > IDLE_MS) return; // resumes on the next input
      if (last && t - last < FRAME_MS - 1) {
        raf = requestAnimationFrame(draw);
        return;
      }
      // same drift speed at any frame rate (capped, so a long pause does not jump)
      const steps = last ? Math.min((t - last) / BASE_FRAME_MS, 4) : 1;
      last = t;
      ctx.clearRect(0, 0, w, h);
      const { x: cx, y: cy } = cam.current;
      for (const p of ps) {
        if (!reduce) {
          p.x += p.vx * steps;
          p.y += p.vy * steps;
        }
        // parallax: deeper particles follow the camera less
        const sx = (((p.x + cx * p.depth) % w) + w) % w;
        const sy = (((p.y + cy * p.depth) % h) + h) % h;
        // stepped twinkle and whole-pixel squares: crisp, no glow
        const tw = 0.3 + 0.15 * Math.round(2 * (1 + Math.sin(t / 1400 + p.phase)));
        const size = p.r * PX;
        ctx.globalAlpha = tw;
        ctx.fillStyle = p.c;
        ctx.fillRect(Math.round(sx / PX) * PX, Math.round(sy / PX) * PX, size, size);
      }
      ctx.globalAlpha = 1;
      if (logo.current) logo.current.style.transform = `translate(calc(-50% + ${cx * 0.04}px), calc(-50% + ${cy * 0.04}px))`;
      raf = requestAnimationFrame(draw);
    };
    const wake = () => {
      lastInput = performance.now();
      if (!raf && !document.hidden) {
        last = 0;
        raf = requestAnimationFrame(draw);
      }
    };
    raf = requestAnimationFrame(draw);
    // resize clears the canvas, so it wakes the loop too
    const inputs = ['pointermove', 'pointerdown', 'wheel', 'keydown', 'resize'] as const;
    inputs.forEach((e) => window.addEventListener(e, wake, { passive: true }));
    document.addEventListener('visibilitychange', wake);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      inputs.forEach((e) => window.removeEventListener(e, wake));
      document.removeEventListener('visibilitychange', wake);
    };
  }, [cam]);

  return (
    <div className="backdrop" aria-hidden>
      <div className="backdrop-glow" />
      <img ref={logo} className="backdrop-logo" src={asset('brand/cortex-mark.svg')} alt="" draggable={false} />
      <canvas ref={ref} className="backdrop-particles" />
    </div>
  );
}
