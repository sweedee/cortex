/**
 * Screen-space layout sizes shared by the canvas code and index.css. Defined once here and
 * published as CSS custom properties (`--chat-space`, …) by `applyMetricVars`, so the
 * stylesheet uses `var(--…)` instead of repeating the numbers.
 */
export const METRICS = {
  /** px reserved at the bottom of the canvas for the chat dock */
  chatSpace: 170,
  /** px reserved at the top for the HUD (brand, toolbar) */
  topSpace: 70,
  /** hover card width */
  hoverCardWidth: 280,
  /** gap between a bubble and its hover card */
  hoverCardGap: 18,
  /** narrowest inline action list */
  actionsMinWidth: 170,
  /** inline action list width assumed when deciding to open it on the other side */
  actionsWidth: 230,
  /** gap between the selection and its inline action list */
  actionsGap: 16,
} as const;

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** The CSS custom properties for `METRICS`, e.g. `--hover-card-width: 280px`. */
export const metricVars = (): Record<string, string> =>
  Object.fromEntries(Object.entries(METRICS).map(([k, v]) => [`--${kebab(k)}`, `${v}px`]));

export function applyMetricVars(root: HTMLElement = document.documentElement) {
  for (const [k, v] of Object.entries(metricVars())) root.style.setProperty(k, v);
}
