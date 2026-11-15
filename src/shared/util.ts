/** Tiny helpers with no better home. */

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A Jira issue key such as `CTX-12`. */
export const TICKET_KEY = /[A-Z][A-Z0-9]+-\d+/;

/** The first Jira key a branch name, folder or file name mentions (`feat/CTX-12-x` → `CTX-12`). */
export const ticketKeyOf = (s: string): string | undefined => TICKET_KEY.exec(s)?.[0];
