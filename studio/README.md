# @dialkit/studio

Rebuild a prototype from its **git history** and run multiple **dialed variants**
side by side.

DialKit Studio is a local dev-server + UI that complements the `dialkit` library:

- **History** — every commit on your branch becomes a runnable version. Studio
  checks out the commit in a git worktree, builds it, and serves it — lazily (on
  first view) and cached by commit hash. Scrub the timeline to see how the
  prototype evolved, and run any past version for real.
- **Grid** — compose a zoomed-out board of variants. Add a tile by picking a base
  (a history commit, or the current working tree) and tune its dials; each tile
  runs in its own iframe, fully independent, so you can compare many dialed
  versions at a glance.

The glue is the **bridge** that ships in `dialkit` itself: when a prototype runs
inside Studio it streams its dial panels up to the Studio chrome and applies the
dial values Studio pushes down (see `dialkit/bridge` and `connectDialKitStudio`).

## Setup

1. In your prototype, connect the bridge once at startup (no-op outside Studio):

   ```ts
   import { connectDialKitStudio } from 'dialkit'; // React
   // or: import { connectDialKitStudio } from 'dialkit/bridge'; // Solid/Vue/Svelte
   connectDialKitStudio();
   ```

2. Make the build work when served under a sub-path (`/v/<ref>/`). For Vite,
   build with a per-ref base and use it as your router basename (if you route at
   all):

   ```ts
   const basename = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') || '/';
   // <BrowserRouter basename={basename}> ... </BrowserRouter>
   ```

   Single-page prototypes with no client-side routing need nothing here.

3. Add `dialkit.studio.config.json` to your repo root (or pass CLI flags):

   ```json
   {
     "packageDir": ".",
     "build": "npx vite build --base=/v/{ref}/",
     "outDir": "dist"
   }
   ```

   The `{ref}` token expands to the commit hash (or `current`) being built, so the
   version is served correctly under `/v/<ref>/`.

## Run

```bash
npx dialkit-studio          # or: node studio/src/cli.js
# ▶ http://localhost:4100/studio/
```

### CLI flags

| Flag | Meaning |
| --- | --- |
| `--root <dir>` | Repo root or any dir inside it (default: cwd) |
| `--package-dir <dir>` | App dir relative to repo root (default: `.`) |
| `--build "<cmd>"` | Build command (auto-detected for Vite/CRA). Supports `{ref}` / `{base}` |
| `--install "<cmd>"` | Install command run in each historical worktree |
| `--prepare "<cmd>"` | Command run in the worktree before build (e.g. build a local dep) |
| `--out <dir>` | Build output dir relative to package dir (default: `dist`) |
| `--port <n>` | Port (default: 4100) |
| `--max-commits <n>` | Max commits listed in history (default: 200) |

Config-file keys mirror the flags: `packageDir`, `install`, `prepare`, `build`,
`outDir`, `port`, `maxCommits`.

## How it works

```
 Studio UI (parent)                     each version / tile (iframe)
 ─────────────────                      ───────────────────────────
  GET /api/history   ── git log ──►      built by `git worktree add` + your
  POST /api/build    ── lazy build ►     build command, cached at .dialkit-studio/
  GET  /v/:ref/*     ── serve static     served under /v/<ref>/

  postMessage bridge ◄── panel-sync / value-sync ──  connectDialKitStudio()
                     ──► value-push / set-panels-hidden ─►  DialStore
```

Because every version/tile is its own iframe, it has its own document and its own
singleton `DialStore` — so running N dialed variants at once needs no special
multi-tenant store. Built output is immutable per commit; the cache (under
`.dialkit-studio/`, git-ignored) never invalidates.

## Notes & limitations

- **Lazy builds.** The timeline lists every commit cheaply from `git log`; a
  commit is only built when first viewed. The first build of a commit can be slow
  (install + build); subsequent views are instant from cache.
- **Old commits without the bridge.** A version whose `dialkit` predates
  `dialkit/bridge` never completes the handshake. Studio marks it **"no bridge"**:
  it still runs (with its own in-iframe panel), but Studio can't push dial values
  into it.
- **Historical fidelity is real.** A version is the *actual old code*, so it also
  reproduces old quirks. If an old commit didn't yet handle sub-path serving
  (base/router basename), it may render incorrectly under `/v/<ref>/` — that's the
  old code, faithfully.
- **Many live iframes are heavy.** Each tile boots the full app; the grid warns
  past ~9 tiles. Remove tiles you're not comparing.
