/**
 * `<userData>/config.json`: loads it (zod, per-field fallback), writes patches back (atomic, only the
 * keys that were in the file plus the patch: defaults are not frozen into it), writes a starter file
 * and `config.schema.json` on first run, and watches it for edits made outside the app.
 */
import { existsSync, mkdirSync, readFileSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { configProblems, mergePatch, parseUserConfig, userConfigJsonSchema, type ConfigUpdateRequest, type UserConfig, type UserConfigState } from '../../shared/userConfig';
import { atomicWrite } from './atomicWrite';

export const CONFIG_FILE = 'config.json';
export const CONFIG_SCHEMA_FILE = 'config.schema.json';

type Raw = Record<string, unknown>;

/** Read a config file: the raw object (null = missing) or a parse error. */
export function readConfigFile(file: string): { raw: Raw | null; error?: string } {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { raw: null };
    return { raw: null, error: `could not read ${file}: ${(e as Error).message}` };
  }
  if (!text.trim()) return { raw: {} };
  try {
    const raw: unknown = JSON.parse(text.replace(/^﻿/, ''));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { raw: null, error: `${basename(file)} is not a JSON object` };
    return { raw: raw as Raw };
  } catch (e) {
    return { raw: null, error: `${basename(file)} is not valid JSON (${(e as Error).message}); using the defaults` };
  }
}

/** Is `path` config.json (or its schema) in `userData`? `fs:writeText` refuses those: config changes go through `config:update`. */
export function isConfigFile(path: string, userData: string, platform: NodeJS.Platform = process.platform): boolean {
  const norm = (p: string) => (platform === 'win32' || platform === 'darwin' ? resolve(p).toLowerCase() : resolve(p));
  const p = norm(path);
  return p === norm(join(userData, CONFIG_FILE)) || p === norm(join(userData, CONFIG_SCHEMA_FILE));
}

/** Starter content: just the schema reference (defaults stay in the app, so later releases can change them). */
export const STARTER_CONFIG = `${JSON.stringify({ $schema: `./${CONFIG_SCHEMA_FILE}` }, null, 2)}\n`;

export class UserConfigStore {
  readonly path: string;
  private raw: Raw = {};
  /** the file could not be parsed: don't overwrite what the user is editing */
  private broken?: string;
  private current: UserConfigState;
  private watcher?: FSWatcher;
  private timer?: ReturnType<typeof setTimeout>;
  private listeners = new Set<(s: UserConfigState) => void>();
  private lastText = '';

  constructor(userData: string) {
    this.path = join(userData, CONFIG_FILE);
    this.current = this.read();
  }

  get state(): UserConfigState {
    return this.current;
  }

  get config(): UserConfig {
    return this.current.config;
  }

  onChange(cb: (s: UserConfigState) => void): () => void {
    this.listeners.add(cb);
    return () => void this.listeners.delete(cb);
  }

  /** Reload from disk; notifies when the effective config changed. */
  reload(): UserConfigState {
    const next = this.read();
    const changed = JSON.stringify(next) !== JSON.stringify(this.current);
    this.current = next;
    if (changed) for (const cb of this.listeners) cb(next);
    return next;
  }

  /** Apply a (validated) patch and write the file. Refuses while the file is not valid JSON. */
  async update(req: ConfigUpdateRequest): Promise<UserConfigState> {
    this.read(); // pick up edits the watcher has not reported yet
    if (this.broken) throw new Error(`${this.broken}. Fix the file first; nothing was changed.`);
    const raw = mergePatch(this.raw, req.patch as Raw, req.ifUnset);
    const text = `${JSON.stringify({ $schema: `./${CONFIG_SCHEMA_FILE}`, ...raw }, null, 2)}\n`;
    await atomicWrite(this.path, text);
    return this.reload();
  }

  /** First run: a starter config.json (never overwritten) and the schema (always refreshed: it belongs to the app). */
  ensureFiles(): void {
    const dir = dirname(this.path);
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, CONFIG_SCHEMA_FILE), `${JSON.stringify(userConfigJsonSchema(), null, 2)}\n`);
      if (!existsSync(this.path)) writeFileSync(this.path, STARTER_CONFIG, { flag: 'wx' });
    } catch (e) {
      console.warn(`[config] could not write ${dir}: ${(e as Error).message}`);
    }
  }

  /** Watch the folder (editors replace the file on save, so watching the file itself loses it). */
  watch(): void {
    if (this.watcher) return;
    try {
      this.watcher = watch(dirname(this.path), { persistent: false }, (_event, name) => {
        if (name && name.toString() !== CONFIG_FILE) return;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.reload(), 100);
      });
      this.watcher.on('error', (e) => {
        console.warn(`[config] watch failed: ${e.message}`);
        this.close();
      });
    } catch (e) {
      console.warn(`[config] cannot watch ${this.path}: ${(e as Error).message}`);
    }
  }

  close(): void {
    clearTimeout(this.timer);
    this.watcher?.close();
    this.watcher = undefined;
  }

  private read(): UserConfigState {
    const { raw, error } = readConfigFile(this.path);
    this.broken = error;
    if (!error) this.raw = stripSchemaKey(raw ?? {});
    const source = error ? {} : this.raw;
    const problems = error ? [error] : configProblems(source).map((k) => `invalid value for "${k}", using the default`);
    const text = JSON.stringify(source);
    if (problems.length && text !== this.lastText) console.warn(`[config] ${this.path}: ${problems.join('; ')}`);
    this.lastText = text;
    return { config: parseUserConfig(source), path: this.path, problems };
  }
}

function stripSchemaKey(raw: Raw): Raw {
  const { $schema: _ignored, ...rest } = raw;
  return rest;
}
