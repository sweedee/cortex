/**
 * Projects: where each repository lives (GitHub + local), how to start it, which Jira
 * tickets belong to it, its roadmap and its architecture diagrams.
 * Persisted in localStorage. `Project.id` is the repo name work items refer to.
 */
import type { Diagram, Milestone, Project, ProjectTab, RoadmapItem } from '../model/types';
import { SEED_PROJECTS } from '../mock/seed/projects';
import { config } from '../services/config';
import { newId, persistSlice } from './persist';
import { getState, setState, useCortex } from './store';

export const initProjects = () => persistSlice('projects', 'cortex.projects.v1', SEED_PROJECTS);

export const useProject = (id: string | undefined): Project | undefined => useCortex((s) => s.projects.find((p) => p.id === id));

const patchAll = (fn: (projects: Project[]) => Project[]) => setState((s) => ({ ...s, projects: fn(s.projects) }));

export const updateProject = (id: string, change: Partial<Omit<Project, 'id'>>) =>
  patchAll((ps) => ps.map((p) => (p.id === id ? { ...p, ...change } : p)));

/** A project with the site defaults filled in. `id` must be unique (the short repo name). */
export function blankProject(id: string): Project {
  return {
    id,
    name: id,
    github: { owner: config.githubOwner, repo: id },
    baseBranch: config.baseBranch,
    localPath: `~/src/${id}`,
    worktreeRoot: `${config.worktreeRoot}/${id}`,
    startCommand: 'npm run dev',
    jira: { projectKey: '', labels: [id], ticketKeys: [] },
    roadmap: [],
    diagrams: [],
  };
}

/** Adds a project and opens it. Returns false if the id is empty or taken. */
export function addProject(id: string): boolean {
  const clean = id.trim();
  if (!clean || getState().projects.some((p) => p.id === clean)) return false;
  patchAll((ps) => [...ps, blankProject(clean)]);
  openProjects(clean);
  return true;
}

export function deleteProject(id: string) {
  patchAll((ps) => ps.filter((p) => p.id !== id));
  if (getState().view.projectId === id) openProjects();
}

/** Which project a ticket belongs to: by label, else the first project. */
export function projectForLabels(labels: string[]): string {
  const { projects } = getState();
  const hit = projects.find((p) => labels.includes(p.id) || p.jira.labels.some((l) => labels.includes(l)));
  return (hit ?? projects[0])?.id ?? '';
}

// ---- roadmap -----------------------------------------------------------------

const patchRoadmap = (projectId: string, fn: (roadmap: Milestone[]) => Milestone[]) =>
  patchAll((ps) => ps.map((p) => (p.id === projectId ? { ...p, roadmap: fn(p.roadmap) } : p)));

const patchMilestone = (projectId: string, milestoneId: string, fn: (m: Milestone) => Milestone) =>
  patchRoadmap(projectId, (r) => r.map((m) => (m.id === milestoneId ? fn(m) : m)));

export const addMilestone = (projectId: string, title: string, target?: string) =>
  patchRoadmap(projectId, (r) => [...r, { id: newId('ms'), title, target, status: 'planned', items: [] }]);

export const updateMilestone = (projectId: string, milestoneId: string, change: Partial<Omit<Milestone, 'id' | 'items'>>) =>
  patchMilestone(projectId, milestoneId, (m) => ({ ...m, ...change }));

export const deleteMilestone = (projectId: string, milestoneId: string) =>
  patchRoadmap(projectId, (r) => r.filter((m) => m.id !== milestoneId));

/** Moves a milestone one place up (-1) or down (+1). */
export const moveMilestone = (projectId: string, milestoneId: string, direction: -1 | 1) =>
  patchRoadmap(projectId, (r) => {
    const from = r.findIndex((m) => m.id === milestoneId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= r.length) return r;
    const next = [...r];
    [next[from], next[to]] = [next[to], next[from]];
    return next;
  });

export const addRoadmapItem = (projectId: string, milestoneId: string, text: string, ticketKey?: string) =>
  patchMilestone(projectId, milestoneId, (m) => ({ ...m, items: [...m.items, { id: newId('ri'), text, done: false, ticketKey }] }));

export const updateRoadmapItem = (projectId: string, milestoneId: string, itemId: string, change: Partial<Omit<RoadmapItem, 'id'>>) =>
  patchMilestone(projectId, milestoneId, (m) => ({ ...m, items: m.items.map((i) => (i.id === itemId ? { ...i, ...change } : i)) }));

export const deleteRoadmapItem = (projectId: string, milestoneId: string, itemId: string) =>
  patchMilestone(projectId, milestoneId, (m) => ({ ...m, items: m.items.filter((i) => i.id !== itemId) }));

// ---- diagrams ----------------------------------------------------------------

const patchDiagrams = (projectId: string, fn: (diagrams: Diagram[]) => Diagram[]) =>
  patchAll((ps) => ps.map((p) => (p.id === projectId ? { ...p, diagrams: fn(p.diagrams) } : p)));

/** Adds a diagram and returns its id. */
export function addDiagram(projectId: string, title: string, source: string): string {
  const id = newId('dg');
  patchDiagrams(projectId, (d) => [...d, { id, title, source, updatedAt: new Date().toISOString() }]);
  return id;
}

export const updateDiagram = (projectId: string, diagramId: string, change: Partial<Pick<Diagram, 'title' | 'source'>>) =>
  patchDiagrams(projectId, (d) => d.map((x) => (x.id === diagramId ? { ...x, ...change, updatedAt: new Date().toISOString() } : x)));

export const deleteDiagram = (projectId: string, diagramId: string) => patchDiagrams(projectId, (d) => d.filter((x) => x.id !== diagramId));

// ---- navigation --------------------------------------------------------------

/** Opens the projects page; with an id, that project (and tab). */
export const openProjects = (projectId?: string, projectTab: ProjectTab = 'overview') =>
  setState((s) => ({ ...s, view: { workId: null, tab: 'ticket', page: 'projects', projectId, projectTab: projectId ? projectTab : undefined } }));
