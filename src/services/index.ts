/**
 * The one place that decides which implementation backs each service.
 * The rest of the app imports `services` from here and never a concrete implementation.
 *
 * To plug in a real tool: write an object that satisfies its interface from ./types
 * (e.g. src/services/real/github.ts calling the local bridge) and swap it in below.
 * Services are independent — replace them one at a time. See HANDOFF.md.
 */
import { claude } from './mock/claude';
import { startOutsideWorld } from './mock/outside';
import { ci, devServer, git, github, jira, workspace } from './mock/tools';
import type { Services } from './types';

// The mock world also produces events on its own (reviews, review requests); drop this with the mocks.
startOutsideWorld();

export const services: Services = {
  jira,
  github,
  ci,
  git,
  claude,
  devServer,
  workspace,
};
