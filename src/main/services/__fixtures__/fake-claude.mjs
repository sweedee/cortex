/**
 * A stand-in for `claude -p --input-format stream-json --output-format stream-json` in tests.
 * Speaks the same line protocol. Behaviour depends on the user's text:
 *   "ask …"   → AskUserQuestion via a can_use_tool control_request, waits for the answer
 *   "bash …"  → a Bash tool that needs permission
 *   "slow …"  → keeps working until interrupted
 *   "crash …" → exits with code 3
 *   anything else → echoes it back
 */
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const sessionId = flag('--session-id') ?? flag('--resume') ?? randomUUID();
const model = flag('--model') ?? 'claude-fake-1';
let cost = 0;
let inited = false;
let msg = 0;
const waiting = new Map(); // request_id -> resolve
let interrupted = null;

const emit = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 };
const say = (content) => emit({ type: 'assistant', session_id: sessionId, parent_tool_use_id: null, message: { id: `msg_${++msg}`, model, role: 'assistant', content, usage } });
const result = (text, extra = {}) => {
  cost += 0.01;
  emit({ type: 'result', subtype: 'success', is_error: false, session_id: sessionId, result: text, total_cost_usd: Number(cost.toFixed(4)), duration_ms: 5, num_turns: 1, usage, ...extra });
};
const ask = (request) =>
  new Promise((resolve) => {
    const request_id = `req_${randomUUID()}`;
    waiting.set(request_id, resolve);
    emit({ type: 'control_request', request_id, request });
  });

async function turn(text) {
  if (!inited) {
    inited = true;
    emit({ type: 'system', subtype: 'init', session_id: sessionId, model, cwd: process.cwd(), permissionMode: flag('--permission-mode') ?? 'default', argv });
  }
  if (text.startsWith('crash')) {
    process.stderr.write('fatal: something broke\n');
    process.exit(3);
  }
  if (text.startsWith('ask')) {
    const input = { questions: [{ question: 'Which approach?', header: 'Approach', multiSelect: false, options: [{ label: 'Retry' }, { label: 'Queue' }] }] };
    say([{ type: 'text', text: 'Let me ask.' }, { type: 'tool_use', id: 'toolu_ask1', name: 'AskUserQuestion', input }]);
    const r = await ask({ subtype: 'can_use_tool', tool_name: 'AskUserQuestion', input, tool_use_id: 'toolu_ask1' });
    if (r.behavior === 'allow') {
      const a = r.updatedInput.answers;
      const listed = Object.entries(a).map(([q, v]) => `"${q}"="${v}"`).join(', ');
      emit({ type: 'user', session_id: sessionId, parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_ask1', content: `User has answered your questions: ${listed}. You can now continue with the user's answers in mind.` }] } });
      say([{ type: 'text', text: `You chose ${Object.values(a).join(', ')}` }]);
      return result(`You chose ${Object.values(a).join(', ')}`);
    }
    emit({ type: 'user', session_id: sessionId, parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_ask1', content: r.message, is_error: true }] } });
    return result('ok, no answer');
  }
  if (text.startsWith('bash')) {
    const input = { command: 'echo hi', description: 'say hi' };
    say([{ type: 'tool_use', id: 'toolu_b1', name: 'Bash', input }]);
    const r = await ask({ subtype: 'can_use_tool', tool_name: 'Bash', input, tool_use_id: 'toolu_b1' });
    const ok = r.behavior === 'allow';
    emit({ type: 'user', session_id: sessionId, parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_b1', content: ok ? 'hi' : r.message, is_error: !ok }] } });
    return result(ok ? 'ran it' : 'denied');
  }
  if (text.startsWith('slow')) {
    say([{ type: 'text', text: 'Working on it…' }, { type: 'tool_use', id: 'toolu_s1', name: 'Read', input: { file_path: '/x.ts' } }]);
    await new Promise((resolve) => (interrupted = resolve));
    return emit({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: sessionId, total_cost_usd: cost, duration_ms: 5, num_turns: 1 });
  }
  say([{ type: 'text', text: `echo: ${text}` }]);
  result(`echo: ${text}`);
}

let queue = Promise.resolve();
createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  const m = JSON.parse(line);
  if (m.type === 'control_request') {
    emit({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id, response: {} } });
    if (m.request.subtype === 'interrupt' && interrupted) {
      interrupted();
      interrupted = null;
    }
  } else if (m.type === 'control_response') {
    const resolve = waiting.get(m.response.request_id);
    waiting.delete(m.response.request_id);
    resolve?.(m.response.response);
  } else if (m.type === 'user') {
    const c = m.message.content;
    const text = typeof c === 'string' ? c : c.map((b) => b.text ?? '').join('');
    queue = queue.then(() => turn(text));
  }
}).on('close', () => queue.then(() => process.exit(0)));
