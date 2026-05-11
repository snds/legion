// ═══════════════════════════════════════════════════════════════════
// EVENT BUS — Type-Safe Publish/Subscribe
// Central nervous system connecting all game systems without
// creating hard dependencies between modules.
//
// Usage:
//   Events.on('sim:threat-detected', handler);
//   Events.emit('sim:threat-detected', { type: 'Others', ... });
//   Events.off('sim:threat-detected', handler);
//
// All event types are declared in the EventMap interface so
// TypeScript enforces correct payloads at compile time.
// ═══════════════════════════════════════════════════════════════════

// ── Event Payload Types ──────────────────────────────────────────

export interface EventMap {
  // Simulation events
  'sim:tick':               { dt: number; gameTime: number; tc: number };
  'sim:threat-detected':    { type: string; position: { x: number; y: number; z: number }; severity: number };
  'sim:system-explored':    { systemEid: number; bobEid: number };
  'sim:bob-replicated':     { parentEid: number; childEid: number; generation: number };
  'sim:transit-started':    { bobEid: number; fromEid: number; toEid: number; years: number };
  'sim:transit-complete':   { bobEid: number; systemEid: number };
  'sim:combat-started':     { locationEid: number; participants: number[] };
  'sim:combat-ended':       { locationEid: number; winner: 'bob' | 'alien' | 'draw' };

  // AI events
  'ai:goal-changed':        { bobEid: number; from: string; to: string };
  'ai:action-started':      { bobEid: number; action: string };
  'ai:action-completed':    { bobEid: number; action: string; success: boolean };

  // Camera/view events
  'camera:zoom-changed':    { level: number; domain: string; distance: number };
  'camera:focus-changed':   { targetEid: number | null };
  'camera:focus-on':        { x: number; y: number; z: number };
  'camera:focus-object':    { obj: import('three').Object3D };
  'camera:focus-bob':       Record<string, never>;

  // Selection events
  'select:entity':          { eid: number; type: number };
  'select:clear':           Record<string, never>;

  // UI events
  'ui:notification':        { title: string; desc: string; color?: string; duration?: number };
  'ui:panel-update':        { panel: 'primary' | 'secondary'; data: Record<string, unknown> };
  'ui:time-speed-changed':  { index: number; label: string; tc: number };

  // Persistence events
  'save:started':           { slot: string };
  'save:completed':         { slot: string; sizeBytes: number; durationMs: number };
  'save:failed':            { slot: string; error: string };
  'load:started':           { slot: string };
  'load:completed':         { slot: string };

  // Audio events
  'audio:play-sfx':         { id: string; position?: { x: number; y: number; z: number } };
  'audio:set-music-state':  { state: string };
  'audio:set-ambience':     { layer: string; volume: number };

  // Network events (future)
  'net:connected':          { roomId: string };
  'net:disconnected':       { reason: string };
  'net:state-sync':         { tick: number };
}

// ── Event Bus Implementation ─────────────────────────────────────

type Handler<T> = (payload: T) => void;

class EventBus {
  private listeners = new Map<string, Set<Handler<unknown>>>();
  private onceWrappers = new WeakMap<Handler<unknown>, Handler<unknown>>();

  /**
   * Subscribe to an event. Returns an unsubscribe function.
   */
  on<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): () => void {
    const set = this.listeners.get(event as string) ?? new Set();
    set.add(handler as Handler<unknown>);
    this.listeners.set(event as string, set);
    return () => this.off(event, handler);
  }

  /**
   * Subscribe to an event once. Auto-unsubscribes after first call.
   */
  once<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): () => void {
    const wrapper: Handler<EventMap[K]> = (payload) => {
      this.off(event, wrapper);
      handler(payload);
    };
    this.onceWrappers.set(handler as Handler<unknown>, wrapper as Handler<unknown>);
    return this.on(event, wrapper);
  }

  /**
   * Unsubscribe from an event.
   */
  off<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): void {
    const set = this.listeners.get(event as string);
    if (!set) return;
    set.delete(handler as Handler<unknown>);
    // Also check if this was wrapped by once()
    const wrapper = this.onceWrappers.get(handler as Handler<unknown>);
    if (wrapper) {
      set.delete(wrapper);
      this.onceWrappers.delete(handler as Handler<unknown>);
    }
  }

  /**
   * Emit an event to all subscribers.
   */
  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    const set = this.listeners.get(event as string);
    if (!set || set.size === 0) return;
    for (const handler of set) {
      try {
        handler(payload);
      } catch (err) {
        console.error(`[EventBus] Error in handler for '${event as string}':`, err);
      }
    }
  }

  /**
   * Remove all listeners (useful for cleanup/testing).
   */
  clear(): void {
    this.listeners.clear();
  }

  /**
   * Debug: list all registered events and listener counts.
   */
  debug(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [event, set] of this.listeners) {
      if (set.size > 0) result[event] = set.size;
    }
    return result;
  }
}

// Singleton — all modules import the same instance
export const Events = new EventBus();
