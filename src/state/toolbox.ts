/** The toolbox: bookmarks with an icon. Persisted in localStorage. */
import type { ToolboxLink } from '../model/types';
import { SEED_TOOLBOX } from '../mock/seed/projects';
import { newId, persistSlice } from './persist';
import { setState } from './store';

export const initToolbox = () => persistSlice('toolbox', 'cortex.toolbox.v1', SEED_TOOLBOX);

const patch = (fn: (links: ToolboxLink[]) => ToolboxLink[]) => setState((s) => ({ ...s, toolbox: fn(s.toolbox) }));

export const addLink = (link: Omit<ToolboxLink, 'id'>) => patch((links) => [...links, { ...link, id: newId('link') }]);

export const updateLink = (id: string, change: Partial<Omit<ToolboxLink, 'id'>>) =>
  patch((links) => links.map((l) => (l.id === id ? { ...l, ...change } : l)));

export const deleteLink = (id: string) => patch((links) => links.filter((l) => l.id !== id));

/** Opens the toolbox in the main view. */
export const openToolbox = () => setState((s) => ({ ...s, view: { workId: null, tab: 'ticket', page: 'toolbox' } }));
