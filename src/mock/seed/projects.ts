/** First-run content for the toolbox and the projects page (afterwards localStorage wins). */
import type { Project, ToolboxLink } from '../../model/types';

const project = (id: string, name: string, description: string, port: number, startCommand: string): Project => ({
  id,
  name,
  description,
  github: { owner: 'ctx-observability', repo: id },
  baseBranch: 'main',
  localPath: `~/src/${id}`,
  worktreeRoot: `~/wt/${id}`,
  startCommand,
  port,
  jira: { projectKey: 'CTX', labels: [id], ticketKeys: [] },
  roadmap: [],
  diagrams: [],
});

export const SEED_PROJECTS: Project[] = [
  project('console-ui', 'Console UI', 'The web console customers use to explore their telemetry.', 5174, 'npm run dev'),
  project('ingest-gateway', 'Ingest Gateway', 'Receives telemetry, validates it and dispatches it to the pipeline.', 8080, './gradlew bootRun'),
  project('query-service', 'Query Service', 'Executes queries against the storage tier.', 8090, './gradlew bootRun'),
];

export const SEED_TOOLBOX: ToolboxLink[] = [];
