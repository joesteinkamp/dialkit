// DialKit Studio shell — the parent side of the bridge protocol.
//
// Talks to each embedded prototype (history preview or grid tile) over
// postMessage: handshake, then receives panel-sync/value-sync and pushes
// value-push. Versions whose dialkit predates the bridge never send `ready`;
// they still run, with their own in-iframe controls ("no bridge" fallback).

const ORIGIN = location.origin;
const READY_TIMEOUT = 6000;

// --- API ---------------------------------------------------------------------

async function fetchHistory() {
  const r = await fetch('/api/history');
  return r.json();
}

async function ensureBuilt(ref, onStatus) {
  await fetch('/api/build', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ref }),
  });
  for (;;) {
    const r = await fetch(`/api/status?ref=${encodeURIComponent(ref)}`);
    const s = await r.json();
    onStatus?.(s);
    if (s.status === 'ready') return s;
    if (s.status === 'error') throw new Error(s.error || 'build failed');
    await new Promise((res) => setTimeout(res, 700));
  }
}

// --- Bridge parent wrapper ---------------------------------------------------

class StudioFrame {
  constructor(ref, { onPanels, onBridge } = {}) {
    this.ref = ref;
    this.onPanels = onPanels;
    this.onBridge = onBridge;
    this.panels = [];
    this.hasBridge = false;
    this.iframe = document.createElement('iframe');
    this.iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-popups');
    this._onMessage = this._onMessage.bind(this);
    window.addEventListener('message', this._onMessage);
    this.iframe.addEventListener('load', () => this._handshake());
  }

  mount() {
    this.iframe.src = `/v/${encodeURIComponent(this.ref)}/`;
    return this.iframe;
  }

  _handshake() {
    try {
      this.iframe.contentWindow?.postMessage(
        { dk: 'studio', v: 1, type: 'handshake', studioOrigin: ORIGIN },
        ORIGIN
      );
    } catch {
      /* cross-origin or gone */
    }
    clearTimeout(this._readyTimer);
    this._readyTimer = setTimeout(() => {
      if (!this.hasBridge) this.onBridge?.(false);
    }, READY_TIMEOUT);
  }

  _onMessage(event) {
    if (event.source !== this.iframe.contentWindow) return;
    const d = event.data;
    if (!d || d.dk !== 'studio') return;
    switch (d.type) {
      case 'ready':
        this.hasBridge = true;
        clearTimeout(this._readyTimer);
        this.onBridge?.(true);
        break;
      case 'panel-sync':
        this.panels = d.panels || [];
        this.onPanels?.(this.panels);
        break;
      case 'value-sync': {
        const panel = this.panels.find((p) => p.id === d.panelId);
        if (panel) panel.values = { ...panel.values, ...d.values };
        break;
      }
      case 'error':
        console.warn(`[${this.ref}] prototype error:`, d.message);
        break;
    }
  }

  push(panelId, path, value) {
    this.iframe.contentWindow?.postMessage(
      { dk: 'studio', v: 1, type: 'value-push', panelId, values: { [path]: value } },
      ORIGIN
    );
  }

  setActive(active) {
    this.iframe.contentWindow?.postMessage(
      { dk: 'studio', v: 1, type: 'set-active', active: !!active },
      ORIGIN
    );
  }

  destroy() {
    window.removeEventListener('message', this._onMessage);
    clearTimeout(this._readyTimer);
    this.iframe.remove();
  }
}

// --- Generic control rendering ----------------------------------------------

function leafControls(controls, out = []) {
  for (const c of controls || []) {
    if (c.type === 'folder') leafControls(c.children, out);
    else out.push(c);
  }
  return out;
}

function renderControls(container, frame) {
  container.innerHTML = '';
  if (!frame.hasBridge) {
    const o = document.createElement('div');
    o.className = 'group-title';
    o.textContent = 'No bridge — using in-iframe controls';
    container.appendChild(o);
    return;
  }
  for (const panel of frame.panels) {
    const title = document.createElement('div');
    title.className = 'group-title';
    title.textContent = panel.name;
    container.appendChild(title);
    for (const c of leafControls(panel.controls)) {
      const el = renderControl(panel, c, frame);
      if (el) container.appendChild(el);
    }
  }
}

