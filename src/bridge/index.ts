// DialKit Studio bridge
//
// Connects a prototype running inside an iframe to a DialKit Studio parent
// window over postMessage. The Studio can discover the prototype's panels,
// push dial configurations into it, hide the in-iframe control panel so the
// parent drives values, and mark it active/inactive (set-active) so a
// backgrounded tile can quiesce. Pure TypeScript — no framework dependency — so it works
// across every adapter, talking to the same singleton DialStore the adapter uses.
//
// React hosts should import this from `dialkit` (it is bundled with the React
// build's DialStore instance). Solid/Vue/Svelte hosts import it from
// `dialkit/bridge`, which shares the external `dialkit/store` singleton their
// adapters use. Mixing the two for a given app would yield two stores and the
// bridge would see no panels — always import from the entry your adapter uses.

import { DialStore } from '../store/DialStore';
import type { DialValue, PanelConfig } from '../store/DialStore';

const PROTOCOL_TAG = 'studio' as const;
const PROTOCOL_VERSION = 1 as const;

type Envelope = { dk: typeof PROTOCOL_TAG; v: typeof PROTOCOL_VERSION };

/** Messages the Studio parent sends down to the embedded prototype. */
export type StudioInboundMessage =
  | (Envelope & { type: 'handshake'; studioOrigin: string })
  | (Envelope & { type: 'value-push'; panelId: string; values: Record<string, DialValue> })
  | (Envelope & { type: 'set-panels-hidden'; hidden: boolean })
  | (Envelope & { type: 'set-active'; active: boolean })
  | (Envelope & { type: 'reset'; panelId: string });

/** Messages the embedded prototype sends up to the Studio parent. */
export type StudioOutboundMessage =
  | (Envelope & { type: 'ready'; dialkitVersion: string; hasBridge: true })
  | (Envelope & { type: 'panel-sync'; panels: PanelConfig[] })
  | (Envelope & { type: 'value-sync'; panelId: string; values: Record<string, DialValue> })
  | (Envelope & { type: 'action'; panelId: string; path: string })
  | (Envelope & { type: 'error'; message: string; stack?: string });

export interface ConnectStudioOptions {
  /**
   * Restrict which parent origins may drive this prototype. When omitted, the
   * first handshake from the immediate parent window is trusted and that exact
   * origin is locked in for the rest of the session.
   */
  allowedOrigins?: string[];
  /** Hide the in-iframe DialRoot panel once connected. Default true. */
  hidePanel?: boolean;
}

let embeddedFlag = false;

/** True once this prototype is connected to a DialKit Studio parent. */
export function isDialKitEmbedded(): boolean {
  return embeddedFlag;
}

/**
 * Whether this prototype is the focused/active tile in Studio (true outside
 * Studio). Hosts with an expensive animation loop can gate it on this — or
 * subscribe via `DialStore.subscribeActive` — to pause while backgrounded.
 */
export function isDialKitActive(): boolean {
  return DialStore.isActive();
}

/**
 * Connect this prototype to a DialKit Studio parent, if it is running inside
 * one. Safe to call unconditionally at app startup: it is a no-op when the page
 * is not embedded in an iframe. Returns a disconnect function.
 */
