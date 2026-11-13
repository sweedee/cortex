/**
 * Notification chimes, synthesized with Web Audio (no asset files). Three distinct sounds:
 * attention (two rising notes), failure (two falling, darker notes) and success (a bright
 * three-note arpeggio). Plays for every new notice unless muted in the notifications menu.
 */
import type { Tone } from './domain';

export type Chime = 'attention' | 'failure' | 'success';

export const chimeFor = (tone: Tone): Chime => (tone === 'critical' ? 'failure' : tone === 'success' ? 'success' : 'attention');

/** [frequency Hz, start s, duration s] per note */
const NOTES: Record<Chime, { wave: OscillatorType; notes: [number, number, number][]; gain: number }> = {
  attention: { wave: 'sine', gain: 0.16, notes: [[659.25, 0, 0.22], [987.77, 0.12, 0.34]] }, // E5 → B5
  failure: { wave: 'triangle', gain: 0.2, notes: [[392, 0, 0.26], [277.18, 0.16, 0.42]] }, // G4 → C#4
  success: { wave: 'sine', gain: 0.14, notes: [[523.25, 0, 0.2], [659.25, 0.09, 0.2], [783.99, 0.18, 0.36]] }, // C5 E5 G5
};

let ctx: AudioContext | null = null;
let lastAt = 0;

export function playChime(chime: Chime): void {
  if (typeof AudioContext === 'undefined') return;
  // several notices at once (a batch of CI results) should not stack into noise
  const now = performance.now();
  if (now - lastAt < 250) return;
  lastAt = now;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const { wave, notes, gain } = NOTES[chime];
    const t0 = ctx.currentTime + 0.01;
    for (const [freq, start, dur] of notes) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = wave;
      osc.frequency.value = freq;
      // quick attack, exponential decay: a soft bell rather than a beep
      g.gain.setValueAtTime(0.0001, t0 + start);
      g.gain.exponentialRampToValueAtTime(gain, t0 + start + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
      osc.connect(g).connect(ctx.destination);
      osc.start(t0 + start);
      osc.stop(t0 + start + dur + 0.05);
    }
  } catch {
    /* no audio device */
  }
}