function renderControl(panel, c, frame) {
  const val = panel.values?.[c.path];
  const wrap = document.createElement('div');
  wrap.className = 'ctl';
  const row = document.createElement('div');
  row.className = 'ctl-row';
  const label = document.createElement('span');
  label.className = 'ctl-label';
  label.textContent = c.label || c.path;

  if (c.type === 'slider') {
    const valEl = document.createElement('span');
    valEl.className = 'ctl-val';
    valEl.textContent = String(val ?? '');
    row.append(label, valEl);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = c.min ?? 0;
    input.max = c.max ?? 100;
    input.step = c.step ?? 1;
    input.value = val ?? c.min ?? 0;
    input.addEventListener('input', () => {
      const v = Number(input.value);
      valEl.textContent = String(v);
      frame.push(panel.id, c.path, v);
    });
    wrap.append(row, input);
    return wrap;
  }
  if (c.type === 'toggle') {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!val;
    input.addEventListener('change', () => frame.push(panel.id, c.path, input.checked));
    row.append(label, input);
    wrap.append(row);
    return wrap;
  }
  if (c.type === 'color') {
    const input = document.createElement('input');
    input.type = 'color';
    input.value = typeof val === 'string' ? val : '#000000';
    input.addEventListener('input', () => frame.push(panel.id, c.path, input.value));
    row.append(label, input);
    wrap.append(row);
    return wrap;
  }
  if (c.type === 'text') {
    row.append(label);
    const input = document.createElement('input');
    input.type = 'text';
    input.value = typeof val === 'string' ? val : '';
    if (c.placeholder) input.placeholder = c.placeholder;
    input.addEventListener('change', () => frame.push(panel.id, c.path, input.value));
    wrap.append(row, input);
    return wrap;
  }
  if (c.type === 'select') {
    row.append(label);
    const sel = document.createElement('select');
    for (const opt of c.options || []) {
      const o = document.createElement('option');
      const value = typeof opt === 'string' ? opt : opt.value;
      o.value = value;
      o.textContent = typeof opt === 'string' ? opt : opt.label;
      if (value === val) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => frame.push(panel.id, c.path, sel.value));
    wrap.append(row, sel);
    return wrap;
  }
  // spring / transition / action: shown but not editable here.
  const muted = document.createElement('span');
  muted.className = 'ctl-val';
  muted.textContent = c.type;
  row.append(label, muted);
  wrap.append(row);
  return wrap;
}

function spinnerOverlay(text) {
  const o = document.createElement('div');
  o.className = 'overlay';
  o.innerHTML = `<div class="spinner"></div><div>${text}</div>`;
  return o;
}
function errorOverlay(text) {
  const o = document.createElement('div');
  o.className = 'overlay error';
  o.textContent = text;
  return o;
}

// --- History view ------------------------------------------------------------

let history = null;
let activeHistoryFrame = null;

async function loadHistory() {
  history = await fetchHistory();
  const tl = document.getElementById('timeline');
  tl.innerHTML = '';
  const items = [history.current, ...history.commits.map((c) => ({ ...c, ref: c.hash }))];
  for (const item of items) {
    const el = document.createElement('div');
    el.className = 'tl-item';
    el.dataset.ref = item.ref;
    const isCurrent = item.ref === 'current';
    el.innerHTML = isCurrent
      ? `<div class="tl-subject">Current (working tree)</div><div class="tl-meta">live code</div>`
      : `<div class="tl-subject">${escapeHtml(item.subject)}</div>
         <div class="tl-meta"><span class="tl-hash">${item.shortHash}</span> · ${escapeHtml(item.author)} · ${fmtDate(item.date)}</div>`;
    el.addEventListener('click', () => selectVersion(item.ref, isCurrent ? 'Current (working tree)' : item.subject, el));
    tl.appendChild(el);
  }
}

