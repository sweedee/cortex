/** Pure helpers of the deployment kind: stage chip, form values -> data, and the mocked status. */
import type { DeploymentData, Tone } from '../../domain';

export type Stage = DeploymentData['stage'];

export const STAGES: Stage[] = ['dev', 'staging', 'prod', 'custom'];

export const stageLabel = (d: Pick<DeploymentData, 'stage' | 'stageLabel'>) => (d.stage === 'custom' ? d.stageLabel?.trim() || 'custom' : d.stage);

/** prod stands out (critical), dev stays neutral. */
export const STAGE_TONE: Record<Stage, Tone> = { dev: 'neutral', staging: 'primary', prod: 'critical', custom: 'pending' };

export const guessStage = (url: string): Stage => (/\bdev\b|dev\.|localhost/i.test(url) ? 'dev' : /stag/i.test(url) ? 'staging' : 'prod');

export const isHttpUrl = (s: string) => /^https?:\/\/[^\s/]+/i.test(s.trim());

export interface DeploymentForm {
  url: string;
  stage: string;
  stageLabel: string;
}

/** Form values -> the data fields (throws a readable error). `https://` is added to bare hosts. */
export function deploymentFields(v: DeploymentForm): Pick<DeploymentData, 'url' | 'stage' | 'stageLabel'> {
  const raw = v.url.trim();
  if (!raw) throw new Error('URL is required.');
  const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  if (!isHttpUrl(url)) throw new Error('Use an http(s) URL.');
  if (!STAGES.includes(v.stage as Stage)) throw new Error('Pick a stage.');
  const stage = v.stage as Stage;
  const label = v.stageLabel.trim();
  if (stage === 'custom' && !label) throw new Error('Give the custom stage a label.');
  return { url, stage, stageLabel: stage === 'custom' ? label : undefined };
}

// ---- mocked status ------------------------------------------------------------------

export interface DeploymentStatus {
  health: 'up' | 'degraded' | 'down';
  version: string;
  /** epoch ms */
  deployedAt: number;
  responseMs: number;
}

/** FNV-1a, 32 bit. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const DAY = 86_400_000;

/**
 * MOCK status. Deterministic from the item id (health, version, deploy time, base latency) plus a
 * little jitter that changes every 15 s (response time), so it looks alive but is stable to test.
 *
 * Real health check plug-in point: replace this function with a query (a `fetch(url + '/health')` from
 * main via a new `deploy:health` IPC channel, or a Dynatrace / Prometheus lookup) returning the same
 * `DeploymentStatus`, keep the shape, and drop the "mock" label in `Sidebar.tsx`.
 *
 * `known` lets the item's cached fields win (so the ring and the sidebar agree).
 */
export function mockStatus(id: string, now = Date.now(), known: { health?: string; version?: string } = {}): DeploymentStatus {
  const h = hash(id);
  const roll = h % 100;
  const health = known.health === 'up' || known.health === 'degraded' || known.health === 'down' ? known.health : roll < 80 ? 'up' : roll < 94 ? 'degraded' : 'down';
  const version = known.version || `${1 + ((h >>> 8) % 3)}.${(h >>> 12) % 20}.${(h >>> 20) % 10}`;
  const day = Math.floor(now / DAY) * DAY;
  const deployedAt = day - ((h >>> 4) % 9) * DAY - ((h >>> 16) % 20) * 3_600_000;
  const jitter = hash(`${id}:${Math.floor(now / 15_000)}`) % 40;
  const base = 70 + ((h >>> 6) % 180);
  const responseMs = health === 'down' ? 0 : health === 'degraded' ? base * 4 + jitter * 5 : base + jitter;
  return { health, version, deployedAt, responseMs };
}

export const HEALTH_TONE: Record<DeploymentStatus['health'], Tone> = { up: 'success', degraded: 'warning', down: 'critical' };
