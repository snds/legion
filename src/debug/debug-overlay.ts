// ═══════════════════════════════════════════════════════════════════
// DEBUG OVERLAY — Development Instrumentation
// Toggleable overlay displaying FPS, ECS entity counts, AI state,
// memory usage, and render stats. Press F3 or ` to toggle.
//
// Zero overhead when hidden — all metric collection is gated
// behind the visible flag. Strip from production builds via
// tree-shaking (wrap usage in `if (import.meta.env.DEV)`).
// ═══════════════════════════════════════════════════════════════════

import { Game } from '../core/state';
import { formatGameClock } from '../core/time';
import { Events } from '../core/events';
import { getAIDebugInfo } from '../simulation/ai/ai-manager';
import { getGraphStats } from '../simulation/pathfinding';
import { getActiveFleetCount } from '../simulation/steering';
import type { WebGPURenderer } from 'three/webgpu';

// ── Overlay ──────────────────────────────────────────────────────

class DebugOverlay {
  private container: HTMLElement | null = null;
  private visible = false;
  private frameCount = 0;
  private lastFpsTime = 0;
  private currentFps = 0;
  private frameTimes: number[] = [];
  private renderer: WebGPURenderer | null = null;

  /**
   * Initialize the debug overlay. Attaches keyboard listener.
   */
  init(renderer?: WebGPURenderer): void {
    this.renderer = renderer ?? null;

    this.container = document.createElement('div');
    this.container.id = 'debug-overlay';
    Object.assign(this.container.style, {
      position: 'fixed',
      top: '8px',
      left: '8px',
      zIndex: '10000',
      background: 'rgba(0, 0, 0, 0.85)',
      color: '#88ff88',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: '11px',
      lineHeight: '1.5',
      padding: '10px 14px',
      borderRadius: '4px',
      border: '1px solid #335533',
      pointerEvents: 'none',
      display: 'none',
      whiteSpace: 'pre',
      minWidth: '260px',
    });

    document.body.appendChild(this.container);

    // Toggle with F3 or backtick
    window.addEventListener('keydown', (e) => {
      if (e.key === 'F3' || e.key === '`') {
        e.preventDefault();
        this.toggle();
      }
    });
  }

  toggle(): void {
    this.visible = !this.visible;
    if (this.container) {
      this.container.style.display = this.visible ? 'block' : 'none';
    }
  }

  /**
   * Update the overlay. Call once per frame.
   * No-op when hidden for zero overhead.
   */
  update(dt: number): void {
    if (!this.visible || !this.container) return;

    // FPS calculation
    this.frameCount++;
    this.frameTimes.push(dt * 1000);
    if (this.frameTimes.length > 60) this.frameTimes.shift();

    const now = performance.now();
    if (now - this.lastFpsTime >= 500) {
      this.currentFps = Math.round(this.frameCount / ((now - this.lastFpsTime) / 1000));
      this.frameCount = 0;
      this.lastFpsTime = now;
    }

    // Frame time stats
    const avgMs = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    const maxMs = Math.max(...this.frameTimes);

    // Game state
    const state = Game.data;
    const speed = Game.getTimeSpeed();

    // AI info
    const ai = getAIDebugInfo();
    const graph = getGraphStats();
    const fleets = getActiveFleetCount();

    // Renderer info
    const info = this.renderer?.info;
    const triangles = info?.render?.triangles ?? 0;
    const calls = info?.render?.calls ?? 0;

    // Memory
    const mem = (performance as any).memory;
    const heapUsed = mem ? `${(mem.usedJSHeapSize / 1048576).toFixed(1)}MB` : 'N/A';

    // Build display
    const goalDist = Object.entries(ai.goalDistribution)
      .map(([k, v]) => `  ${k}: ${v}`)
      .join('\n');

    this.container.textContent = [
      `FPS: ${this.currentFps} | Frame: ${avgMs.toFixed(1)}ms (max ${maxMs.toFixed(1)}ms)`,
      `Draw: ${calls} calls, ${(triangles / 1000).toFixed(1)}K tris`,
      `Heap: ${heapUsed}`,
      ``,
      `Time: ${speed.label} (TC ${speed.tc}) | ${formatGameClock(state.gameTime)}`,
      `Zoom: ${state.zoomDomain} (${state.zoomLevel.toFixed(0)}%) dist=${state.camDist.toFixed(0)}`,
      `Selected: ${state.selectedEntity ?? 'none'}`,
      ``,
      `AI Agents: ${ai.totalAgents} | Active: ${ai.activeActions}`,
      goalDist || '  (no agents)',
      `Graph: ${graph.nodes} nodes, ${graph.edges} edges (${graph.blockedEdges} blocked)`,
      `Fleets: ${fleets} active`,
      ``,
      `Events: ${JSON.stringify(Events.debug())}`,
    ].join('\n');
  }

  dispose(): void {
    this.container?.remove();
    this.container = null;
  }
}

// Singleton
export const Debug = new DebugOverlay();
