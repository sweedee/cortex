/**
 * A stand-in for `claude -p --input-format stream-json --output-format stream-json` in tests.
 * Speaks the same line protocol, with event shapes taken from a real Claude Code 2.1.325 session
 * (see src/shared/integrations/__fixtures__/claude-real-subagent.jsonl). Behaviour depends on the
 * user's text:
 *   "ask …"   → AskUserQuestion via a can_use_tool control_request, waits for the answer
 *   "bash …"  → a Bash tool that needs permission
 *   "slow …"  → keeps working until interrupted
 *   "crash …" → exits with code 3
 *   "agent …" → spawns a subagent (Agent tool, task_* events, nested tool calls)
 *   "full …"  → a turn that fills the context window to ~93 %
 *   anything else → echoes it back
 * Control requests: initialize (commands + models), set_model, set_permission_mode,
 * apply_flag_settings, interrupt. Usage grows per API call with realistic cache reads / writes;
 * results carry `modelUsage` / `model_usage_since_last_result` with a 200k context window.
 */
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const sessionId = flag('--session-id') ?? flag('--resume') ?? randomUUID();
let model = flag('--model') ?? 'claude-fake-1';
let permissionMode = flag('--permission-mode') ?? 'default';
let effort = flag('--effort');
let cost = 0;
let inited = false;
let msg = 0;
const waiting = new Map(); // request_id -> resolve
let interrupted = null;

