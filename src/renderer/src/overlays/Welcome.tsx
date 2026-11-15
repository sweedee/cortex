/**
 * Two notices around an otherwise empty or unconfigured canvas:
 * - the first-run panel (no bubbles yet): "Add a project" and an optional "Load demo world";
 * - a banner when Jira has no working CLI (`integrations:config` → `jira.unavailable`) and tickets are on the canvas.
 */
import { useState } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { useIntegrationConfig } from '../data/app';
import { openProjectSettings } from '../kinds/project/settings';
import { loadDemoWorld } from '../persist';
import { useStore } from '../store';

export function Welcome() {
  const empty = useStore((s) => s.items.every((i) => i.archived));
  if (!empty) return null;
  return (
    <div className="welcome" role="region" aria-label="Getting started">
      <h2>Welcome to Cortex</h2>
      <p>Your projects, tickets, pull requests and agents as bubbles on one canvas. Start by adding a project: pick the folder of a repo&apos;s main checkout.</p>
      <div className="welcome-actions">
        <Button variant="accent" onClick={() => void openProjectSettings(undefined)}>
          Add a project
        </Button>
        <Button onClick={loadDemoWorld}>Load demo world</Button>
      </div>
      <p className="welcome-hint">
        The demo world is made up and static; nothing in it touches your disk or the network. GitHub needs <code>gh auth login</code>, Jira needs <code>acli jira auth login</code>.
      </p>
    </div>
  );
}

export function JiraBanner() {
  const cfg = useIntegrationConfig().data;
  const hasTickets = useStore((s) => s.items.some((i) => i.kind === 'ticket' && !i.archived));
  const [dismissed, setDismissed] = useState(false);
  if (!cfg?.jira.unavailable || !hasTickets || dismissed) return null;
  return (
    <div className="jira-banner" role="status">
      <span>{cfg.jira.note ?? 'Jira not configured: install acli and run `acli jira auth login`, or set jira.cli in config.json'}</span>
      <Button variant="default" onClick={() => setDismissed(true)}>
        Dismiss
      </Button>
    </div>
  );
}
