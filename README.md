# dialkit v1.3.0

<img src="https://joshpuckett.me/images/dialkit.png" width="100%" />

**DialKit makes it easy to manage and explore divergent ideas in a coded prototype** — for React, Solid, Svelte, and Vue. Created by Josh Puckett.

To learn more about how I use DialKit, and approach design in general, feel free to check out [Interface Craft](http://interfacecraft.dev/).

---

## What it's for

Prototyping in code gives you real, runnable interfaces — but exploring *divergent* directions in code is messy. You tweak a value and the previous idea is gone. Variations live in your head, in commented-out blocks, or in `git stash`. Comparing two options means rebuilding one of them by hand.

DialKit makes divergence cheap to **create**, **keep**, and **compare** — across four layers, from a single knob to a whole board of variants:

1. **Dials** — `useDialKit` turns any parameter into a live control, so you can explore the space of *one* idea without editing code.
2. **Versions & presets** — snapshot a set of dialed values as a named version and switch between divergent directions instantly.
3. **Studio · History** — DialKit Studio rebuilds and *runs* any past commit, so directions you moved on from aren't lost — you can revisit and run them for real.
4. **Studio · Grid + zoom** — run many dialed variants side by side, zoom into one to compare, and traverse between them.

> knob → snapshot → time → parallel

The first two ship in the `dialkit` library (below). The last two are [**DialKit Studio**](#dialkit-studio--explore-across-time-and-variants), a local dev-server + UI that builds on the same library.

---

## Quick Start

```bash
npm install dialkit motion
```

```tsx
// layout.tsx
import { DialRoot } from 'dialkit';
import 'dialkit/styles.css';

export default function Layout({ children }) {
  return (
    <html>
      <body>
        {children}
        <DialRoot />
      </body>
    </html>
  );
}
```

```tsx
// component.tsx
import { useDialKit } from 'dialkit';

function Card() {
  const p = useDialKit('Card', {
    blur: [24, 0, 100],
    scale: 1.2,
    color: '#ff5500',
    visible: true,
  });

  return (
    <div style={{
      filter: `blur(${p.blur}px)`,
      transform: `scale(${p.scale})`,
      color: p.color,
      opacity: p.visible ? 1 : 0,
    }}>
      ...
    </div>
  );
}
```

---

## The library

### useDialKit

```tsx
const params = useDialKit(name, config, options?)
```

| Param | Type | Description |
|-------|------|-------------|
| `name` | `string` | Panel title displayed in the UI |
| `config` | `DialConfig` | Parameter definitions (see Control Types below) |
| `options.id` | `string` | Stable logical id for sharing values across remounts/pages |
| `options.persist` | `DialKitPersistOptions` | Persist values to browser storage |
| `options.onAction` | `(path: string) => void` | Callback when action buttons are clicked |
| `options.shortcuts` | `Record<string, ShortcutConfig>` | Keyboard shortcuts for controls (see [Keyboard Shortcuts](#keyboard-shortcuts)) |

Returns a fully typed object matching your config shape with live values. Updating a control in the UI immediately updates the returned values.

### Control Types

#### Slider

Numbers create sliders. There are three ways to define them:

**Explicit range** — `[default, min, max]`:
```tsx
blur: [24, 0, 100]
```

**Explicit range + step** — `[default, min, max, step]`:
```tsx
blur: [24, 0, 100, 5]    // snaps in increments of 5
```
When `step` is omitted, it's inferred from the range (see table below).

**Auto-inferred** — bare number:
```tsx
scale: 1.2
```
A single number auto-infers a reasonable min, max, and step:

| Value range | Inferred min/max | Step |
|-------------|-----------------|------|
| 0–1 | 0 to 1 | 0.01 |
| 0–10 | 0 to value &times; 3 | 0.1 |
| 0–100 | 0 to value &times; 3 | 1 |
| 100+ | 0 to value &times; 3 | 10 |

**Returns:** `number`

Sliders support click-to-snap (with spring animation), drag with rubber-band overflow, and direct text editing (hover the value for 800ms, then click to type).

#### Toggle

```tsx
enabled: true
darkMode: false
```

Booleans create an Off/On segmented control.

**Returns:** `boolean`

#### Text

```tsx
title: 'Hello'                                    // auto-detected from string
subtitle: { type: 'text', default: '', placeholder: 'Enter subtitle...' }
```

Non-hex strings are auto-detected as text inputs. Use the explicit form for a placeholder or to set a default.

**Returns:** `string`

#### Color

```tsx
color: '#ff5500'                           // auto-detected from hex string
bg: { type: 'color', default: '#000' }     // explicit
```

Hex strings (`#RGB`, `#RRGGBB`, `#RRGGBBAA`) are auto-detected as color pickers. Each color control has a text display (click to edit the hex value), and a swatch button that opens the native color picker.

**Returns:** `string` (hex color)

#### Select

```tsx
layout: {
  type: 'select',
  options: ['stack', 'fan', 'grid'],
  default: 'stack',
}
```

Options can be plain strings or `{ value, label }` objects for custom display text:

```tsx
shape: {
  type: 'select',
  options: [
    { value: 'portrait', label: 'Portrait' },
    { value: 'square', label: 'Square' },
    { value: 'landscape', label: 'Landscape' },
  ],
  default: 'portrait',
}
```

If `default` is omitted, the first option is selected.

**Returns:** `string` (the selected option's value)

#### Spring

```tsx
// Time-based (simple mode)
spring: { type: 'spring', visualDuration: 0.3, bounce: 0.2 }

// Physics-based (advanced mode)
spring: { type: 'spring', stiffness: 200, damping: 25, mass: 1 }
```

Creates a visual spring editor with a live animation curve preview. The editor supports two modes, toggled in the UI:

- **Time** (simple) — `visualDuration` (0.1–1s) and `bounce` (0–1). Ideal for most animations.
- **Physics** (advanced) — `stiffness` (1–1000), `damping` (1–100), and `mass` (0.1–10). Full control over spring dynamics.

The returned config object is passed directly to Motion's `transition` prop:

```tsx
const p = useDialKit('Card', {
  spring: { type: 'spring', visualDuration: 0.5, bounce: 0.04 },
  x: [0, -200, 200],
});

<motion.div animate={{ x: p.x }} transition={p.spring} />
```

**Returns:** `SpringConfig` (pass directly to Motion)

#### Action

```tsx
const p = useDialKit('Controls', {
  shuffle: { type: 'action' },
  reset: { type: 'action', label: 'Reset All' },
}, {
  onAction: (path) => {
    if (path === 'shuffle') shuffleItems();
    if (path === 'reset') resetToDefaults();
  },
});
```

Action buttons trigger callbacks without storing any value. The `label` defaults to the formatted key name (camelCase becomes Title Case). Multiple adjacent actions are grouped vertically.
Action buttons can be placed at the root or nested inside folders.

#### Folder

Any nested plain object becomes a collapsible folder. Folders can nest arbitrarily deep.

```tsx
shadow: {
  blur: [10, 0, 50],
  opacity: [0.25, 0, 1],
  color: '#000000',
}

// Access nested values:
params.shadow.blur     // number
params.shadow.color    // string
```

Folders are open by default. Add `_collapsed: true` to start a folder closed. This is a reserved metadata key — it controls the UI only and won't appear in your returned values.

```tsx
shadow: {
  _collapsed: true,    // folder starts closed
  blur: [10, 0, 50],
  opacity: [0.25, 0, 1],
}
```

DialKit also supports dynamic config updates. If your config shape, defaults, options, or labels change over time, the panel updates while preserving current values where paths still exist.

Dynamic configs work with both inline objects and memoized configs — no special consumer action needed:

```tsx
const values = useDialKit('Controls', {
  style: { type: 'select', options: dynamicOptions },
});
```

### Versions & presets

The clearest way to keep divergent directions instead of overwriting them: save the current dialed values as a named **version**, then switch between versions to compare directions.

When the panel is open, the toolbar provides:

- **Presets** — a version dropdown for saving and loading parameter snapshots. Click "+" to save the current state as a new version. Select a version to load it. Changes auto-save to the active version. "Version 1" always represents the original defaults.
- **Copy** — exports the current values as JSON to your clipboard.

Versions are per-panel snapshots of dialed values; pair them with [Stable IDs and Persistence](#stable-ids-and-persistence) below to make them survive reloads, and with [Studio](#dialkit-studio--explore-across-time-and-variants) to run several at once.

### Stable IDs and Persistence

By default, a DialKit panel is tied to the lifecycle of the component that calls `useDialKit`. Pass `id` when multiple mounts should reconnect to the same logical panel, and pass `persist: true` when values should survive reloads and browser sessions.

```tsx
// dials/useOnboardingDials.ts
import { useDialKit } from 'dialkit';

export function useOnboardingDials() {
  return useDialKit('Onboarding', {
    name: { type: 'text', default: 'Avery', placeholder: 'Name' },
    avatarScale: [1, 0.6, 1.6, 0.01],
    accent: { type: 'color', default: '#6C5CE7' },
  }, {
    id: 'onboarding',
    persist: true,
  });
}
```

Use that helper anywhere the shared values are needed:

```tsx
function PageTwo() {
  const onboarding = useOnboardingDials();

  const page = useDialKit('Page Two', {
    cardRadius: [16, 0, 64],
  });

  return (
    <Card
      name={onboarding.name}
      radius={page.cardRadius}
      accent={onboarding.accent}
    />
  );
}
```

When `PageTwo` is mounted, the single `<DialRoot />` shows both `Onboarding` and `Page Two` as top-level sections. If another page calls `useOnboardingDials()`, DialKit reconnects to the same `id` and keeps the shared values.

`persist: true` stores values, presets, and the active preset in `localStorage` using `dialkit:${id}` as the key. Use the object form to customize storage:

```tsx
useDialKit('Onboarding', config, {
  id: 'onboarding',
  persist: {
    key: 'my-app:onboarding-dials',
    storage: 'sessionStorage',
    presets: false,
  },
});
```

The `id` string has no special format; it only needs to be reused wherever you want the same logical panel. Without `id` or `persist`, DialKit behaves exactly as before.

### useDialKitController

Use the controller API when your app code also needs to update DialKit values, such as reset buttons, URL sync, or app-defined preset buttons.

```tsx
import { useDialKitController } from 'dialkit';

function Card() {
  const dial = useDialKitController('Card', {
    blur: [24, 0, 100],
    scale: 1.2,
    color: '#ff5500',
    visible: true,
    shadow: {
      radius: [16, 0, 64],
    },
  });

  return (
    <>
      <button onClick={() => dial.setValues({
        blur: 48,
        scale: 1,
        shadow: { radius: 28 },
      })}>
        Apply preset
      </button>
      <button onClick={() => dial.resetValues()}>Reset</button>

      <div style={{
        filter: `blur(${dial.values.blur}px)`,
        transform: `scale(${dial.values.scale})`,
        color: dial.values.color,
        opacity: dial.values.visible ? 1 : 0,
        borderRadius: dial.values.shadow.radius,
      }}>
        ...
      </div>
    </>
  );
}
```

Controller methods:

| Method | Description |
|--------|-------------|
| `values` | The same live resolved values returned by `useDialKit` |
| `setValue(path, value)` | Updates one control by dot path, like `'shadow.radius'` |
| `setValues(values)` | Updates multiple controls with a typed nested partial object |
| `resetValues()` | Restores the current config defaults and clears the active preset |
| `getValues()` | Reads the latest resolved values outside render callbacks |

Programmatic updates use the same state as panel edits. If a saved preset is active, updates are saved into that preset; otherwise they update the base "Version 1" values. Action controls are triggers, so they are not set by `setValues`.

### DialRoot

```tsx
<DialRoot position="top-right" />
```

| Prop | Type | Default |
|------|------|---------|
| `position` | `'top-right' \| 'top-left' \| 'bottom-right' \| 'bottom-left'` | `'top-right'` |
| `defaultOpen` | `boolean` | `true` |
| `mode` | `'popover' \| 'inline'` | `'popover'` |
| `productionEnabled` | `boolean` | `false` in production, `true` otherwise |
| `onOpenChange` | `(open: boolean) => void` | `undefined` |

Mount once at your app root. In the default `popover` mode, the panel renders via a portal on `document.body`. It collapses to a small icon button and expands to 280px wide on click.

#### Multiple panels

If multiple `useDialKit` calls are registered under the same root, DialKit renders one shared shell and shows each panel as a collapsible top-level section. No extra API is needed:

```tsx
function PhotoStack() {
  const photo = useDialKit('Photo Stack', {
    blur: [12, 0, 40],
    scale: [1, 0.5, 2],
  });

  const stage = useDialKit('Stage', {
    pagePadding: [40, 16, 96],
    background: '#ffffff',
  });

  return (
    <div style={{ padding: stage.pagePadding, background: stage.background }}>
      <img style={{ filter: `blur(${photo.blur}px)`, transform: `scale(${photo.scale})` }} />
    </div>
  );
}
```

The mounted `<DialRoot />` stays the same. With a single registered panel, the panel title and layout stay unchanged. This behavior works the same way in React, Solid, Svelte, and Vue.

Use `onOpenChange` when you need to persist whether the floating panel is open or collapsed:

```tsx
<DialRoot
  defaultOpen={localStorage.getItem('dialkit-open') !== '0'}
  onOpenChange={(open) => {
    localStorage.setItem('dialkit-open', open ? '1' : '0');
  }}
/>
```

DialKit is automatically hidden in production builds. To enable it in production, pass `productionEnabled`:

```tsx
<DialRoot productionEnabled />
```

#### Draggable panel

In popover mode, the collapsed panel bubble can be dragged to any position on the screen. When you click to open the panel, it snaps to the nearest side — top-left if the bubble is on the left half of the screen, top-right if on the right half. When the panel is closed again, it returns to where you last dragged it.

#### Inline mode

Use `mode="inline"` to render DialKit directly in your layout instead of as a floating popover. The panel fills its container and scrolls internally, which is useful for embedding in a sidebar or resizable panel. Inline mode works across all frameworks:

**React:**
```tsx
<aside style={{ width: 300, height: '100vh', overflow: 'hidden' }}>
  <DialRoot mode="inline" />
</aside>
```

**Solid:**
```tsx
<aside style={{ width: '300px', height: '100vh', overflow: 'hidden' }}>
  <DialRoot mode="inline" />
</aside>
```

**Svelte:**
```svelte
<aside style:width="300px" style:height="100vh" style:overflow="hidden">
  <DialRoot mode="inline" />
</aside>
```

In inline mode, the `position` prop is ignored and the collapse-to-icon behavior is disabled.

### Keyboard Shortcuts

Assign keyboard shortcuts to controls so you can adjust values without touching the panel. Pass a `shortcuts` map in the options object:

```tsx
const p = useDialKit('Card', {
  blur: [24, 0, 100],
  scale: 1.2,
  opacity: [1, 0, 1],
  borderRadius: [16, 0, 64],
  darkMode: true,
  shadow: {
    blur: [10, 0, 50],
  },
}, {
  shortcuts: {
    blur:          { key: 'b', mode: 'fine' },                          // B+Scroll
    scale:         { key: 's', interaction: 'drag', mode: 'coarse' },   // S+Drag
    opacity:       { key: 'o', interaction: 'move' },                   // O+Move
    borderRadius:  { interaction: 'scroll-only' },                      // Scroll (no key)
    darkMode:      { key: 'm' },                                        // press M
    'shadow.blur': { key: 'd', mode: 'fine' },                          // D+Scroll
  },
});
```

#### ShortcutConfig

```tsx
type ShortcutConfig = {
  key?: string;                                       // trigger key (e.g. 'b', 's') — optional for scroll-only
  modifier?: 'alt' | 'shift' | 'meta';               // optional modifier key
  mode?: 'fine' | 'normal' | 'coarse';               // precision level (default: 'normal')
  interaction?: 'scroll' | 'drag' | 'move' | 'scroll-only'; // input method (default: 'scroll')
};
```

#### Interaction types

| Interaction | Description | Example pill |
|-------------|-------------|-------------|
| `scroll` | Hold key + scroll wheel to adjust (default) | `B+Scroll` |
| `drag` | Hold key + click and drag horizontally | `S+Drag` |
| `move` | Hold key + move mouse (no click needed) | `O+Move` |
| `scroll-only` | Just scroll anywhere, no key needed | `Scroll` |

#### Supported controls

| Control | Interactions | Description |
|---------|-------------|-------------|
| **Slider** | `scroll`, `drag`, `move`, `scroll-only` | Adjust value with chosen input method |
| **Toggle** | key press | Press the assigned key to flip on/off |

#### Precision modes

For sliders, the `mode` controls how much each scroll tick or drag pixel changes the value:

| Mode | Step multiplier | Use case |
|------|----------------|----------|
| `fine` | step &divide; 10 | Precision tweaking |
| `normal` | step &times; 1 | Default behavior |
| `coarse` | step &times; 10 | Big sweeps |

#### Nested paths

For controls inside folders, use dot notation:

```tsx
shortcuts: {
  'shadow.blur': { key: 'd' },
  'shadow.opacity': { key: 'a', interaction: 'drag', mode: 'fine' },
}
```

#### UI indicators

Each control with a shortcut displays a pill badge next to its label showing the key and interaction (e.g. `B+Scroll`, `S+Drag`, `O+Move`, `Scroll`). The pill highlights when the shortcut key is actively held.

Shortcuts are automatically disabled when a text input is focused.

### Full example

```tsx
import { useDialKit } from 'dialkit';
import { motion } from 'motion/react';

function PhotoStack() {
  const p = useDialKit('Photo Stack', {
    // Text inputs
    title: 'Japan',
    subtitle: { type: 'text', default: 'December 2025', placeholder: 'Enter subtitle...' },

    // Color pickers
    accentColor: '#c41e3a',
    shadowTint: { type: 'color', default: '#000000' },

    // Select dropdown
    layout: { type: 'select', options: ['stack', 'fan', 'grid'], default: 'stack' },

    // Grouped sliders in a folder
    backPhoto: {
      offsetX: [239, 0, 400],
      offsetY: [0, 0, 150],
      scale: [0.7, 0.5, 0.95],
      overlayOpacity: [0.6, 0, 1],
    },

    // Spring config for Motion
    transitionSpring: { type: 'spring', visualDuration: 0.5, bounce: 0.04 },

    // Toggle
    darkMode: false,

    // Action buttons
    next: { type: 'action' },
    previous: { type: 'action' },
  }, {
    shortcuts: {
      'backPhoto.offsetX': { key: 'x', interaction: 'drag', mode: 'coarse' },
      'backPhoto.scale': { key: 's', interaction: 'move', mode: 'fine' },
      darkMode: { key: 'm' },
    },
    onAction: (action) => {
      if (action === 'next') goNext();
      if (action === 'previous') goPrevious();
    },
  });

  return (
    <motion.div
      animate={{ x: p.backPhoto.offsetX }}
      transition={p.transitionSpring}
      style={{ color: p.accentColor }}
    >
      <h1>{p.title}</h1>
      <p>{p.subtitle}</p>
    </motion.div>
  );
}
```

---

## DialKit Studio — explore across time and variants

The dials and versions above let you explore *within* a running prototype. **DialKit Studio** takes exploration two steps further — across **time** and across **variants** — and is the part of the project most directly about managing divergent ideas.

Studio is a local dev-server + UI (`@dialkit/studio`) that runs your prototype inside iframes and drives its dials from the outside:

- **History** — every commit on your branch becomes a runnable version. Studio checks out the commit in a git worktree, builds it, and serves it — lazily (on first view) and cached by commit hash. Scrub the timeline to see how the prototype evolved, and run any past version *for real*.
- **Grid** — compose a zoomed-out board of variants. Add a tile by picking a base (a history commit, or the current working tree) and tune its dials; each tile runs in its own iframe, fully independent, so you can compare many dialed versions at a glance. **Click a tile to zoom one variant onto a focused stage, use `←`/`→` (or number keys) to traverse between variants, and `Esc` / the backdrop / the close button to pop back out** — all without reloading the prototypes.

The glue is the **bridge** that ships in `dialkit` itself: when a prototype runs inside Studio it streams its dial panels up to the Studio chrome and applies the dial values Studio pushes down.

> Studio currently runs from the repo (it is a separate `@dialkit/studio` package, not yet published to npm). The canonical, always-up-to-date reference lives in [`studio/README.md`](studio/README.md).

### Setup

1. In your prototype, connect the bridge once at startup (it is a no-op outside Studio, so it's safe to leave in):

   ```ts
   import { connectDialKitStudio } from 'dialkit';        // React
   // or: import { connectDialKitStudio } from 'dialkit/bridge'; // Solid / Vue / Svelte
   connectDialKitStudio();
   ```

2. Make the build work when served under a sub-path (`/v/<ref>/`). For Vite, build with a per-ref base and use it as your router basename (if you route at all):

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

   The `{ref}` token expands to the commit hash (or `current`) being built, so each version is served correctly under `/v/<ref>/`.

### Run

```bash
npx dialkit-studio          # or: node studio/src/cli.js
# ▶ http://localhost:4100/studio/
```

Open `http://localhost:4100/studio/` and switch between the **History** and **Grid** tabs.

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

Config-file keys mirror the flags: `packageDir`, `install`, `prepare`, `build`, `outDir`, `port`, `maxCommits`.

### How it works

```
 Studio UI (parent)                     each version / tile (iframe)
 ─────────────────                      ───────────────────────────
  GET /api/history   ── git log ──►      built by `git worktree add` + your
  POST /api/build    ── lazy build ►     build command, cached at .dialkit-studio/
  GET  /v/:ref/*     ── serve static     served under /v/<ref>/

  postMessage bridge ◄── panel-sync / value-sync ──  connectDialKitStudio()
                     ──► value-push / set-panels-hidden / set-active ─►  DialStore
```

Because every version/tile is its own iframe, it has its own document and its own singleton `DialStore` — so running N dialed variants at once needs **no** special multi-tenant store. Built output is immutable per commit; the cache (under `.dialkit-studio/`, git-ignored) never invalidates.

### Notes & limitations

- **Lazy builds.** The timeline lists every commit cheaply from `git log`; a commit is only built when first viewed. The first build of a commit can be slow (install + build); subsequent views are instant from cache.
- **Old commits without the bridge.** A version whose `dialkit` predates `dialkit/bridge` never completes the handshake. Studio marks it **"no bridge"**: it still runs (with its own in-iframe panel), but Studio can't push dial values into it.
- **Historical fidelity is real.** A version is the *actual old code*, so it also reproduces old quirks. If an old commit didn't yet handle sub-path serving (base/router basename), it may render incorrectly under `/v/<ref>/` — that's the old code, faithfully.
- **Many live iframes are heavy.** Each tile boots the full app; the grid warns past ~9 tiles. Remove tiles you're not comparing.

---

## Frameworks

DialKit works the same way across React, Solid, Svelte, and Vue. React is shown throughout the docs above; the other adapters mirror that API — **all control types, config shapes, presets, folders, keyboard shortcuts, transitions, and `DialRoot` props work identically**. The only differences are the import path and how each framework exposes reactive values.

### Solid

Import from `dialkit/solid` — `createDialKit` replaces `useDialKit`, and `DialRoot` is a Solid component.

```bash
npm install dialkit solid-js
```

```tsx
// App.tsx
import { DialRoot } from 'dialkit/solid';
import 'dialkit/styles.css';

export default function App() {
  return (
    <>
      <MyComponent />
      <DialRoot />
    </>
  );
}
```

```tsx
// component.tsx
import { createDialKit } from 'dialkit/solid';

function Card() {
  const params = createDialKit('Card', {
    blur: [24, 0, 100],
    scale: 1.2,
    color: '#ff5500',
    visible: true,
  });

  return (
    <div style={{
      filter: `blur(${params().blur}px)`,
      transform: `scale(${params().scale})`,
      color: params().color,
      opacity: params().visible ? 1 : 0,
    }}>
      ...
    </div>
  );
}
```

`createDialKit` returns an accessor — call `params()` to read the current values. Use `createDialKitController` when Solid code needs to update values:

```tsx
import { createDialKitController } from 'dialkit/solid';

const dial = createDialKitController('Card', {
  blur: [24, 0, 100],
  shadow: { radius: [16, 0, 64] },
});

dial.setValues({ blur: 48, shadow: { radius: 28 } });
dial.resetValues();
dial.values().blur;
```

### Svelte

DialKit works with Svelte 5 (≥5.8.0). Import from `dialkit/svelte` — no extra dependencies needed, and styles are injected automatically by `DialRoot` (no CSS import).

```bash
npm install dialkit
```

```svelte
<!-- +layout.svelte -->
<script>
  import { DialRoot } from 'dialkit/svelte';
  let { children } = $props();
</script>

{@render children()}
<DialRoot />
```

```svelte
<!-- Card.svelte -->
<script>
  import { createDialKit } from 'dialkit/svelte';

  const params = createDialKit('Card', {
    blur: [24, 0, 100],
    scale: 1.2,
    color: '#ff5500',
    visible: true
  });
</script>

<div style:filter={`blur(${params.blur}px)`} style:color={params.color}>
  ...
</div>
```

`createDialKit` returns a reactive object — access values directly (e.g. `params.blur`). Cleanup is automatic on unmount. Use `createDialKitController` when Svelte code needs to update values:

```svelte
<script>
  import { createDialKitController } from 'dialkit/svelte';

  const dial = createDialKitController('Card', {
    blur: [24, 0, 100],
    shadow: { radius: [16, 0, 64] }
  });

  const params = dial.values;
</script>

<button onclick={() => dial.setValues({ blur: 48, shadow: { radius: 28 } })}>
  Apply preset
</button>

<div style:filter={`blur(${params.blur}px)`} style:border-radius={`${params.shadow.radius}px`}>
  ...
</div>
```

### Vue

DialKit works with Vue 3 (≥3.3.0). Import from `dialkit/vue`.

```bash
npm install dialkit motion-v vue
```

```ts
// main.ts
import { createApp } from 'vue';
import 'dialkit/styles.css';
import App from './App.vue';

const app = createApp(App);
app.mount('#app');
```

```vue
<!-- App.vue -->
<script setup>
import { DialRoot } from 'dialkit/vue';
import Card from './Card.vue';
</script>

<template>
  <Card />
  <DialRoot @open-change="(open) => localStorage.setItem('dialkit-open', open ? '1' : '0')" />
</template>
```

```vue
<!-- Card.vue -->
<script setup>
import { useDialKit } from 'dialkit/vue';

const params = useDialKit('Card', {
  blur: [24, 0, 100],
  scale: 1.2,
  color: '#ff5500',
  visible: true,
});
</script>

<template>
  <div :style="{
    filter: `blur(${params.blur}px)`,
    transform: `scale(${params.scale})`,
    color: params.color,
    opacity: params.visible ? 1 : 0,
  }">
    ...
  </div>
</template>
```

`useDialKit` returns a reactive object. Use `useDialKitController` when Vue code needs to update values:

```vue
<script setup>
import { useDialKitController } from 'dialkit/vue';

const { values, setValues, resetValues } = useDialKitController('Card', {
  blur: [24, 0, 100],
  shadow: { radius: [16, 0, 64] },
});
</script>

<template>
  <button @click="setValues({ blur: 48, shadow: { radius: 28 } })">Apply preset</button>
  <button @click="resetValues()">Reset</button>
  <div :style="{ filter: `blur(${values.blur}px)`, borderRadius: `${values.shadow.radius}px` }" />
</template>
```

---

## Types

All config and value types are exported:

```tsx
import type {
  SpringConfig,
  EasingConfig,
  TransitionConfig,
  ActionConfig,
  SelectConfig,
  ColorConfig,
  TextConfig,
  ShortcutConfig,
  ShortcutMode,
  DialConfig,
  DialValue,
  DialKitController,
  DialKitValueUpdates,
  ResolvedValues,
  ControlMeta,
  PanelConfig,
  Preset,
} from 'dialkit';
```

Return values are fully typed: `params.blur` infers as `number`, `params.color` as `string`, `params.spring` as `SpringConfig`, `params.shadow` as a nested object, etc.

---

## Contributing

- **Open an issue first.** All pull requests should reference an existing issue. PRs without a corresponding issue will be closed.
- **Keep PRs small and focused.** Each pull request should address a single change — one bug fix, one feature, or one refactor. Avoid bundling unrelated changes together.
- **No unnecessary dependencies.** If your change can be accomplished without adding a new dependency, it should be. Any new dependency needs justification in the PR description.

---

## License

MIT
