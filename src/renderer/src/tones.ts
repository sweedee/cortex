/** Tone → colour / Strato colour mappings. Pure (no store), so kind modules can use it. */
import type { Tone } from './domain';

/** CSS colours (Strato tokens where one fits, Dynatrace brand colours otherwise). */
export const TONE_COLOR: Record<Tone, string> = {
  success: 'var(--tone-success)',
  warning: 'var(--tone-warning)',
  critical: 'var(--tone-critical)',
  running: 'var(--tone-running)',
  primary: 'var(--tone-primary)',
  pending: 'var(--tone-pending)',
  neutral: 'var(--tone-neutral)',
};

export const TONE_CHIP: Record<Tone, 'neutral' | 'primary' | 'success' | 'warning' | 'critical'> = {
  success: 'success',
  warning: 'warning',
  critical: 'critical',
  running: 'primary',
  primary: 'primary',
  pending: 'neutral',
  neutral: 'neutral',
};

export const TONE_TOAST: Record<Tone, 'info' | 'warning' | 'critical' | 'success'> = {
  success: 'success',
  warning: 'warning',
  critical: 'critical',
  running: 'info',
  primary: 'info',
  pending: 'info',
  neutral: 'info',
};

/** "12 min ago" style, from an epoch-ms timestamp. */
export function agoText(at: number, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - at) / 60_000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
}

/** "12m" style, for compact lists. */
export function agoShort(at: number, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - at) / 60_000));
  return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
}
