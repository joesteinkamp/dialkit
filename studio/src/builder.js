// Lazily rebuild a prototype at a given git ref and cache the built static
// output by hash. Built output is immutable per commit, so the cache never
// invalidates; we keep a small JSON manifest so it survives restarts.

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, rm, cp, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { addWorktree, removeWorktree, headHash } from './git.js';

const execAsync = promisify(exec);
const CURRENT = 'current';

export class Builder {
  constructor(config, log = () => {}) {
    this.config = config;
    this.log = log;
    this.manifestPath = join(config.cacheDir, 'manifest.json');
    this.builds = new Map(); // ref -> { status, dir, builtAt, error }
    this.inflight = new Map(); // ref -> Promise
  }

  async init() {
    await mkdir(this.config.cacheDir, { recursive: true });
    try {
      const raw = await readFile(this.manifestPath, 'utf8');
      const saved = JSON.parse(raw);
      for (const [ref, entry] of Object.entries(saved.builds ?? {})) {
        // Only trust entries whose output still exists on disk.
        if (entry.status === 'ready' && (await this.exists(entry.dir))) {
          this.builds.set(ref, entry);
        }
      }
    } catch {
      /* no manifest yet */
    }
  }

  async exists(p) {
    try {
      await access(p);
      return true;
    } catch {
      return false;
    }
  }

  status(ref) {
    return this.builds.get(ref) ?? { status: 'idle' };
  }

  outputDir(ref) {
    return join(this.config.cacheDir, `build-${ref}`);
  }

  async persist() {
    const builds = Object.fromEntries(this.builds);
    await writeFile(this.manifestPath, JSON.stringify({ version: 1, builds }, null, 2));
  }

  /** Build `ref` if needed; returns when ready (or throws on error). Coalesces concurrent calls. */
  async ensure(ref, { force = false } = {}) {
    if (!force) {
      const existing = this.builds.get(ref);
      if (existing?.status === 'ready' && (await this.exists(existing.dir))) return existing;
    }
    if (this.inflight.has(ref)) return this.inflight.get(ref);

    const p = this._build(ref, force).finally(() => this.inflight.delete(ref));
    this.inflight.set(ref, p);
    return p;
  }

  async _build(ref, force) {
    const outDir = this.outputDir(ref);
    this.builds.set(ref, { status: 'building', dir: outDir });
    this.log(`[build] ${ref}: starting`);

    let worktreeDir = null;
    try {
      let pkgDir;
      if (ref === CURRENT) {
        // Build the live working tree in place.
        pkgDir = this.config.packageDir;
      } else {
        worktreeDir = join(this.config.cacheDir, `wt-${ref}`);
        await rm(worktreeDir, { recursive: true, force: true });
        await addWorktree(this.config.root, ref, worktreeDir);
        pkgDir = join(worktreeDir, this.config.relPackageDir);
        if (this.config.install) await this.run(this.config.install, worktreeDir, ref, 'install');
        if (this.config.prepare) await this.run(this.config.prepare, worktreeDir, ref, 'prepare');
      }

      await this.run(this.config.build, pkgDir, ref, 'build');

      const built = join(pkgDir, this.config.outDir);
      if (!(await this.exists(built))) {
        throw new Error(`Build did not produce expected output dir: ${this.config.outDir}`);
      }

      await rm(outDir, { recursive: true, force: true });
      await cp(built, outDir, { recursive: true });

      const entry = { status: 'ready', dir: outDir, builtAt: new Date().toISOString() };
      this.builds.set(ref, entry);
      await this.persist();
      this.log(`[build] ${ref}: ready`);
      return entry;
    } catch (err) {
      const entry = { status: 'error', dir: outDir, error: String(err.message ?? err) };
      this.builds.set(ref, entry);
      this.log(`[build] ${ref}: error — ${entry.error}`);
      throw err;
    } finally {
      if (worktreeDir) await removeWorktree(this.config.root, worktreeDir);
    }
  }

  async run(command, cwd, ref, phase) {
    // Tokens let a build command target the sub-path a version is served at,
    // e.g. "vite build --base=/v/{ref}/" so absolute asset URLs and client-side
    // router basenames resolve correctly under /v/<ref>/.
    command = command.replaceAll('{ref}', ref).replaceAll('{base}', `/v/${ref}/`);
    this.log(`[build] ${ref}: ${phase}: ${command}`);
    await execAsync(command, {
      cwd,
      maxBuffer: 256 * 1024 * 1024,
      env: { ...process.env, CI: '1' },
    });
  }

  /** Resolve a UI-facing ref ('current' or a hash/shortHash) to a cache key. */
  normalizeRef(ref) {
    if (ref === CURRENT) return CURRENT;
    return ref;
  }

  headHash() {
    return headHash(this.config.root);
  }
}

export { CURRENT };