const WINDOW = 200_000;
const RESOLVED = { opus: 'claude-opus-fake', sonnet: 'claude-sonnet-fake', haiku: 'claude-haiku-fake', fable: 'claude-fable-fake', default: 'claude-fake-1' };
const COMMANDS = [
  { name: 'compact', description: 'Clear conversation history but keep a summary in context', argumentHint: '<optional custom summarization instructions>' },
  { name: 'review', description: 'Review a pull request' },
  { name: 'fake-skill', description: 'A skill only the fake CLI knows' },
];
const MODELS = [
  { value: 'default', resolvedModel: 'claude-fake-1', displayName: 'Default (recommended)', description: 'Fake default', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'opus', resolvedModel: 'claude-opus-fake', displayName: 'Opus (fake)', description: 'For complex work', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'sonnet', resolvedModel: 'claude-sonnet-fake', displayName: 'Sonnet (fake)', description: 'Efficient', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'haiku', resolvedModel: 'claude-haiku-fake', displayName: 'Haiku (fake)', description: 'Fastest', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
];

// context grows with every call; the prefix is cached after the first call
let context = 0;
const perModel = {}; // cumulative modelUsage
let sinceResult = {};
function nextUsage(add = 1500, out = 40) {
  const first = context === 0;
  const prev = context || 12_000;
  context = prev + add;
  return first
    ? { input_tokens: 3, output_tokens: out, cache_read_input_tokens: 0, cache_creation_input_tokens: context - 3 }
    : { input_tokens: 3, output_tokens: out, cache_read_input_tokens: prev, cache_creation_input_tokens: context - prev - 3 };
}
function count(m, u) {
  for (const bucket of [perModel, sinceResult]) {
    const x = (bucket[m] ??= { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0, contextWindow: WINDOW, maxOutputTokens: 64_000 });
    x.inputTokens += u.input_tokens;
    x.outputTokens += u.output_tokens;
    x.cacheReadInputTokens += u.cache_read_input_tokens;
    x.cacheCreationInputTokens += u.cache_creation_input_tokens;
  }
}

const emit = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const say = (content, opts = {}) => {
  const usage = opts.usage ?? nextUsage(opts.add, opts.out);
  count(opts.model ?? model, usage);
  emit({ type: 'assistant', session_id: sessionId, parent_tool_use_id: opts.parent ?? null, message: { id: `msg_${++msg}`, model: opts.model ?? model, role: 'assistant', content, usage } });
};
const result = (text, extra = {}) => {
  cost += 0.01;
  for (const m of Object.values(sinceResult)) m.costUSD = 0.01;
  emit({ type: 'result', subtype: 'success', is_error: false, session_id: sessionId, result: text, total_cost_usd: Number(cost.toFixed(4)), duration_ms: 1500, num_turns: 1, modelUsage: perModel, model_usage_since_last_result: sinceResult, ...extra });
  sinceResult = {};
};
const ask = (request) =>
  new Promise((resolve) => {
    const request_id = `req_${randomUUID()}`;
    waiting.set(request_id, resolve);
    emit({ type: 'control_request', request_id, request });
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const init = () => emit({ type: 'system', subtype: 'init', session_id: sessionId, model, cwd: process.cwd(), permissionMode, argv, effort, slash_commands: COMMANDS.map((c) => c.name), agents: ['general-purpose', 'Explore'] });

async function subagentTurn(text) {
  const task = 'toolu_task1';
  const description = 'Map the code';
  say([{ type: 'text', text: 'Delegating to a subagent.' }, { type: 'tool_use', id: task, name: 'Agent', input: { description, subagent_type: 'Explore', prompt: `Look around: ${text}` } }]);
  emit({ type: 'system', subtype: 'task_started', task_id: 'a_fake1', tool_use_id: task, description, subagent_type: 'Explore', is_backgrounded: false, session_id: sessionId });
  emit({ type: 'user', session_id: sessionId, parent_tool_use_id: task, message: { role: 'user', content: [{ type: 'text', text: `Look around: ${text}` }] } });
  const subModel = 'claude-haiku-fake';
  const subUsage = { input_tokens: 2, output_tokens: 20, cache_read_input_tokens: 9000, cache_creation_input_tokens: 400 };
  say([{ type: 'tool_use', id: 'toolu_sub_glob', name: 'Glob', input: { pattern: '**/*.ts' } }], { parent: task, model: subModel, usage: subUsage });
  await sleep(150);
  emit({ type: 'system', subtype: 'task_progress', task_id: 'a_fake1', tool_use_id: task, description: 'Finding **/*.ts', usage: { total_tokens: 9422, tool_uses: 1, duration_ms: 150 }, last_tool_name: 'Glob', session_id: sessionId });
  emit({ type: 'user', session_id: sessionId, parent_tool_use_id: task, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_sub_glob', content: 'src/a.ts\nsrc/b.ts' }] } });
  say([{ type: 'tool_use', id: 'toolu_sub_read', name: 'Read', input: { file_path: 'src/a.ts' } }], { parent: task, model: subModel, usage: subUsage });
  await sleep(150);
  emit({ type: 'system', subtype: 'task_progress', task_id: 'a_fake1', tool_use_id: task, description: 'Reading src/a.ts', usage: { total_tokens: 18844, tool_uses: 2, duration_ms: 300 }, last_tool_name: 'Read', session_id: sessionId });
  emit({ type: 'user', session_id: sessionId, parent_tool_use_id: task, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_sub_read', content: 'export const a = 1;' }] } });
  say([{ type: 'text', text: 'Two files: src/a.ts, src/b.ts.' }], { parent: task, model: subModel, usage: subUsage });
  emit({ type: 'system', subtype: 'task_updated', task_id: 'a_fake1', patch: { status: 'completed', end_time: Date.now() }, session_id: sessionId });
  emit({ type: 'system', subtype: 'task_notification', task_id: 'a_fake1', tool_use_id: task, status: 'completed', usage: { total_tokens: 19000, tool_uses: 2, duration_ms: 320 }, session_id: sessionId });
  emit({ type: 'user', session_id: sessionId, parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: task, content: [{ type: 'text', text: 'Two files: src/a.ts, src/b.ts.' }] }] } });
  say([{ type: 'text', text: 'The subagent found 2 files.' }]);
  result('The subagent found 2 files.');
}

async function turn(text) {
  if (!inited) {
    inited = true;
    init();
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
  if (text.startsWith('agent')) return subagentTurn(text);
  if (text.startsWith('full')) {
    say([{ type: 'text', text: 'Reading a lot…' }], { add: Math.max(0, Math.round(WINDOW * 0.93) - (context || 12_000)) });
    return result('Read a lot.');
  }
  say([{ type: 'text', text: `echo: ${text}` }]);
  result(`echo: ${text}`);
}

function control(m) {
  const r = m.request;
  const ok = (response = {}) => emit({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id, response } });
  switch (r.subtype) {
    case 'initialize':
      return ok({ commands: COMMANDS, models: MODELS, claude_code_version: '0.0.0-fake', current_permission_mode: permissionMode });
    case 'set_model': {
      model = RESOLVED[r.model ?? 'default'] ?? r.model;
      emit({ type: 'user', session_id: sessionId, parent_tool_use_id: null, isReplay: true, message: { role: 'user', content: `<local-command-stdout>Set model to \`${r.model ?? 'default'} (${model})\`</local-command-stdout>` } });
      ok({ model });
      if (inited) init();
      return;
    }
    case 'set_permission_mode':
      permissionMode = r.mode;
      ok({ mode: r.mode });
      return emit({ type: 'system', subtype: 'status', status: null, permissionMode: r.mode, session_id: sessionId });
    case 'apply_flag_settings':
      if (r.settings && 'effortLevel' in r.settings) effort = r.settings.effortLevel;
      return ok();
    case 'interrupt':
      ok();
      if (interrupted) {
        interrupted();
        interrupted = null;
      }
      return;
    default:
      return ok();
  }
}

let queue = Promise.resolve();
createInterface({ input: process.stdin })
  .on('line', (line) => {
    if (!line.trim()) return;
    const m = JSON.parse(line);
    if (m.type === 'control_request') control(m);
    else if (m.type === 'control_response') {
      const resolve = waiting.get(m.response.request_id);
      waiting.delete(m.response.request_id);
      resolve?.(m.response.response);
    } else if (m.type === 'user') {
      const c = m.message.content;
      const text = typeof c === 'string' ? c : c.map((b) => b.text ?? '').join('');
      queue = queue.then(() => turn(text));
    }
  })
  .on('close', () => queue.then(() => process.exit(0)));