export function connectDialKitStudio(opts: ConnectStudioOptions = {}): () => void {
  const noop = () => {};
  if (typeof window === 'undefined' || window.parent === window) {
    return noop;
  }

  const hidePanel = opts.hidePanel ?? true;
  const { allowedOrigins } = opts;

  let parentOrigin: string | null = null;
  let connected = false;
  let disposed = false;

  const valueUnsubs = new Map<string, () => void>();
  const actionUnsubs = new Map<string, () => void>();
  let globalUnsub: (() => void) | null = null;

  const post = (msg: StudioOutboundMessage): void => {
    if (parentOrigin == null) return;
    try {
      window.parent.postMessage(msg, parentOrigin);
    } catch {
      // Parent gone or origin mismatch — ignore.
    }
  };

  const sendPanelSync = (): void =>
    post({ dk: PROTOCOL_TAG, v: PROTOCOL_VERSION, type: 'panel-sync', panels: DialStore.getPanels() });

  const sendValueSync = (panelId: string): void => {
    // Skip chatter for backgrounded tiles; syncAll() re-converges on re-activation.
    if (!DialStore.isActive()) return;
    post({ dk: PROTOCOL_TAG, v: PROTOCOL_VERSION, type: 'value-sync', panelId, values: { ...DialStore.getValues(panelId) } });
  };

  // Keep per-panel value/action subscriptions in sync with the live panel set.
  const reconcileSubscriptions = (): void => {
    const ids = new Set(DialStore.getPanels().map((p) => p.id));

    for (const [id, unsub] of valueUnsubs) {
      if (!ids.has(id)) { unsub(); valueUnsubs.delete(id); }
    }
    for (const [id, unsub] of actionUnsubs) {
      if (!ids.has(id)) { unsub(); actionUnsubs.delete(id); }
    }

    for (const id of ids) {
      if (!valueUnsubs.has(id)) {
        valueUnsubs.set(id, DialStore.subscribe(id, () => sendValueSync(id)));
      }
      if (!actionUnsubs.has(id)) {
        actionUnsubs.set(id, DialStore.subscribeActions(id, (path) =>
          post({ dk: PROTOCOL_TAG, v: PROTOCOL_VERSION, type: 'action', panelId: id, path })
        ));
      }
    }
  };

  const syncAll = (): void => {
    reconcileSubscriptions();
    sendPanelSync();
    for (const panel of DialStore.getPanels()) sendValueSync(panel.id);
  };

  const onError = (e: ErrorEvent): void => {
    post({ dk: PROTOCOL_TAG, v: PROTOCOL_VERSION, type: 'error', message: String(e.message), stack: e.error?.stack });
  };
  const onRejection = (e: PromiseRejectionEvent): void => {
    const reason = e.reason as { message?: string; stack?: string } | undefined;
    post({ dk: PROTOCOL_TAG, v: PROTOCOL_VERSION, type: 'error', message: String(reason?.message ?? reason ?? 'Unhandled rejection'), stack: reason?.stack });
  };

  const connect = (origin: string): void => {
    if (connected) return;
    connected = true;
    parentOrigin = origin;
    embeddedFlag = true;

    DialStore.setEmbedded(true);
    if (hidePanel) DialStore.setPanelsHidden(true);

    post({ dk: PROTOCOL_TAG, v: PROTOCOL_VERSION, type: 'ready', dialkitVersion: getVersion(), hasBridge: true });

    globalUnsub = DialStore.subscribeGlobal(syncAll);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    syncAll();
  };

  const onMessage = (event: MessageEvent): void => {
    if (disposed) return;
    const data = event.data as Partial<StudioInboundMessage> | undefined;
    if (!data || data.dk !== PROTOCOL_TAG || data.v !== PROTOCOL_VERSION) return;
    // Only ever trust the immediate parent window.
    if (event.source !== window.parent) return;

    if (data.type === 'handshake') {
      const claimed = data.studioOrigin;
      if (typeof claimed === 'string' && claimed !== event.origin) return;
      if (allowedOrigins && !allowedOrigins.includes(event.origin)) return;
      connect(event.origin);
      return;
    }

    // Post-handshake messages must come from the locked-in parent origin.
    if (!connected || event.origin !== parentOrigin) return;

    switch (data.type) {
      case 'value-push':
        if (typeof data.panelId === 'string' && data.values) {
          DialStore.applyExternalValues(data.panelId, data.values);
        }
        break;
      case 'set-panels-hidden':
        if (typeof data.hidden === 'boolean') DialStore.setPanelsHidden(data.hidden);
        break;
      case 'set-active':
        if (typeof data.active === 'boolean') {
          DialStore.setActive(data.active);
          // Re-converge the parent on re-activation: value-sync is suppressed
          // while inactive (below), so push a fresh snapshot when focus returns.
          if (data.active) syncAll();
        }
        break;
      case 'reset':
        if (typeof data.panelId === 'string') DialStore.resetValues(data.panelId);
        break;
    }
  };

  window.addEventListener('message', onMessage);

  return () => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('message', onMessage);
    globalUnsub?.();
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    for (const unsub of valueUnsubs.values()) unsub();
    for (const unsub of actionUnsubs.values()) unsub();
    valueUnsubs.clear();
    actionUnsubs.clear();
    if (connected) {
      DialStore.setPanelsHidden(false);
      DialStore.setEmbedded(false);
      embeddedFlag = false;
    }
  };
}

function getVersion(): string {
  try {
    const v = (globalThis as { __DIALKIT_VERSION__?: string }).__DIALKIT_VERSION__;
    return typeof v === 'string' ? v : 'unknown';
  } catch {
    return 'unknown';
  }
}