async function selectVersion(ref, label, itemEl) {
  document.querySelectorAll('.tl-item').forEach((n) => n.classList.toggle('is-active', n === itemEl));
  document.getElementById('history-title').textContent = label;
  const statusEl = document.getElementById('history-status');
  const wrap = document.getElementById('history-frame-wrap');
  const controls = document.getElementById('history-controls');
  controls.innerHTML = '';
  wrap.innerHTML = '';
  const overlay = spinnerOverlay('Building…');
  wrap.appendChild(overlay);

  const setStatus = (s) => {
    statusEl.className = `status ${s.status}`;
    statusEl.textContent = s.status === 'building' ? 'Building…' : s.status;
    if (s.status === 'building') overlay.querySelector('div:last-child').textContent = 'Rebuilding this version…';
  };

  try {
    activeHistoryFrame?.destroy();
    await ensureBuilt(ref, setStatus);
    const frame = new StudioFrame(ref, {
      onPanels: () => renderControls(controls, frame),
      onBridge: (ok) => {
        statusEl.className = `status ${ok ? 'ready' : 'error'}`;
        statusEl.textContent = ok ? 'ready' : 'ready (no bridge)';
        if (!ok) renderControls(controls, frame);
      },
    });
    activeHistoryFrame = frame;
    wrap.innerHTML = '';
    wrap.appendChild(frame.mount());
  } catch (err) {
    statusEl.className = 'status error';
    statusEl.textContent = 'error';
    wrap.innerHTML = '';
    wrap.appendChild(errorOverlay(String(err.message || err)));
  }
}

// --- Grid view ---------------------------------------------------------------

const tiles = [];

function updateGridMeta() {
  const meta = document.getElementById('grid-meta');
  const n = tiles.length;
  meta.textContent = n === 0 ? 'No variants yet — add one to compare dialed versions side by side.'
    : `${n} variant${n === 1 ? '' : 's'}${n > 9 ? ' — many live iframes may be heavy' : ''}`;
}

// --- Grid zoom (focus one variant, easily pop back out) ----------------------
//
// Zoom never re-parents an iframe (that would reload the prototype and lose its
// live state). It promotes the existing .tile to a fixed-position stage in place
// via a CSS class, animated by the View Transitions API (graceful no-morph
// fallback when unsupported). Unfocused tiles are paused via set-active.

let zoomedIndex = -1;
let zoomEls = null;

function withViewTransition(fn) {
  if (document.startViewTransition) {
    try { return document.startViewTransition(fn); } catch { /* fall through */ }
  }
  fn();
  return null;
}

