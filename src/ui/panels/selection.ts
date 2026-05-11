// ═══════════════════════════════════════════════════════════════════
// SELECTION PANELS — Inspector Card (left) + Production Panel (right)
// Context-aware dual panels: stations open production panel, everything
// else opens inspector card. Connection line links panel to object.
// Matches the monolithic SelectionPanels IIFE.
// ═══════════════════════════════════════════════════════════════════

import * as THREE from 'three';
import { Game } from '../../core/state';
import { Notifications } from '../notifications';
import type { TooltipData } from '../tooltip';

// ── Type Icons ───────────────────────────────────────────────────

const TYPE_ICONS: Record<string, string> = {
  star: '✦', planet: '◍', bob: '◇', station: '⬡', comet: '◗',
  moon: '○', gal_system: '✦', system: '✦', phenomenon: '⊕',
  alien: '▵', galaxy: '◔',
};

// ── Buildable Items Per Station Type ─────────────────────────────

const BUILDABLES: Record<string, { name: string; cost: number; icon: string }[]> = {
  'Mining Hub': [
    { name: 'Drone Miner', cost: 120, icon: '▹' },
    { name: 'Cargo Shuttle', cost: 200, icon: '▹' },
    { name: 'Sensor Buoy', cost: 80, icon: '▹' },
    { name: 'Ore Processor', cost: 300, icon: '▹' },
  ],
  'Shipyard': [
    { name: 'Fighter Drone', cost: 180, icon: '▹' },
    { name: 'Patrol Corvette', cost: 450, icon: '▹' },
    { name: 'Torpedo Frigate', cost: 700, icon: '▹' },
    { name: 'Ion Frigate', cost: 700, icon: '▹' },
  ],
  'Space Elevator': [
    { name: 'Cargo Shuttle', cost: 200, icon: '▹' },
    { name: 'Hab Module', cost: 350, icon: '▹' },
    { name: 'Solar Array', cost: 150, icon: '▹' },
  ],
  'Sensor Array': [
    { name: 'Probe', cost: 60, icon: '▹' },
    { name: 'Relay Node', cost: 100, icon: '▹' },
    { name: 'Deep Scanner', cost: 250, icon: '▹' },
  ],
};

// ── Station Schematics ───────────────────────────────────────────

const SCHEMATICS: Record<string, string> = {
  'Mining Hub':      '    ╔══╦══╗\n    ║░░║░░║\n ───╬══╬══╬───\n    ║  ║  ║\n    ╚══╩══╝',
  'Shipyard':        '  ┌─────────────┐\n──┤  ◊  DOCK  ◊  ├──\n  │ ═══════════ │\n──┤  ◊  DOCK  ◊  ├──\n  └─────────────┘',
  'Space Elevator':  '       ╽\n       ║\n   ╔═══╬═══╗\n   ║ ▣ ║ ▣ ║\n   ╚═══╬═══╝\n       ║\n       ╿',
  'Sensor Array':    '      ╱╲\n     ╱  ╲\n ───◎────◎───\n     ╲  ╱\n      ╲╱',
};

// ── DOM References ───────────────────────────────────────────────

let inspEl: HTMLElement | null = null;
let prodEl: HTMLElement | null = null;
let connCanvas: HTMLCanvasElement | null = null;
let connCtx: CanvasRenderingContext2D | null = null;

// ── State ────────────────────────────────────────────────────────

let currentData: TooltipData | null = null;
let activePanel: 'inspector' | 'production' | null = null;
let buildQueue: { name: string; cost: number; progress: number }[] = [];

// ── HTML Helpers ─────────────────────────────────────────────────

function R(k: string, v: string): string {
  return `<div class="p-row"><span>${k}</span><span>${v}</span></div>`;
}

function S(title: string, content: string): string {
  return `<div class="p-section"><div class="p-section-title">${title}</div>${content}</div>`;
}

// ── Panel Lifecycle ──────────────────────────────────────────────

function panelType(d: TooltipData | null): 'production' | 'inspector' {
  return d && d.type === 'station' ? 'production' : 'inspector';
}

