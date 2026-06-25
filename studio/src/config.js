// Resolve how DialKit Studio should build and serve a host prototype.
//
// Resolution order: explicit dialkit.studio.config.json in the host root, then
// CLI flags, then a best-effort heuristic (detect Vite / Create React App). The
// resolved command is printed before any historical build runs so the user can
// confirm what will execute across many commits.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join, isAbsolute } from 'node:path';

const CONFIG_FILE = 'dialkit.studio.config.json';

function gitRoot(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function detectBuild(packageDir) {
  // Returns { install, build, outDir } guessed from the package layout.
  const hasVite = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs'].some((f) =>
    existsSync(join(packageDir, f))
  );
  let pkg = {};
  try {
    pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  } catch {
    /* no package.json — leave pkg empty */
  }
  const scripts = pkg.scripts ?? {};
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  if (hasVite || deps.vite) {
    return { install: 'npm install', build: scripts.build ? 'npm run build' : 'npx vite build', outDir: 'dist' };
  }
  if (deps['react-scripts']) {
    return { install: 'npm install', build: 'npm run build', outDir: 'build' };
  }
  // Fallback: assume an npm build that emits dist/.
  return { install: 'npm install', build: scripts.build ? 'npm run build' : null, outDir: 'dist' };
}

export function resolveConfig(flags = {}) {
  const cwd = flags.root ? resolve(flags.root) : process.cwd();
  const root = gitRoot(cwd);
  if (!root) {
    throw new Error(`Not inside a git repository: ${cwd}`);
  }

  let fileConfig = {};
  const configPath = join(root, CONFIG_FILE);
  if (existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch (err) {
      throw new Error(`Failed to parse ${CONFIG_FILE}: ${err.message}`);
    }
  }

  // The app that imports dialkit may live in a sub-directory of the repo.
  const relPackageDir = flags.packageDir ?? fileConfig.packageDir ?? '.';
  const packageDir = isAbsolute(relPackageDir) ? relPackageDir : join(root, relPackageDir);

  const guessed = detectBuild(packageDir);

  const config = {
    root,
    packageDir,
    relPackageDir,
    install: flags.install ?? fileConfig.install ?? guessed.install,
    // A command run once in the worktree before build (e.g. build a local dep).
    prepare: flags.prepare ?? fileConfig.prepare ?? null,
    build: flags.build ?? fileConfig.build ?? guessed.build,
    outDir: flags.out ?? fileConfig.outDir ?? guessed.outDir,
    port: Number(flags.port ?? fileConfig.port ?? 4100),
    // Max number of commits listed in the history API (cheap; build is lazy).
    maxCommits: Number(flags.maxCommits ?? fileConfig.maxCommits ?? 200),
    cacheDir: join(root, '.dialkit-studio'),
  };

  if (!config.build) {
    throw new Error(
      'Could not determine a build command. Add a "build" field to dialkit.studio.config.json or pass --build "<cmd>".'
    );
  }
  return config;
}
