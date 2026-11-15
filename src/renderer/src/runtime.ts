import { bootTheme } from './theme';

/**
 * Outside the Dynatrace platform there is no web runtime. Strato asks it for the user's
 * theme once, when AppRoot mounts (and logs a warning without it): answer with the theme the
 * app starts in. Later changes are applied by `useTheme` (theme.ts).
 * The user details stop the "Missing getCurrentUserDetails" warning; there is no platform user.
 */
const g = globalThis as unknown as { dtRuntime?: Record<string, unknown> };
g.dtRuntime = {
  ...g.dtRuntime,
  appEnvironment: {
    ...(g.dtRuntime?.appEnvironment as object | undefined),
    getCurrentUserDetails: () => ({ id: 'local', name: 'Local user', email: '' }),
  },
  userPreferences: { getTheme: () => bootTheme(), getLanguage: () => 'en', getRegionalFormat: () => 'en-US', getTimezone: () => Intl.DateTimeFormat().resolvedOptions().timeZone },
};