function closeInspector(): void {
  if (inspEl) { inspEl.classList.remove('open'); inspEl.innerHTML = ''; }
}

function closeProduction(): void {
  if (prodEl) { prodEl.classList.remove('open'); prodEl.innerHTML = ''; }
}

function close(): void {
  closeInspector();
  closeProduction();
  currentData = null;
  activePanel = null;
  Game.data.selectedData = null;
}

function open(d: TooltipData): void {
  currentData = d;
  Game.data.selectedData = d as Record<string, unknown>;
  const type = panelType(d);
  if (type === 'production') {
    closeInspector();
    renderProduction(d);
    if (prodEl) prodEl.classList.add('open');
    activePanel = 'production';
  } else {
    closeProduction();
    renderInspector(d);
    if (inspEl) inspEl.classList.add('open');
    activePanel = 'inspector';
  }
}

function toggle(): void {
  if (activePanel && currentData) close();
  else if (Game.data.selectedData) open(Game.data.selectedData as TooltipData);
}

// ── Inspector Card ───────────────────────────────────────────────

function renderInspector(d: TooltipData): void {
  if (!inspEl) return;
  const icon = TYPE_ICONS[d.type] || '·';
  const displayName = d.commonName || d.callsign || d.name || '';
  const subtitle = d.type.toUpperCase()
    + (d.focus ? ' · ' + d.focus : '')
    + (d.planetType ? ' · ' + d.planetType : '');

  let h = `<div class="panel-header">`
    + `<div class="panel-title"><span class="sel-icon-shape">${icon}</span>${displayName}</div>`
    + `<div class="panel-subtitle">${subtitle}</div>`
    + `<button class="panel-close" id="insp-close">✕</button>`
    + `</div><div class="panel-body">`;

  if (d.type === 'bob') {
    const hp = d.health ?? 100;
    h += `<div class="sel-health-bar"><div class="sel-health-fill" style="width:${hp}%"></div></div>`;
    h += S('IDENTITY',
      R('DESIG', d.name ?? '—')
      + R('CALLSIGN', '"' + (d.callsign ?? '') + '"')
      + R('GENERATION', d.generation !== undefined ? 'Gen ' + d.generation : '—'));
    h += S('STATUS',
      R('FOCUS', d.focus ?? '—')
      + R('ACTION', d.currentAction ?? 'Idle')
      + R('DRIFT', String(d.driftIndex ?? 0))
      + R('AUTONOMY', (d.autonomyLabel as string) ?? 'Directive'));
  }
  else if (d.type === 'planet') {
    h += S('PROFILE',
      R('SMA', (d.sma ?? 0) + ' AU')
      + R('TEMP', (d.surfaceTemp as string) ?? '—')
      + R('GRAVITY', ((d.gravity as string) ?? '—') + 'g')
      + R('STATUS', `<span class="${
        (d.status === 'Mining' || d.status === 'Harvesting') ? 'status-green'
        : d.status === 'Habitable' ? 'status-yellow' : 'status-red'
      }">${d.status ?? '—'}</span>`));

    if (['Mining', 'Harvesting', 'Habitable'].includes(d.status ?? '')) {
      const res = [
        { n: 'Iron', pct: 38, lv: 'Hi' },
        { n: 'Silicon', pct: 24, lv: 'Med' },
        { n: 'Rare Earth', pct: 8, lv: 'Low' },
      ];
      let rh = '';
      res.forEach(r => {
        rh += `<div class="p-row"><span>${r.n}</span><span>${r.lv}</span></div>`
          + `<div class="p-bar-wrap"><div class="p-bar bar-white" style="width:${r.pct}%"></div></div>`;
      });
      h += S('RESOURCES', rh);
    }
  }

  else if (d.type === 'star') {
    h += S('STAR',
      R('TYPE', d.spectralType ?? '—')
      + R('LUMINOSITY', (d.luminosity as string) ?? '—')
      + R('MASS', (d.mass as string) ?? '—')
      + R('HAB ZONE', (d.habZone as string) ?? '—'));
  }
  else if (d.type === 'comet') {
    const sma = d.sma ?? 0;
    const ecc = d.ecc ?? 0;
    h += S('ORBIT',
      R('SMA', sma + ' AU')
      + R('ECC', ecc.toFixed(3))
      + R('PERIHELION', (sma * (1 - ecc)).toFixed(1) + ' AU')
      + R('APHELION', (sma * (1 + ecc)).toFixed(0) + ' AU'));
  }
  else if (d.type === 'gal_system' || d.type === 'system') {
    h += S('SYSTEM',
      R('TYPE', d.spectralType ?? '—')
      + R('DISTANCE', ((d.distLy ?? 0)).toFixed(1) + ' LY')
      + R('BOBS', String(d.bobCount ?? 0))
      + R('PLANETS', String((d as Record<string, unknown>).planets ?? '?')));
  }
  else {
    h += S('INFO', R('TYPE', d.type) + R('NAME', d.name ?? '—'));
  }

  h += `</div>`;
  inspEl.innerHTML = h;

  const closeBtn = inspEl.querySelector<HTMLElement>('#insp-close');
  if (closeBtn) closeBtn.onclick = () => close();
}

