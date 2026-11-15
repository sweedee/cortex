/**
 * Lenient zod schemas for the JSON the `gh` and `acli` CLIs print. They pin only what the app reads
 * (the identifying and structural fields) and `.loose()` everything else, so a tool adding a field
 * never breaks us while a changed shape (an object where an array was) fails with a clear ParseError.
 */
import { z } from 'zod';

const loose = <T extends z.ZodRawShape>(shape: T) => z.object(shape).loose();

// ---- gh ----------------------------------------------------------------------------------

export const ghPrListItemSchema = loose({
  number: z.number(),
  title: z.string(),
  state: z.string(),
  url: z.string(),
  headRefName: z.string(),
  baseRefName: z.string(),
  author: loose({ login: z.string().optional() }).optional(),
  labels: z.array(z.unknown()).optional(),
  statusCheckRollup: z.array(z.unknown()).nullable().optional(),
});
export const ghPrListSchema = z.array(ghPrListItemSchema);

export const ghPullRequestSchema = ghPrListItemSchema.extend({
  files: z.array(z.unknown()).optional(),
  comments: z.array(z.unknown()).optional(),
  latestReviews: z.array(z.unknown()).optional(),
  reviewRequests: z.array(z.unknown()).optional(),
});

export const ghChecksSchema = z.array(loose({ name: z.string(), state: z.string().optional(), bucket: z.string().optional() }));

export const ghRunSchema = loose({
  databaseId: z.number(),
  status: z.string(),
  jobs: z.array(loose({ name: z.string() })).optional(),
});

// ---- acli (Jira) -------------------------------------------------------------------------

export const jiraIssueSchema = loose({
  key: z.string(),
  fields: loose({}).optional(),
});
export const jiraSearchSchema = z.union([z.array(jiraIssueSchema), loose({ issues: z.array(jiraIssueSchema).optional() })]);
