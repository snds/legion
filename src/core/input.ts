// ═══════════════════════════════════════════════════════════════════
// INPUT — Monolithic Prototype Camera Controls
// Both-button drag = orbit rotation, scroll = zoom.
// No WASD, no pan, no pedestal — matches the monolithic prototype.
// Keyboard: P=pause, </>=speed, O/G=overlay, Escape=reset,
// Tab=cycle bobs, 1-6=zoom tiers.
// ═══════════════════════════════════════════════════════════════════

import { Events } from './events';
import { Game, ZOOM_STEPS } from './state';

// ── Constants ──────────────────────────────────────────────────────

const ORBIT_SPEED = 0.005;        // radians per pixel (monolithic: 0.005)
const ZOOM_STEP = 0.012;          // zoom per scroll tick (finer than monolithic default)
const ZOOM_STEP_FINE = 0.003;     // Shift+wheel — surgical adjustments
const ZOOM_STEP_FAST = 0.04;      // Ctrl/Alt+wheel — coarse tier jumps
const PHI_MIN = 0.15;             // prevent flipping over top
const PHI_MAX = Math.PI - 0.15;   // prevent flipping under bottom
const DRAG_THRESHOLD = 4;         // pixels before drag registers

export class InputManager {
  private canvas: HTMLElement;
  private isDragging = false;
  private dragButton = -1;
  private lastMouse = { x: 0, y: 0 };
  private dragStart = { x: 0, y: 0 };

  constructor(canvas: HTMLElement) {
    this.canvas = canvas;
    this._bindEvents();
  }

  // ── Event Binding ──

  private _bindEvents(): void {
    // Keyboard
    window.addEventListener('keydown', (e) => {
      // Skip if user is typing in an input/select
      if ((e.target as HTMLElement).tagName === 'INPUT' ||
          (e.target as HTMLElement).tagName === 'SELECT') return;
      const key = e.key.toLowerCase();
      this._handleKeyAction(key, e);
    });

    // Mouse down — both left (0) and right (2) = orbit
    this.canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.dragButton = e.button;
      this.lastMouse = { x: e.clientX, y: e.clientY };
      this.dragStart = { x: e.clientX, y: e.clientY };
      Game.data.dragMoved = false;
      Game.data.dragButton = e.button;
    });

    // Mouse move — orbit rotation for any button
    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;

      const dx = e.clientX - this.lastMouse.x;
      const dy = e.clientY - this.lastMouse.y;
      this.lastMouse = { x: e.clientX, y: e.clientY };

      const totalDx = e.clientX - this.dragStart.x;
      const totalDy = e.clientY - this.dragStart.y;
      if (Math.abs(totalDx) + Math.abs(totalDy) > DRAG_THRESHOLD) {
        Game.data.dragMoved = true;
      }

      // Both left and right drag = orbit rotation (monolithic behavior)
      if (this.dragButton === 0 || this.dragButton === 2) {
        Game.data.targetTheta -= dx * ORBIT_SPEED;
        Game.data.targetPhi -= dy * ORBIT_SPEED;
        // Clamp phi to prevent camera flipping
        Game.data.targetPhi = Math.max(PHI_MIN, Math.min(PHI_MAX, Game.data.targetPhi));
      }
    });

    // Mouse up
    window.addEventListener('mouseup', () => {
      this.isDragging = false;
      this.dragButton = -1;
      Game.data.dragButton = -1;
    });

    // Scroll wheel — zoom.
    //   plain wheel  → fine (ZOOM_STEP, ~83 ticks across the full range)
    //   Shift+wheel  → ultra-fine (ZOOM_STEP_FINE, ~333 ticks) for surgical framing
    //   Ctrl/Alt+wheel → coarse (ZOOM_STEP_FAST) for fast tier jumps
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const step = e.shiftKey ? ZOOM_STEP_FINE : (e.ctrlKey || e.altKey || e.metaKey) ? ZOOM_STEP_FAST : ZOOM_STEP;
      const delta = e.deltaY > 0 ? step : -step;
      Game.data.targetZoom = Math.max(0, Math.min(1, Game.data.targetZoom + delta));
    }, { passive: false });

    // Context menu prevention
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ── Key Actions ──

  private _handleKeyAction(key: string, e: KeyboardEvent): void {
    switch (key) {
      // Time controls
      case 'p':
        Game.togglePause();
        break;
      case ',':
      case '<':
        Game.slower();
        break;
      case '.':
      case '>':
        Game.faster();
        break;

      // Escape — deselect + reset camera to origin
      case 'escape':
        Game.deselectEntity();
        Game.data.destMode = false;
        Game.data.targetTheta = 0.4;
        Game.data.targetPhi = 1.4;
        break;

      // Tab — cycle through bobs
      case 'tab':
        e.preventDefault();
        Events.emit('camera:focus-bob', {});
        break;

      // Overlays
      case 'o':
      case 'g':
        Game.data.overlayMode = !Game.data.overlayMode;
        Events.emit('ui:notification', {
          title: 'Overlay',
          desc: Game.data.overlayMode ? 'Strategic overlay ON' : 'Strategic overlay OFF',
        });
        break;

      // Direct zoom tier hotkeys
      case '1': Game.data.targetZoom = ZOOM_STEPS[0].val; break;
      case '2': Game.data.targetZoom = ZOOM_STEPS[1].val; break;
      case '3': Game.data.targetZoom = ZOOM_STEPS[2].val; break;
      case '4': Game.data.targetZoom = ZOOM_STEPS[3].val; break;
      case '5': Game.data.targetZoom = ZOOM_STEPS[4].val; break;
      case '6': Game.data.targetZoom = ZOOM_STEPS[5].val; break;
    }
  }

  dispose(): void {
    // Nothing to clean up (no held keys state)
  }
}