// ── Production Panel ─────────────────────────────────────────────

function renderProduction(d: TooltipData): void {
  if (!prodEl) return;
  const icon = TYPE_ICONS[d.type] || '⬡';
  const stationType = (d.stationType as string) ?? '';
  const items = BUILDABLES[stationType] || [];
  const schematic = SCHEMATICS[stationType] || '  [schematic]';

  let h = `<div class="panel-header">`
    + `<div class="panel-title"><span class="sel-icon-shape">${icon}</span>${d.name ?? ''}</div>`
    + `<div class="panel-subtitle">${stationType} · ${d.status ?? ''}</div>`
    + `<button class="panel-close" id="prod-close">✕</button>`
    + `</div><div class="panel-body">`;

  // Schematic
  h += `<div class="sel-schematic"><pre>${schematic}</pre></div>`;

  // Modules
  const mods: string[] = (d.modules as string[]) || [];
  const maxMods = mods.length + 1;
  h += `<div class="p-section"><div class="p-section-title">MODULES ${mods.length} / ${maxMods}</div>`;
  mods.forEach(m => {
    h += `<div class="sel-modules-row"><span>▪ ${m}</span><span class="mod-status">Online</span></div>`;
  });
  h += `<div class="sel-modules-row"><span>▪ ────────</span><span class="mod-empty">Empty</span></div></div>`;

  // Build queue
  h += `<div class="p-section"><div class="p-section-title">BUILD QUEUE</div>`;
  if (buildQueue.length === 0) {
    h += `<div style="font-size:9px;color:var(--ui-text-dim);text-transform:uppercase;letter-spacing:0.5px;padding:4px 0">Empty</div>`;
  } else {
    buildQueue.forEach((q, i) => {
      h += `<div class="sel-queue-item">`
        + `<div class="sel-queue-progress"><div class="sel-queue-fill" style="width:${q.progress}%"></div></div>`
        + `<span>${q.name}</span><span class="sel-build-cost">${q.cost}</span>`
        + `<button class="sel-queue-cancel" data-qi="${i}">✕</button></div>`;
    });
  }
  h += `</div>`;

  // Available builds
  h += `<div class="p-section"><div class="p-section-title">AVAILABLE</div>`;
  items.forEach((item, i) => {
    h += `<div class="sel-build-item" data-bi="${i}"><span>${item.icon} ${item.name}</span><span class="sel-build-cost">${item.cost}</span></div>`;
  });
  h += `</div>`;

  // Capacity bar
  const cap = (d.capacity as number) || 0;
  h += `<div class="p-section"><div class="p-section-title">CAPACITY</div>`;
  h += `<div class="p-bar-wrap"><div class="p-bar bar-white" style="width:${cap}%"></div></div>`;
  h += R('UTILIZATION', cap + '%');
  h += `</div>`;

  h += `</div>`;
  prodEl.innerHTML = h;

  // Wire close
  const closeBtn = prodEl.querySelector<HTMLElement>('#prod-close');
  if (closeBtn) closeBtn.onclick = () => close();

  // Wire build item clicks
  prodEl.querySelectorAll<HTMLElement>('.sel-build-item').forEach(el => {
    el.onclick = () => {
      const idx = parseInt(el.dataset.bi ?? '-1', 10);
      const item = items[idx];
      if (!item) return;
      buildQueue.push({ name: item.name, cost: item.cost, progress: 0 });
      renderProduction(d);
    };
  });

  // Wire queue cancel
  prodEl.querySelectorAll<HTMLElement>('.sel-queue-cancel').forEach(el => {
    el.onclick = () => {
      const idx = parseInt(el.dataset.qi ?? '-1', 10);
      buildQueue.splice(idx, 1);
      renderProduction(d);
    };
  });
}

