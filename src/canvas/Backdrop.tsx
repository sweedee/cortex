/** Floating particles in Dynatrace colours and the faint logo mark, with a little parallax. */
import { useEffect, useRef } from 'react';

const COLORS = ['#1496FF', '#6F2DA8', '#B455B6', '#73BE28', '#B4DC00', '#00A1B2'];

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
      raf = 0;
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
        r: 0.6 + Math.random() * 1.8,
        c: COLORS[Math.floor(Math.random() * COLORS.length)],
        depth: 0.05 + Math.random() * 0.25,
        phase: Math.random() * Math.PI * 2,
      }));
    };
    resize();
    window.addEventListener('resize', resize);

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      const { x: cx, y: cy } = cam.current;
      for (const p of ps) {
        if (!reduce) {
          p.x += p.vx;
          p.y += p.vy;
        }
        // parallax: deeper particles follow the camera less
        let sx = (((p.x + cx * p.depth) % w) + w) % w;
        let sy = (((p.y + cy * p.depth) % h) + h) % h;
        const tw = 0.35 + 0.35 * Math.sin(t / 1400 + p.phase);
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, p.r * 5);
        g.addColorStop(0, p.c);
        g.addColorStop(1, 'transparent');
        ctx.globalAlpha = tw * 0.55;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(sx, sy, p.r * 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = tw;
        ctx.fillStyle = p.c;
        ctx.beginPath();
        ctx.arc(sx, sy, p.r * 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (logo.current) logo.current.style.transform = `translate(calc(-50% + ${cx * 0.04}px), calc(-50% + ${cy * 0.04}px))`;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [cam]);

  return (
    <div className="backdrop" aria-hidden>
      <div className="backdrop-glow" />
      <img ref={logo} className="backdrop-logo" src="/dt-mark.svg" alt="" draggable={false} />
      <canvas ref={ref} className="backdrop-particles" />
    </div>
  );
}