function zoomIconBtn(label, title, onClick) {
  const b = document.createElement('button');
  b.className = 'icon-btn';
  b.title = title;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function ensureZoomChrome() {
  if (zoomEls) return zoomEls;
  const view = document.querySelector('.view[data-view="grid"]');

  const backdrop = document.createElement('div');
  backdrop.className = 'zoom-backdrop';
  backdrop.addEventListener('click', popOut);

  const bar = document.createElement('div');
  bar.className = 'zoom-bar';
  const prev = zoomIconBtn('‹', 'Previous variant (←)', () => traverse(-1));
  const indexLabel = document.createElement('span');
  indexLabel.className = 'zoom-index';
  const next = zoomIconBtn('›', 'Next variant (→)', () => traverse(1));
  const dialsBtn = zoomIconBtn('⚙', 'Toggle dials', toggleZoomDials);
  const close = zoomIconBtn('✕', 'Close (Esc)', popOut);
  bar.append(prev, indexLabel, next, dialsBtn, close);

  const dials = document.createElement('div');
  dials.className = 'zoom-dials collapsed';

  view.append(backdrop, bar, dials);
  zoomEls = { backdrop, bar, dials, indexLabel };
  return zoomEls;
}

function insertPlaceholder(record) {
  if (record.placeholder) return;
  const ph = document.createElement('div');
  ph.className = 'tile-placeholder';
  ph.style.minHeight = `${record.tile.getBoundingClientRect().height}px`;
  record.tile.parentNode.insertBefore(ph, record.tile);
  record.placeholder = ph;
}

function removePlaceholder(record) {
  record.placeholder?.remove();
  record.placeholder = null;
}

function zoomInto(index) {
  if (index < 0 || index >= tiles.length || index === zoomedIndex) return;
  ensureZoomChrome();
  const prevIndex = zoomedIndex;
  const target = tiles[index];
  const prev = prevIndex >= 0 ? tiles[prevIndex] : null;

  // Names assigned in the BEFORE snapshot so the browser morphs geometry: the
  // target grows from its grid slot, the previous one shrinks back to its own.
  target.tile.style.viewTransitionName = 'zt-target';
  if (prev) prev.tile.style.viewTransitionName = 'zt-prev';

  const vt = withViewTransition(() => {
    if (prev) {
      prev.tile.classList.remove('is-zoomed');
      removePlaceholder(prev);
    } else {
      document.getElementById('grid').classList.add('is-zooming');
      zoomEls.backdrop.classList.add('is-visible');
      zoomEls.bar.classList.add('is-visible');
    }
    insertPlaceholder(target);
    target.tile.classList.add('is-zoomed');
  });

  const clearNames = () => {
    target.tile.style.viewTransitionName = '';
    if (prev) prev.tile.style.viewTransitionName = '';
  };
  if (vt?.finished) vt.finished.finally(clearNames); else clearNames();

  zoomedIndex = index;
  updateZoomChrome();
  tiles.forEach((r, i) => r.frame?.setActive(i === index));
  renderZoomDials();
}

function popOut() {
  if (zoomedIndex < 0) return;
  ensureZoomChrome();
  const record = tiles[zoomedIndex];
  if (record) record.tile.style.viewTransitionName = 'zt-target';

  const vt = withViewTransition(() => {
    if (record) {
      record.tile.classList.remove('is-zoomed');
      removePlaceholder(record);
    }
    document.getElementById('grid').classList.remove('is-zooming');
    zoomEls.backdrop.classList.remove('is-visible');
    zoomEls.bar.classList.remove('is-visible');
    zoomEls.dials.classList.add('collapsed');
  });

  const clearName = () => { if (record) record.tile.style.viewTransitionName = ''; };
  if (vt?.finished) vt.finished.finally(clearName); else clearName();

  zoomedIndex = -1;
  tiles.forEach((r) => r.frame?.setActive(true));
}

// Synchronous teardown (no transition) — used when the zoomed tile is removed
// or the user leaves the Grid tab.
function resetZoom() {
  if (zoomedIndex < 0) return;
  const record = tiles[zoomedIndex];
  if (record) {
    record.tile.classList.remove('is-zoomed');
    record.tile.style.viewTransitionName = '';
    removePlaceholder(record);
  }
  const grid = document.getElementById('grid');
  grid?.classList.remove('is-zooming');
  if (zoomEls) {
    zoomEls.backdrop.classList.remove('is-visible');
    zoomEls.bar.classList.remove('is-visible');
    zoomEls.dials.classList.add('collapsed');
  }
  zoomedIndex = -1;
  tiles.forEach((r) => r.frame?.setActive(true));
}

function traverse(delta) {
  if (zoomedIndex < 0 || tiles.length < 2) return;
  zoomInto((zoomedIndex + delta + tiles.length) % tiles.length);
}

function updateZoomChrome() {
  if (!zoomEls || zoomedIndex < 0) return;
  zoomEls.indexLabel.textContent = `${zoomedIndex + 1} / ${tiles.length}`;
}

function renderZoomDials() {
  if (!zoomEls || zoomedIndex < 0) return;
  const record = tiles[zoomedIndex];
  if (record?.frame) renderControls(zoomEls.dials, record.frame);
  else zoomEls.dials.innerHTML = '';
}

function toggleZoomDials() {
  if (!zoomEls) return;
  renderZoomDials();
  zoomEls.dials.classList.toggle('collapsed');
}

window.addEventListener('keydown', (e) => {
  if (zoomedIndex < 0) return;
  const el = document.activeElement;
  if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
  if (e.key === 'Escape') { e.preventDefault(); popOut(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); traverse(1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); traverse(-1); }
  else if (/^[1-9]$/.test(e.key)) { e.preventDefault(); zoomInto(Number(e.key) - 1); }
});

async function addVariant(ref, label) {
  const grid = document.getElementById('grid');
  const tile = document.createElement('div');
  tile.className = 'tile';

  const head = document.createElement('div');
  head.className = 'tile-head';
  const labelEl = document.createElement('span');
  labelEl.className = 'tile-label';
  labelEl.textContent = label;
  const badge = document.createElement('span');
  badge.className = 'tile-badge';
  badge.textContent = ref === 'current' ? 'current' : ref.slice(0, 7);
  const expandBtn = document.createElement('button');
  expandBtn.className = 'icon-btn';
  expandBtn.title = 'Zoom in';
  expandBtn.textContent = '⤢';
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'icon-btn';
  toggleBtn.title = 'Toggle controls';
  toggleBtn.textContent = '⚙';
  const removeBtn = document.createElement('button');
  removeBtn.className = 'icon-btn';
  removeBtn.title = 'Remove';
  removeBtn.textContent = '✕';
  head.append(labelEl, badge, expandBtn, toggleBtn, removeBtn);

  const frameBox = document.createElement('div');
  frameBox.className = 'tile-frame';
  frameBox.appendChild(spinnerOverlay('Building…'));

  // Transparent catcher over the (non-interactive) grid iframe so a click means
  // "zoom me", not "interact with the prototype". Hidden once zoomed (CSS), so
  // the focused prototype is fully interactive.
  const catcher = document.createElement('div');
  catcher.className = 'tile-clickcatch';
  catcher.title = 'Zoom in';
  catcher.addEventListener('click', () => zoomInto(tiles.indexOf(record)));

  const controls = document.createElement('div');
  controls.className = 'tile-controls collapsed'; // start collapsed for a clean zoomed-out board
  toggleBtn.addEventListener('click', () => controls.classList.toggle('collapsed'));

  tile.append(head, frameBox, controls);
  grid.appendChild(tile);

  const record = { ref, tile, frame: null, controls, placeholder: null };
  tiles.push(record);
  updateGridMeta();

  expandBtn.addEventListener('click', () => zoomInto(tiles.indexOf(record)));

  removeBtn.addEventListener('click', () => {
    const idx = tiles.indexOf(record);
    if (idx === zoomedIndex) resetZoom();
    else if (idx < zoomedIndex) zoomedIndex -= 1;
    record.frame?.destroy();
    removePlaceholder(record);
    tile.remove();
    tiles.splice(idx, 1);
    updateGridMeta();
    if (zoomedIndex >= 0) updateZoomChrome();
  });

  try {
    await ensureBuilt(ref);
    const frame = new StudioFrame(ref, {
      onPanels: () => {
        renderControls(controls, frame);
        if (tiles[zoomedIndex] === record) renderZoomDials();
      },
      onBridge: (ok) => {
        if (!ok) {
          badge.classList.add('nobridge');
          badge.textContent += ' · no bridge';
          renderControls(controls, frame);
          if (tiles[zoomedIndex] === record) renderZoomDials();
        }
      },
    });
    record.frame = frame;
    // The focused tile is active; everything else stays paused while zoomed.
    if (zoomedIndex >= 0) frame.setActive(tiles[zoomedIndex] === record);
    frameBox.innerHTML = '';
    frameBox.appendChild(frame.mount());
    frameBox.appendChild(catcher);
  } catch (err) {
    frameBox.innerHTML = '';
    frameBox.appendChild(errorOverlay(String(err.message || err)));
  }
}

async function openComposer() {
  if (!history) history = await fetchHistory();
  const sel = document.getElementById('composer-base');
  sel.innerHTML = '';
  const opt = (ref, text) => {
    const o = document.createElement('option');
    o.value = ref;
    o.textContent = text;
    sel.appendChild(o);
  };
  opt('current', 'Current (working tree)');
  for (const c of history.commits) opt(c.hash, `${c.shortHash} · ${c.subject}`);
  const dlg = document.getElementById('composer');
  dlg.returnValue = '';
  dlg.showModal();
  dlg.addEventListener(
    'close',
    () => {
      if (dlg.returnValue === 'add') {
        const ref = sel.value;
        const label = sel.options[sel.selectedIndex].textContent;
        addVariant(ref, ref === 'current' ? 'Current' : label);
      }
    },
    { once: true }
  );
}

// --- Tabs + boot -------------------------------------------------------------

function setView(view) {
  if (view !== 'grid' && zoomedIndex >= 0) resetZoom();
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.view === view));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('is-active', v.dataset.view === view));
  document.getElementById('hint').textContent =
    view === 'history' ? 'Rebuilt from git history — pick a commit to run it.'
      : 'Click a tile to zoom in · ← → to compare · Esc to pop out.';
}

document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => setView(t.dataset.view)));
document.getElementById('add-variant').addEventListener('click', openComposer);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtDate(iso) {
  try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
}

setView('history');
loadHistory().catch((err) => {
  document.getElementById('timeline').innerHTML = `<div class="ctl">Failed to load history: ${escapeHtml(String(err.message || err))}</div>`;
});