// ── Connection Line ──────────────────────────────────────────────
// Draws a dashed line from the active panel edge to the selected
// object's screen position. Called each frame.

function drawConnection(cam: THREE.Camera): void {
  if (!connCtx || !connCanvas) return;
  connCtx.clearRect(0, 0, connCanvas.width, connCanvas.height);
  if (!activePanel || !currentData || !(currentData as Record<string, unknown>)._meshRef) return;

  const meshRef = (currentData as Record<string, unknown>)._meshRef as THREE.Object3D;
  const wp = new THREE.Vector3();
  if (meshRef.getWorldPosition) meshRef.getWorldPosition(wp);
  else wp.copy(meshRef.position);

  // Project to screen
  const proj = wp.clone().project(cam as THREE.PerspectiveCamera);
  const sx = (proj.x * 0.5 + 0.5) * connCanvas.width;
  const sy = (-proj.y * 0.5 + 0.5) * connCanvas.height;

  // Don't draw if behind camera
  if (proj.z > 1) return;

  // Panel edge point
  let px = 0, py = 0;
  if (activePanel === 'inspector' && inspEl) {
    const rect = inspEl.getBoundingClientRect();
    px = rect.right; py = rect.top + rect.height / 2;
  } else if (prodEl) {
    const rect = prodEl.getBoundingClientRect();
    px = rect.left; py = rect.top + rect.height / 2;
  }

  connCtx.save();
  connCtx.strokeStyle = 'rgba(255,255,255,0.25)';
  connCtx.lineWidth = 1;
  connCtx.setLineDash([6, 4]);
  connCtx.beginPath();
  connCtx.moveTo(px, py);
  connCtx.lineTo(sx, sy);
  connCtx.stroke();

  // Small dot at object end
  connCtx.fillStyle = 'rgba(255,255,255,0.4)';
  connCtx.beginPath();
  connCtx.arc(sx, sy, 3, 0, Math.PI * 2);
  connCtx.fill();
  connCtx.restore();
}

// ── Queue Tick ───────────────────────────────────────────────────

function tickQueue(dt: number): void {
  if (buildQueue.length === 0) return;
  buildQueue.forEach(q => { q.progress = Math.min(100, q.progress + dt * 5); });
  const done = buildQueue.filter(q => q.progress >= 100);
  done.forEach(q => {
    Notifications.push('Build Complete', q.name + ' ready at ' + (currentData ? currentData.name : 'station'));
  });
  buildQueue = buildQueue.filter(q => q.progress < 100);
  if (done.length > 0 && activePanel === 'production' && currentData) {
    renderProduction(currentData);
  }
}

// ── Resize ───────────────────────────────────────────────────────

function resizeConnCanvas(): void {
  if (!connCanvas) return;
  connCanvas.width = window.innerWidth;
  connCanvas.height = window.innerHeight;
}

// ── Public API ───────────────────────────────────────────────────

export const SelectionPanels = {
  init(): void {
    inspEl = document.getElementById('inspector-card');
    prodEl = document.getElementById('production-panel');
    connCanvas = document.getElementById('connection-canvas') as HTMLCanvasElement | null;
    if (connCanvas) connCtx = connCanvas.getContext('2d');
    resizeConnCanvas();
    window.addEventListener('resize', resizeConnCanvas);
  },

  open,
  close,
  toggle,

  isOpen(): boolean { return activePanel !== null; },
  getData(): TooltipData | null { return currentData; },
  drawConnection,
  tickQueue,
};
