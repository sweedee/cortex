/**
 * Failing test names from a test runner's output (best effort): vitest, jest, pytest, go test.
 * Pure; returns at most `max` names, in order of appearance, without duplicates.
 */
import { stripAnsi } from '../../../../shared/integrations/runners';

const PATTERNS: RegExp[] = [
  // vitest summary / default reporter: " FAIL  src/a.spec.ts > suite > name"
  /^\s*FAIL\s+(\S+\s+>\s+.+?)\s*$/,
  // vitest tree: "   × name 12ms"; jest verbose: "    ✕ name (5 ms)"
  /^\s*[×✗✕]\s+(.+?)(?:\s+\(?\d+(?:\.\d+)?\s*m?s\)?)?\s*$/,
  // jest: "  ● Suite › name"
  /^\s*●\s+(.+?›.+?)\s*$/,
  // pytest short summary: "FAILED tests/test_a.py::test_b - AssertionError: …" / "ERROR tests/…::x"
  /^(?:FAILED|ERROR)\s+(\S+::\S+)/,
  // go test: "--- FAIL: TestName (0.00s)"
  /^\s*--- FAIL:\s+(\S+)/,
  // mocha: "  1) suite name" in the failure list is ambiguous; its summary lines "  1) Suite\n       test:" are skipped
];

export function failingTests(output: string | undefined, max = 50): string[] {
  if (!output) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of stripAnsi(output).split(/\r?\n/)) {
    for (const re of PATTERNS) {
      const m = re.exec(raw);
      if (!m) continue;
      const name = (m[1] ?? '').replace(/\s+/g, ' ').trim();
      if (name && !seen.has(name)) {
        seen.add(name);
        out.push(name);
      }
      break;
    }
  }
  // a failure shows up twice: "× name" in the tree and "FAIL file > suite > name" (vitest) / "● Suite › name" (jest)
  const qualified = (n: string) => n.includes(' > ') || n.includes(' › ');
  const full = out.filter(qualified);
  return out.filter((n) => qualified(n) || !full.some((f) => f.endsWith(` > ${n}`) || f.endsWith(` › ${n}`))).slice(0, max);
}
