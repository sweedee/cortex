import { describe, expect, it } from 'vitest';
import type { Item, ItemOf } from '../../domain';
import { demoWorld } from '../../seed';
import { isDemoTicket } from './sync';
import { must } from '../../testing/must';

describe('ticket sync', () => {
  const demo = demoWorld();
  const project = demo.items.find((i) => i.kind === 'project') as ItemOf<'project'>;
  const tickets = demo.items.filter((i): i is ItemOf<'ticket'> => i.kind === 'ticket');

  it('skips the tickets of the demo world', () => {
    expect(tickets.length).toBeGreaterThan(0);
    for (const t of tickets) expect(isDemoTicket(t, project)).toBe(true);
  });

  it('still syncs tickets of real (or migrated unknown/…) projects', () => {
    const t = must(tickets[0]);
    for (const repo of ['acme/app', 'unknown/ingest']) expect(isDemoTicket(t, { ...project, data: { ...project.data, repo } } as Item)).toBe(false);
    expect(isDemoTicket(t, undefined)).toBe(false);
  });
});
