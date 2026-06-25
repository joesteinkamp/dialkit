#!/usr/bin/env node
// DialKit Studio CLI.
//
//   dialkit-studio [--root <dir>] [--package-dir <dir>] [--build "<cmd>"]
//                  [--install "<cmd>"] [--prepare "<cmd>"] [--out <dir>]
//                  [--port <n>] [--max-commits <n>]

import { resolveConfig } from './config.js';
import { Builder } from './builder.js';
import { createStudioServer } from './server.js';

function parseArgs(argv) {
  const flags = {};
  const map = {
    '--root': 'root',
    '--package-dir': 'packageDir',
    '--build': 'build',
    '--install': 'install',
    '--prepare': 'prepare',
    '--out': 'out',
    '--port': 'port',
    '--max-commits': 'maxCommits',
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      flags.help = true;
      continue;
    }
    const key = map[arg];
    if (key) flags[key] = argv[++i];
  }
  return flags;
}

const HELP = `dialkit-studio — rebuild prototype versions from git history and run dialed variants

Usage: dialkit-studio [options]

Options:
  --root <dir>          Repo root or any dir inside it (default: cwd)
  --package-dir <dir>   App directory relative to repo root (default: .)
  --build "<cmd>"       Build command (auto-detected for Vite/CRA)
  --install "<cmd>"     Install command run in each historical worktree
  --prepare "<cmd>"     Command run in the worktree before build (e.g. build a local dep)
  --out <dir>           Build output dir relative to package dir (default: dist)
  --port <n>            Port (default: 4100)
  --max-commits <n>     Max commits listed in history (default: 200)

Config file: dialkit.studio.config.json in the repo root may set any of the above
(keys: packageDir, install, prepare, build, outDir, port, maxCommits).`;

const flags = parseArgs(process.argv);
if (flags.help) {
  console.log(HELP);
  process.exit(0);
}

const log = (msg) => console.log(msg);

let config;
try {
  config = resolveConfig(flags);
} catch (err) {
  console.error(`dialkit-studio: ${err.message}`);
  process.exit(1);
}

console.log('DialKit Studio');
console.log(`  repo:     ${config.root}`);
console.log(`  package:  ${config.relPackageDir}`);
console.log(`  install:  ${config.install ?? '(skipped)'}`);
if (config.prepare) console.log(`  prepare:  ${config.prepare}`);
console.log(`  build:    ${config.build}`);
console.log(`  output:   ${config.outDir}`);
console.log('');
console.log('Historical versions are rebuilt lazily (first view) via git worktrees and cached.');
console.log('');

const builder = new Builder(config, log);
await builder.init();

const server = createStudioServer(config, builder, log);
server.listen(config.port, () => {
  console.log(`  ▶ http://localhost:${config.port}/studio/`);
});
