// ═══════════════════════════════════════════════════════════════════
// STEP CONTROLS — Stepped Zoom & Time Track UI
// Builds the bottom-bar dot tracks for zoom tiers and time speeds.
// Matches the monolithic prototype's visual behavior: clickable
// nodes with connecting fill lines, proportional zoom interpolation,
// and pause button integration.
// ═══════════════════════════════════════════════════════════════════

import { Game, ZOOM_STEPS, TIME_SPEEDS, getActiveTimeSpeeds, type ZoomStep, type TimeSpeed } from '../core/state';
import { Events } from '../core/events';

// ── Step Track Builder ───────────────────────────────────────────
// Generates DOM nodes for a stepped control bar.
// Each step is a clickable dot; connecting lines fill between them.

function buildStepTrack(
  container: HTMLElement,
  steps: { label: string }[],
  onSelect: (index: number) => void,
): void {
  container.innerHTML = '';
  steps.forEach((step, i) => {
    // Connecting line before each node (except first)
    if (i > 0) {
      const line = document.createElement('div');
      line.className = 'step-line';
      line.dataset.idx = String(i);
      line.setAttribute('aria-hidden', 'true');
      container.appendChild(line);
    }

    // Step node
    const node = document.createElement('div');
    node.className = 'step-node';
    node.dataset.idx = String(i);
    node.setAttribute('role', 'button');
    node.setAttribute('tabindex', '0');
    node.setAttribute('aria-label', step.label);
    node.innerHTML = `<span class="step-tip">${step.label}</span>`;

    node.addEventListener('click', () => onSelect(i));
    node.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect(i);
      }
    });

    container.appendChild(node);
  });
}

// ── Discrete Step Track Update ────────────────────────────────────
// Used for time track: highlights active node and fills lines below it.

function updateStepTrack(container: HTMLElement, activeIndex: number): void {
  container.querySelectorAll<HTMLElement>('.step-node').forEach((n) => {
    const i = parseInt(n.dataset.idx!, 10);
    n.classList.toggle('active-node', i === activeIndex);
    n.classList.toggle('filled', i < activeIndex);
  });
  container.querySelectorAll<HTMLElement>('.step-line').forEach((l) => {
    const i = parseInt(l.dataset.idx!, 10);
    l.classList.toggle('filled', i <= activeIndex);
    l.classList.remove('partial');
    l.style.removeProperty('--fill');
  });
}

// ── Continuous Zoom Bar Update ───────────────────────────────────
// Fills segments proportionally between step nodes based on
// the continuous zoom value (0.0–1.0).

function updateZoomBar(z: number): void {
  const steps = ZOOM_STEPS;
  const track = document.getElementById('zoom-track');
  if (!track) return;

  // Find which segment we're in
  let seg = -1;
  let frac = 0;
  for (let i = 0; i < steps.length - 1; i++) {
    if (z <= steps[i + 1].val) {
      seg = i;
      frac = Math.max(0, Math.min(1,
        (z - steps[i].val) / (steps[i + 1].val - steps[i].val),
      ));
      break;
    }
  }
  if (seg === -1) { seg = steps.length - 2; frac = 1; }

  track.querySelectorAll<HTMLElement>('.step-node').forEach((n) => {
    const i = parseInt(n.dataset.idx!, 10);
    n.classList.toggle('active-node', i === seg || (i === seg + 1 && frac > 0.95));
    n.classList.toggle('filled', i <= seg);
  });

  track.querySelectorAll<HTMLElement>('.step-line').forEach((l) => {
    const i = parseInt(l.dataset.idx!, 10);
    l.classList.remove('filled', 'partial');
    l.style.removeProperty('--fill');
    if (i <= seg) {
      l.classList.add('filled');
    } else if (i === seg + 1) {
      l.classList.add('partial');
      l.style.setProperty('--fill', (frac * 100).toFixed(1) + '%');
    }
  });
}

// ── Pause / Time UI Sync ─────────────────────────────────────────

function syncTimeUI(index: number): void {
  const pauseBtn = document.getElementById('pause-btn');
  const overlay = document.getElementById('pause-overlay');
  const reason = document.getElementById('pause-reason');
  const timeTrack = document.getElementById('time-track');

  if (pauseBtn) pauseBtn.classList.toggle('active', index === 0);

  if (index === 0) {
    // Paused — clear time track, show overlay
    overlay?.classList.add('active');
    if (reason) reason.textContent = 'MANUAL PAUSE';
    timeTrack?.querySelectorAll('.step-node,.step-line').forEach((n) => {
      n.classList.remove('active-node', 'filled');
    });
  } else {
    // Running — update time track, hide overlay
    overlay?.classList.remove('active');
    if (timeTrack) updateStepTrack(timeTrack, index - 1);
  }
}

// ── Initialize ───────────────────────────────────────────────────
// Call once after DOM is ready. Builds both tracks and subscribes
// to state events for ongoing sync.

export function initStepControls(): void {
  const zoomTrack = document.getElementById('zoom-track');
  const timeTrack = document.getElementById('time-track');
  const pauseBtn = document.getElementById('pause-btn');

  if (!zoomTrack || !timeTrack) {
    console.warn('[StepControls] Missing track elements');
    return;
  }

  // Build zoom track — clicking snaps targetZoom to step value
  buildStepTrack(zoomTrack, ZOOM_STEPS, (i) => {
    Game.data.targetZoom = ZOOM_STEPS[i].val;
  });

  // Build time track from active speed table
  function rebuildTimeTrack(): void {
    const speeds = getActiveTimeSpeeds();
    const timeSteps = speeds.slice(1); // exclude PAUSED entry
    buildStepTrack(timeTrack!, timeSteps, (i) => {
      Game.setTimeSpeed(i + 1);
    });
    syncTimeUI(Game.data.timeSpeedIndex);
  }

  rebuildTimeTrack();

  // Pause button
  if (pauseBtn) {
    pauseBtn.addEventListener('click', () => Game.togglePause());
  }

  // Subscribe to time speed changes
  Events.on('ui:time-speed-changed', ({ index }) => {
    syncTimeUI(index as number);
  });

  // Rebuild time track when zoom domain changes (galactic ↔ non-galactic)
  let lastDomain = Game.data.zoomDomain;
  Events.on('camera:zoom-changed', ({ domain }) => {
    const wasGalactic = lastDomain === 'galaxy';
    const isGalactic = (domain as string) === 'galaxy';
    if (wasGalactic !== isGalactic) {
      rebuildTimeTrack();
    }
    lastDomain = domain as typeof lastDomain;
  });

  // Set initial state
  syncTimeUI(Game.data.timeSpeedIndex);
}

// ── Per-Frame Update ─────────────────────────────────────────────
// Called each frame to keep zoom bar in sync with interpolated zoom.

export function updateStepControlsFrame(): void {
  updateZoomBar(Game.data.zoomLevel);
}
