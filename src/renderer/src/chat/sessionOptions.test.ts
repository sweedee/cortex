import { describe, expect, it } from 'vitest';
import { configureMessage, effortChoices, modelChoiceOf, modelChoices, modelLabel, permissionChoice, slashOptions } from './sessionOptions';
import { modelOptions, settingsPatch } from '../overlays/settings';

const catalog = {
  models: [
    { value: 'default', resolvedModel: 'claude-opus-5-5', description: 'Opus 5.5' },
    { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5' },
    { value: 'haiku', resolvedModel: 'claude-haiku-5-5', displayName: 'Haiku 5.5', supportedEffortLevels: ['low', 'medium'] },
  ],
};

describe('model / effort / mode choices', () => {
  it('lists the CLI default, the CLI models (or aliases) and a custom current value', () => {
    expect(modelChoices(catalog).map((c) => c.value)).toEqual(['', 'opus', 'haiku']);
    expect(modelChoices(undefined).map((c) => c.value)).toEqual(['', 'opus', 'sonnet', 'haiku', 'fable']);
    expect(modelChoices(catalog, 'claude-sonnet-4-5').at(-1)).toMatchObject({ value: 'claude-sonnet-4-5', short: 'sonnet-4-5', hint: 'custom' });
    expect(modelChoices(catalog, 'claude-haiku-5-5')).toHaveLength(3); // resolves to the haiku alias
  });

  it('maps an id or alias to its choice; the exact alias wins over a shared resolved model', () => {
    expect(modelChoiceOf(catalog, undefined)).toBe('');
    expect(modelChoiceOf(catalog, 'opus')).toBe('opus');
    expect(modelChoiceOf(catalog, 'default')).toBe('');
    expect(modelChoiceOf(catalog, 'claude-opus-5-5')).toBe('opus');
    expect(modelChoiceOf(catalog, 'x-1')).toBe('x-1');
    expect(modelLabel('claude-haiku-4-5-20251001')).toBe('haiku-4-5');
  });

  it('effort levels follow what the model supports', () => {
    expect(effortChoices(undefined).map((c) => c.value)).toEqual(['', 'low', 'medium', 'high', 'xhigh', 'max']);
    expect(effortChoices(catalog, 'haiku').map((c) => c.value)).toEqual(['', 'low', 'medium']);
  });

  it('permission modes: default for unknown, tones for the risky ones', () => {
    expect(permissionChoice(undefined).value).toBe('default');
    expect(permissionChoice('bypassPermissions').tone).toBe('critical');
    expect(permissionChoice('nope').value).toBe('default');
  });

  it('says what applied live and what waits', () => {
    expect(configureMessage({ model: 'live', permissionMode: 'live' })).toEqual({ title: 'Model, Permission mode changed', message: 'Applied to the running session.' });
    expect(configureMessage({ effort: 'restart' }).message).toMatch(/next message/);
    expect(configureMessage({ model: 'next' }).message).toMatch(/continues/);
  });
});

describe('slash commands', () => {
  const skills = [
    { name: 'review', desc: 'Critical review' },
    { name: 'plan', desc: 'Write a plan' },
  ];
  const commands = [{ name: 'review', description: 'CLI review' }, { name: 'compact', description: 'Clear history. Keeps a summary.', argumentHint: '<instructions>' }, { name: 'pre-review' }];
  it('merges Cortex skills and CLI commands, de-duplicated, prefix matches first', () => {
    expect(slashOptions('', skills, commands).map((o) => `${o.source}:${o.name}`)).toEqual(['cortex:review', 'cortex:plan', 'cli:compact', 'cli:pre-review']);
    expect(slashOptions('rev', skills, commands).map((o) => o.name)).toEqual(['review', 'pre-review']);
    expect(slashOptions('comp', skills, commands)[0]).toEqual({ name: 'compact', desc: 'Clear history.', args: '<instructions>', source: 'cli' });
  });
});

describe('settings form: model / effort', () => {
  it('select or a custom id; default = unset', () => {
    expect(settingsPatch({ model: 'default', modelCustom: '', effort: 'default', permissionMode: 'plan', refreshSec: '60' })).toMatchObject({ model: undefined, effort: undefined, permissionMode: 'plan' });
    expect(settingsPatch({ model: 'opus', modelCustom: ' claude-x ', effort: 'xhigh', permissionMode: 'default', refreshSec: '60' })).toMatchObject({ model: 'claude-x', effort: 'xhigh' });
    expect(modelOptions(undefined, undefined)[0]).toEqual({ value: 'default', label: 'CLI default (no flag)' });
  });
});
