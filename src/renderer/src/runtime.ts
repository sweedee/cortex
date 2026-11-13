/**
 * Outside the Dynatrace platform there is no web runtime. Strato asks it for the user's
 * theme (and logs a warning without it); this canvas is designed dark-first, so say "dark".
 * The user details stop the "Missing getCurrentUserDetails" warning; there is no platform user.
 */
const g = globalThis as unknown as { dtRuntime?: Record<string, unknown> };
g.dtRuntime = {
  ...g.dtRuntime,
  appEnvironment: {
    ...(g.dtRuntime?.appEnvironment as object | undefined),
    getCurrentUserDetails: () => ({ id: 'local', name: 'Local user', email: '' }),
  },
  userPreferences: { getTheme: () => 'dark', getLanguage: () => 'en', getRegionalFormat: () => 'en-US', getTimezone: () => Intl.DateTimeFormat().resolvedOptions().timeZone },
};
export {};
