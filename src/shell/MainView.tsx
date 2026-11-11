import type { ReactNode } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { Chip } from '@dynatrace/strato-components/content';
import { Flex } from '@dynatrace/strato-components/layouts';
import { Tab, Tabs } from '@dynatrace/strato-components/navigation';
import { Tooltip } from '@dynatrace/strato-components/overlays';
import { Heading, Text } from '@dynatrace/strato-components/typography';
import { AiIcon, CompareIcon, DescriptionIcon, DesktopIcon, WorkflowIcon } from '@dynatrace/strato-icons';
import type { WorkItem, WorkTab } from '../model/types';
import { setTab } from '../state/actions';
import { attentionOf, nextActionOf, unresolvedThreads, type Tone } from '../state/derive';
import { useBusy, useCortex, useWork } from '../state/store';
import { AgentsView } from '../views/AgentsView';
import { ChatView } from '../views/ChatView';
import { PipelineView } from '../views/PipelineView';
import { PreviewView } from '../views/PreviewView';
import { ReviewView } from '../views/ReviewView';
import { TicketView } from '../views/TicketView';
import { ProjectsView } from '../views/ProjectsView';
import { TodosView } from '../views/TodosView';
import { ToolboxView } from '../views/ToolboxView';
import './shell.css';

const VIEWS: Record<WorkTab, (p: { workId: string }) => ReactNode> = {
  ticket: TicketView,
  agents: AgentsView,
  review: ReviewView,
  pipeline: PipelineView,
  preview: PreviewView,
};

interface TabDef {
  id: WorkTab;
  label: string;
  icon: ReactNode;
  /** small live status next to the label */
  badge?: { text: string; tone: Tone };
}

function useTabs(work: WorkItem): TabDef[] {
  const sessions = useCortex((s) => s.sessions).filter((s) => s.workId === work.id);
  const running = sessions.filter((s) => s.status === 'running').length;
  const waiting = sessions.filter((s) => s.status === 'waiting' && s.activity).length;
  const unresolved = unresolvedThreads(work.pr);
  const ci = work.pipeline?.status;

  return [
    { id: 'ticket', label: work.ticket ? 'Ticket' : 'Brief', icon: <DescriptionIcon /> },
    {
      id: 'agents',
      label: 'Claude',
      icon: <AiIcon />,
      badge: waiting
        ? { text: 'waiting', tone: 'warning' }
        : running
          ? { text: `${running} running`, tone: 'primary' }
          : sessions.length
            ? { text: String(sessions.length), tone: 'neutral' }
            : undefined,
    },
    {
      id: 'review',
      label: work.pr ? `PR #${work.pr.number}` : 'Pull request',
      icon: <CompareIcon />,
      badge: unresolved ? { text: String(unresolved), tone: 'warning' } : undefined,
    },
    {
      id: 'pipeline',
      label: 'Build',
      icon: <WorkflowIcon />,
      badge: ci ? { text: ci, tone: ci === 'failed' ? 'critical' : ci === 'passed' ? 'success' : 'primary' } : undefined,
    },
    {
      id: 'preview',
      label: 'Preview',
      icon: <DesktopIcon />,
      badge: work.app.status !== 'stopped' ? { text: work.app.status === 'running' ? 'live' : 'starting', tone: 'success' } : undefined,
    },
  ];
}

function WorkHeader({ work, active }: { work: WorkItem; active: WorkTab }) {
  const sessions = useCortex((s) => s.sessions);
  const me = useCortex((s) => s.me);
  const tabs = useTabs(work);
  const attention = attentionOf(work, sessions, me);
  const next = nextActionOf(work, sessions, me);
  const nextBusy = useBusy(work.id, next?.busyKey ?? '-');

  return (
    <div style={{ flex: 'none' }}>
      <Flex alignItems="center" gap={8} padding={12} paddingLeft={16} paddingRight={16} paddingBottom={4}>
        <Text className="cx-mono cx-tone-neutral" style={{ flex: 'none' }}>
          {work.ticket?.key ?? (work.kind === 'review' ? `PR #${work.pr?.number}` : 'Ad hoc')}
        </Text>
        <Heading level={5} as="h2" className="cx-ellipsis">
          {work.title}
        </Heading>
        <Chip size="condensed">{work.repo}</Chip>
        <span style={{ marginLeft: 'auto' }} />
        {attention.reason && (
          <Text textStyle="small" className={`cx-tone-${attention.tone}`} style={{ flex: 'none' }}>
            {attention.reason}
          </Text>
        )}
        {next && (
          <Tooltip text={next.hint}>
            <Button size="condensed" variant="accent" color="primary" loading={nextBusy} onClick={next.run} style={{ flex: 'none' }}>
              {next.label}
            </Button>
          </Tooltip>
        )}
      </Flex>
      <Tabs selectedIndex={Math.max(0, tabs.findIndex((t) => t.id === active))} onChange={(i) => setTab(tabs[i].id)}>
        {tabs.map((t) => (
          <Tab key={t.id} title={t.badge ? `${t.label} · ${t.badge.text}` : t.label} prefixIcon={<span className={`cx-tone-${t.badge?.tone ?? 'neutral'}`} style={{ display: 'flex' }}>{t.icon}</span>}>
            {null}
          </Tab>
        ))}
      </Tabs>
    </div>
  );
}

export function MainView() {
  const view = useCortex((s) => s.view);
  const work = useWork(view.workId);
  if (!work) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {view.page === 'todos' ? <TodosView /> : view.page === 'toolbox' ? <ToolboxView /> : view.page === 'projects' ? <ProjectsView /> : <ChatView />}
      </div>
    );
  }
  const View = VIEWS[view.tab];
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <WorkHeader work={work} active={view.tab} />
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* key: views keep local UI state per work item, not across them */}
        <View key={work.id} workId={work.id} />
      </div>
    </div>
  );
}
