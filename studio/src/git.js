// Thin git helpers for DialKit Studio. Reads are cheap (git log); building a
// commit is handled separately in builder.js.

import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const FIELD = '\x1f'; // unit separator
const RECORD = '\x1e'; // record separator

/**
 * List commits on the current branch, newest first. Cheap — does not build
 * anything. `touchesDialkit` flags commits that changed a file mentioning
 * dialkit (a useful filter for noisy histories; the UI may surface it).
 */
export async function listCommits(root, max = 200) {
  const format = ['%H', '%h', '%s', '%an', '%aI'].join(FIELD) + RECORD;
  const { stdout } = await execFileAsync(
    'git',
    ['log', `--max-count=${max}`, `--pretty=format:${format}`],
    { cwd: root, maxBuffer: 64 * 1024 * 1024 }
  );

  return stdout
    .split(RECORD)
    .map((r) => r.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash, shortHash, subject, author, date] = record.split(FIELD);
      return { hash, shortHash, subject, author, date };
    });
}

/** Resolve a ref (branch/tag/short hash) to a full commit hash. */
export function resolveRef(root, ref) {
  return execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
}

/** Current HEAD commit hash. */
export function headHash(root) {
  return resolveRef(root, 'HEAD');
}

/** Add a detached worktree for `hash` at `dir`. Idempotent-ish: caller ensures dir is fresh. */
export async function addWorktree(root, hash, dir) {
  await execFileAsync('git', ['worktree', 'add', '--detach', '--force', dir, hash], {
    cwd: root,
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Remove a worktree (best-effort). */
export async function removeWorktree(root, dir) {
  try {
    await execFileAsync('git', ['worktree', 'remove', '--force', dir], { cwd: root });
  } catch {
    // Worktree may already be gone; prune to keep git's metadata tidy.
    try {
      await execFileAsync('git', ['worktree', 'prune'], { cwd: root });
    } catch {
      /* ignore */
    }
  }
}
