import { useState } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { Chip } from '@dynatrace/strato-components/content';
import { TextInput } from '@dynatrace/strato-components/forms';
import { Flex, Surface } from '@dynatrace/strato-components/layouts';
import { Tab, Tabs } from '@dynatrace/strato-components/navigation';
import { Heading, Text } from '@dynatrace/strato-components/typography';
import { ArrowLeftIcon, CodeIcon, FlowIcon, InformationIcon, PlusIcon, WorkflowIcon } from '@dynatrace/strato-icons';
import type { Project, ProjectTab } from '../model/types';
import { addProject, openProjects } from '../state/projects';
import { useCortex } from '../state/store';
import { ProjectArchitecture } from './projects/ProjectArchitecture';
import { ProjectOverview } from './projects/ProjectOverview';
import { ProjectRoadmap } from './projects/ProjectRoadmap';
import { ProjectWork } from './projects/ProjectWork';
import './projects/projects.css';
import '../shell/shell.css';

const TABS: { id: ProjectTab; label: string; icon: JSX.Element }[] = [
  { id: 'overview', label: 'Overview', icon: <InformationIcon /> },
  { id: 'work', label: 'Work', icon: <CodeIcon /> },
  { id: 'roadmap', label: 'Roadmap', icon: <FlowIcon /> },
  { id: 'architecture', label: 'Architecture', icon: <WorkflowIcon /> },
];

const slug = (p: Project) => `${p.github.owner}/${p.github.repo}`;

function ProjectList() {
  const projects = useCortex((s) => s.projects);
  const work = useCortex((s) => s.work);
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const add = () => {
    if (!name.trim()) return;
    if (addProject(name)) {
      setName('');
      setError('');
    } else setError(`"${name.trim()}" is already a project`);
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <Flex flexDirection="column" gap={24} padding={24} style={{ maxWidth: 1100, margin: '0 auto' }}>
        <Flex alignItems="baseline" gap={12}>
          <Heading level={3} as="h1">
            Projects
          </Heading>
          <Text className="cx-tone-neutral">{projects.length} configured</Text>
        </Flex>

        <Flex flexDirection="column" gap={4}>
          <Flex gap={8} alignItems="center">
            <TextInput
              aria-label="New project name"
              placeholder="Repository name, e.g. console-ui (Enter to add)"
              value={name}
              onChange={(v) => {
                setName(v);
                setError('');
              }}
              onKeyDown={(e) => e.key === 'Enter' && add()}
              style={{ flex: 1 }}
            />
            <Button variant="accent" color="primary" disabled={!name.trim()} onClick={add}>
              <Button.Prefix>
                <PlusIcon />
              </Button.Prefix>
              Add project
            </Button>
          </Flex>
          {error && (
            <Text textStyle="small" className="cx-tone-critical" role="alert">
              {error}
            </Text>
          )}
        </Flex>

        {projects.length === 0 && <Text className="cx-tone-neutral">No projects yet. Add the first repository above.</Text>}

        <div className="cx-pj-grid">
          {projects.map((p) => {
            const open = work.filter((w) => w.repo === p.id).length;
            return (
              <Surface
                key={p.id}
                className="cx-pj-card"
                padding={16}
                role="button"
                tabIndex={0}
                aria-label={`Open project ${p.name}`}
                onClick={() => openProjects(p.id)}
                onKeyDown={(e: React.KeyboardEvent) => {
                  if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) openProjects(p.id);
                }}
              >
                <Heading level={5} as="h2" className="cx-ellipsis">
                  {p.name}
                </Heading>
                <Text className="cx-tone-neutral cx-ellipsis">{p.description || 'No description'}</Text>
                <div className="cx-pj-meta">
                  <Text textStyle="small">GitHub</Text>
                  <Text textStyle="small" className="cx-mono">
                    {slug(p)}
                  </Text>
                  <Text textStyle="small">Local</Text>
                  <Text textStyle="small" className="cx-mono">
                    {p.localPath || '-'}
                  </Text>
                  <Text textStyle="small">Start</Text>
                  <Text textStyle="small" className="cx-mono">
                    {p.startCommand || '-'}
                    {p.port ? ` (:${p.port})` : ''}
                  </Text>
                </div>
                <div className="cx-pj-counts">
                  <Text textStyle="small">
                    <b>{open}</b> <span className="cx-tone-neutral">on board</span>
                  </Text>
                  <Text textStyle="small">
                    <b>{p.roadmap.length}</b> <span className="cx-tone-neutral">milestones</span>
                  </Text>
                  <Text textStyle="small">
                    <b>{p.diagrams.length}</b> <span className="cx-tone-neutral">diagrams</span>
                  </Text>
                </div>
              </Surface>
            );
          })}
        </div>
      </Flex>
    </div>
  );
}

function ProjectDetail({ project, tab }: { project: Project; tab: ProjectTab }) {
  const index = Math.max(0, TABS.findIndex((t) => t.id === tab));
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ flex: 'none' }}>
        <Flex alignItems="center" gap={8} padding={12} paddingLeft={16} paddingRight={16} paddingBottom={4}>
          <Button size="condensed" onClick={() => openProjects()}>
            <Button.Prefix>
              <ArrowLeftIcon />
            </Button.Prefix>
            Projects
          </Button>
          <Heading level={5} as="h2" className="cx-ellipsis">
            {project.name}
          </Heading>
          <Chip size="condensed">{slug(project)}</Chip>
        </Flex>
        <Tabs selectedIndex={index} onChange={(i) => openProjects(project.id, TABS[i].id)}>
          {TABS.map((t) => (
            <Tab key={t.id} title={t.label} prefixIcon={<span style={{ display: 'flex' }}>{t.icon}</span>}>
              {null}
            </Tab>
          ))}
        </Tabs>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {tab === 'overview' && <ProjectOverview key={project.id} project={project} />}
        {tab === 'work' && <ProjectWork project={project} />}
        {tab === 'roadmap' && <ProjectRoadmap project={project} />}
        {tab === 'architecture' && <ProjectArchitecture project={project} />}
      </div>
    </div>
  );
}

export function ProjectsView() {
  const view = useCortex((s) => s.view);
  const project = useCortex((s) => s.projects.find((p) => p.id === s.view.projectId));
  if (!project) return <ProjectList />;
  return <ProjectDetail project={project} tab={view.projectTab ?? 'overview'} />;
}
