import { useEffect, useState } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { Chip } from '@dynatrace/strato-components/content';
import { EditIcon, ExternalLinkIcon } from '@dynatrace/strato-icons';
import { WebPanel } from '../../components/viewers';
import { ConnectionsSection, SidebarSection, SidebarTabs, SummarySection } from '../../sidebar';
import { agoText } from '../../tones';
import { openUrl } from '../../ui/task';
import { focusItem, Note, ToneChip, ValueRow } from '../project/parts';
import type { SidebarProps } from '../types';
import { openDeploymentForm } from './form';
import { HEALTH_TONE, mockStatus, stageLabel, STAGE_TONE } from './model';

/** The current time, refreshed every 15 s so the mocked response time visibly moves. */
function useNow(ms = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function Details({ item, ctx }: SidebarProps<'deployment'>) {
  const now = useNow();
  const project = ctx.projectOf(item);
  const st = mockStatus(item.id, now, item.data);
  return (
    <>
      <SummarySection item={item} ctx={ctx} />
      <SidebarSection
        label="Deployment"
        actions={
          <Button size="condensed" onClick={() => void openDeploymentForm({ deployment: item })}>
            <Button.Prefix>
              <EditIcon />
            </Button.Prefix>
            Edit
          </Button>
        }
      >
        <ValueRow
          label="URL"
          actions={
            <Button size="condensed" aria-label="Open in the browser" onClick={() => void openUrl(item.data.url)}>
              <Button.Prefix>
                <ExternalLinkIcon />
              </Button.Prefix>
            </Button>
          }
        >
          <span title={item.data.url}>{item.data.url}</span>
        </ValueRow>
        <ValueRow label="Stage">
          <ToneChip tone={STAGE_TONE[item.data.stage]}>{stageLabel(item.data)}</ToneChip>
        </ValueRow>
        <ValueRow label="Project">
          {project ? (
            <button className="sidebar-row" style={{ width: 'auto', margin: 0, padding: '2px 4px' }} onClick={() => focusItem(project.id)}>
              {project.title}
            </button>
          ) : (
            'none'
          )}
        </ValueRow>
      </SidebarSection>
      <SidebarSection
        label="Status"
        actions={
          <Chip size="condensed" color="neutral" title="Generated locally, not a real health check">
            mock
          </Chip>
        }
      >
        <ValueRow label="Health">
          <ToneChip tone={HEALTH_TONE[st.health]}>{st.health}</ToneChip>
        </ValueRow>
        <ValueRow label="Version">{st.version}</ValueRow>
        <ValueRow label="Last deployed">{agoText(st.deployedAt, now)}</ValueRow>
        <ValueRow label="Response time">{st.health === 'down' ? 'no response' : `${st.responseMs} ms`}</ValueRow>
        <Note>Simulated from the item id; there is no health check behind it yet.</Note>
      </SidebarSection>
      <ConnectionsSection item={item} ctx={ctx} />
    </>
  );
}

export function DeploymentSidebar(props: SidebarProps<'deployment'>) {
  const { item } = props;
  return (
    <SidebarTabs
      rememberAs="deployment"
      tabs={[
        { id: 'details', label: 'Details', render: () => <Details {...props} /> },
        {
          id: 'preview',
          label: 'Preview',
          wide: true,
          render: () => (
            <div style={{ height: 'calc(100vh - 150px)', minHeight: 320 }}>
              <WebPanel src={item.data.url} partition="persist:deployments" viewportSwitcher colorSchemeToggle onOpenExternal={(u) => void openUrl(u)} />
            </div>
          ),
        },
      ]}
    />
  );
}
