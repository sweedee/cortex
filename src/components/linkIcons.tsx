import type { ComponentType } from 'react';
import {
  BookmarkIcon,
  BugReportIcon,
  CalendarIcon,
  ChartCollectionIcon,
  ChatIcon,
  CodeIcon,
  ContainerIcon,
  DatabaseIcon,
  DescriptionIcon,
  ExternalLinkIcon,
  FlowIcon,
  GroupIcon,
  HomeIcon,
  IdeaIcon,
  KeyIcon,
  LinkIcon as GenericLinkIcon,
  LockIcon,
  LogsIcon,
  MailIcon,
  NotificationActiveIcon,
  ServicesIcon,
  SettingIcon,
  SourceIcon,
  SupportIcon,
  TerminalIcon,
  WorkflowIcon,
} from '@dynatrace/strato-icons';

/** Curated icons for toolbox links. The key is what is stored on a ToolboxLink. */
export const LINK_ICONS: Record<string, { label: string; icon: ComponentType }> = {
  link: { label: 'Link', icon: GenericLinkIcon },
  code: { label: 'Code / repo', icon: CodeIcon },
  source: { label: 'Source', icon: SourceIcon },
  workflow: { label: 'CI / workflow', icon: WorkflowIcon },
  flow: { label: 'Pipeline', icon: FlowIcon },
  chart: { label: 'Dashboard', icon: ChartCollectionIcon },
  logs: { label: 'Logs', icon: LogsIcon },
  bug: { label: 'Bug / ticket', icon: BugReportIcon },
  docs: { label: 'Docs', icon: DescriptionIcon },
  chat: { label: 'Chat', icon: ChatIcon },
  mail: { label: 'Mail', icon: MailIcon },
  cloud: { label: 'Services', icon: ServicesIcon },
  container: { label: 'Containers', icon: ContainerIcon },
  database: { label: 'Database', icon: DatabaseIcon },
  security: { label: 'Security', icon: LockIcon },
  key: { label: 'Secrets / keys', icon: KeyIcon },
  settings: { label: 'Settings', icon: SettingIcon },
  external: { label: 'External', icon: ExternalLinkIcon },
  bookmark: { label: 'Bookmark', icon: BookmarkIcon },
  calendar: { label: 'Calendar', icon: CalendarIcon },
  people: { label: 'People / team', icon: GroupIcon },
  terminal: { label: 'Terminal', icon: TerminalIcon },
  oncall: { label: 'On-call / alerts', icon: NotificationActiveIcon },
  support: { label: 'Support', icon: SupportIcon },
  idea: { label: 'Ideas', icon: IdeaIcon },
  home: { label: 'Home', icon: HomeIcon },
};

export function LinkIcon({ name }: { name: string }) {
  const Icon = (LINK_ICONS[name] ?? LINK_ICONS.link).icon;
  return <Icon />;
}

const RULES: [RegExp, string][] = [
  [/github|gitlab|bitbucket/, 'code'],
  [/jira|atlassian\.net|linear|youtrack/, 'bug'],
  [/jenkins|circleci|travis|buildkite|teamcity|actions/, 'workflow'],
  [/grafana|dynatrace|datadog|kibana|prometheus|dashboard|metrics/, 'chart'],
  [/splunk|loki|logs/, 'logs'],
  [/confluence|notion|docs|wiki|readme|runbook/, 'docs'],
  [/slack|teams\.microsoft|discord|chat/, 'chat'],
  [/outlook|mail/, 'mail'],
  [/pagerduty|opsgenie|oncall|on-call/, 'oncall'],
  [/calendar|calendly/, 'calendar'],
  [/vault|secret|1password|okta|auth/, 'security'],
  [/aws|azure|gcp|cloud|console|k8s|kube|rancher/, 'cloud'],
  [/docker|registry|harbor/, 'container'],
  [/db|sql|mongo|postgres/, 'database'],
];

/** Picks an icon key from a URL's hostname (and path). */
export function guessIcon(url: string): string {
  let host = url.toLowerCase();
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`);
    host = u.hostname.toLowerCase();
  } catch {
    /* fall through with the raw text */
  }
  return RULES.find(([re]) => re.test(host))?.[1] ?? 'link';
}
