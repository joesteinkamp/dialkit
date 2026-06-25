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
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'icon-btn';
  toggleBtn.title = 'Toggle controls';
  toggleBtn.textContent = '⚙';
  const removeBtn = document.createElement('button');
  removeBtn.className = 'icon-btn';
  removeBtn.title = 'Remove';
  removeBtn.textContent = '✕';
  head.append(labelEl, badge, toggleBtn, removeBtn);

  const frameBox = document.createElement('div');
  frameBox.className = 'tile-frame';
  frameBox.appendChild(spinnerOverlay('Building…'));

  const controls = document.createElement('div');
  controls.className = 'tile-controls collapsed'; // start collapsed for a clean zoomed-out board
  toggleBtn.addEventListener('click', () => controls.classList.toggle('collapsed'));

  tile.append(head, frameBox, controls);
  grid.appendChild(tile);

  const record = { ref, tile, frame: null };
  tiles.push(record);
  updateGridMeta();

  removeBtn.addEventListener('click', () => {
    record.frame?.destroy();
    tile.remove();
    tiles.splice(tiles.indexOf(record), 1);
    updateGridMeta();
  });

  try {
    await ensureBuilt(ref);
    const frame = new StudioFrame(ref, {
      onPanels: () => renderControls(controls, frame),
      onBridge: (ok) => {
        if (!ok) {
          badge.classList.add('nobridge');
          badge.textContent += ' · no bridge';
          renderControls(controls, frame);
        }
      },
    });
    record.frame = frame;
    frameBox.innerHTML = '';
    frameBox.appendChild(frame.mount());
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
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.view === view));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('is-active', v.dataset.view === view));
  document.getElementById('hint').textContent =
    view === 'history' ? 'Rebuilt from git history — pick a commit to run it.'
      : 'Each tile runs independently. Tune dials per tile.';
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
