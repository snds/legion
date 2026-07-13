// ═══════════════════════════════════════════════════════════════════
// DEMO MENU — the "🚩 REVIEW BUILDS" selector on the main game UI.
//
// A floating button (bottom-left, mirroring the LAB button bottom-right) that
// opens a list of the shipped subsystems. Picking one sets ?demo=<id> and
// reloads — the boot director (main.ts) then mounts the showcase and flies the
// camera to it (see src/render/demos.ts). When a demo is active, a caption
// banner names what you're looking at and offers "Exit" back to the game.
//
// This module owns ALL demo-menu DOM; the registry (demos.ts) owns the data.
// ═══════════════════════════════════════════════════════════════════

import { DEMOS, activeDemoId, demoById, DEMO_PARAM, type DemoId } from '../render/demos';
import { LABS, activeLabId, labById, LAB_PARAM, type LabId } from './labs';

/** Navigate to a demo (or back to the plain game) by rewriting ?demo= + reloading. */
function go(id: DemoId | null): void {
  const url = new URL(location.href);
  if (id) url.searchParams.set(DEMO_PARAM, id);
  else url.searchParams.delete(DEMO_PARAM);
  url.searchParams.delete(LAB_PARAM); // demo and lab are mutually exclusive
  location.href = url.toString();
}

/** Navigate to a generator lab (clears any demo). */
function goLab(id: LabId): void {
  const url = new URL(location.href);
  url.searchParams.set(LAB_PARAM, id);
  url.searchParams.delete(DEMO_PARAM);
  location.href = url.toString();
}

/** Toggle an independent review-phase flag (coexists with normal play). */
function togglePhase(param: string): void {
  const url = new URL(location.href);
  if (url.searchParams.has(param)) url.searchParams.delete(param);
  else url.searchParams.set(param, '1');
  location.href = url.toString();
}

/** Independent, in-game review-phase toggles (planet v2 rollout). */
const REVIEW_PHASES: readonly { param: string; icon: string; label: string; blurb: string }[] = [
  {
    param: 'scale1to1', icon: '🌍', label: '1:1 Scale + FOV (Phase 0)',
    blurb: 'Telephoto FOV that narrows as you close on a body (the "from orbit" feel). Phase 0b adds true 1:1 planet radius on this same flag.',
  },
];

/** Mount the review-builds button + menu (+ caption when a demo is active). */
export function initDemoMenu(): void {
  if (typeof document === 'undefined' || document.getElementById('demo-menu-btn')) return;

  const active = activeDemoId();
  const lab = labById(activeLabId());
  const anyActive = !!active || !!lab;
  if (active) buildCaption(demoById(active)!.id);

  // ── Menu (hidden until the button is clicked) ──────────────────────
  const menu = document.createElement('div');
  menu.id = 'demo-menu';
  menu.style.cssText = [
    'position:fixed', 'left:16px', 'bottom:56px', 'z-index:9999', 'display:none',
    'width:288px', 'max-height:calc(100vh - 96px)', 'overflow:auto',
    'padding:6px', 'background:rgba(12,15,20,0.96)',
    'border:1px solid #2a3340', 'border-radius:8px', 'color:#cfd8e3',
    'font:12px/1.45 ui-monospace,SFMono-Regular,monospace',
    'box-shadow:0 8px 32px rgba(0,0,0,0.6)',
  ].join(';');

  const heading = document.createElement('div');
  heading.textContent = 'REVIEW BUILDS';
  heading.style.cssText = 'padding:6px 8px 8px;color:#eaf0f7;font-weight:600;letter-spacing:0.08em;'
    + 'border-bottom:1px solid #2a3340;margin-bottom:4px';
  menu.appendChild(heading);

  const rowBase = 'display:block;width:100%;text-align:left;padding:8px 9px;margin:2px 0;'
    + 'background:transparent;border:1px solid transparent;border-radius:6px;color:#cfd8e3;'
    + 'font:inherit;cursor:pointer';

  for (const d of DEMOS) {
    const isActive = d.id === active;
    const item = document.createElement('button');
    item.style.cssText = rowBase + (isActive ? ';background:#1c2b3a;border-color:#3a5a80' : '');
    item.onmouseenter = () => { if (!isActive) item.style.background = '#161d27'; };
    item.onmouseleave = () => { if (!isActive) item.style.background = 'transparent'; };
    item.innerHTML =
      `<span style="color:#eaf0f7">${d.icon} ${d.label}${isActive ? '  <span style="color:#6aa3ff">● live</span>' : ''}</span>`
      + `<span style="display:block;margin-top:3px;opacity:0.6;font-size:10.5px;line-height:1.4">${d.blurb}</span>`
      + `<span style="display:block;margin-top:3px;opacity:0.4;font-size:9.5px;letter-spacing:0.04em">${d.source}</span>`;
    item.onclick = () => go(d.id);
    menu.appendChild(item);
  }

  // ── Generator labs (editable tuning views) ──
  const labHeading = document.createElement('div');
  labHeading.textContent = 'GENERATOR LAB';
  labHeading.style.cssText = 'padding:11px 8px 6px;margin-top:6px;color:#eaf0f7;font-weight:600;'
    + 'letter-spacing:0.08em;border-top:1px solid #2a3340';
  menu.appendChild(labHeading);

  for (const l of LABS) {
    const isActive = lab?.id === l.id;
    const item = document.createElement('button');
    item.disabled = !l.available;
    item.style.cssText = rowBase
      + (isActive ? ';background:#1c2b3a;border-color:#3a5a80' : '')
      + (!l.available ? ';opacity:0.4;cursor:default' : '');
    if (l.available) {
      item.onmouseenter = () => { if (!isActive) item.style.background = '#161d27'; };
      item.onmouseleave = () => { if (!isActive) item.style.background = 'transparent'; };
      item.onclick = () => goLab(l.id);
    }
    item.innerHTML =
      `<span style="color:#eaf0f7">${l.icon} ${l.label}`
      + `${isActive ? '  <span style="color:#6aa3ff">● live</span>' : ''}`
      + `${!l.available ? '  <span style="opacity:0.7">· soon</span>' : ''}</span>`
      + `<span style="display:block;margin-top:3px;opacity:0.6;font-size:10.5px;line-height:1.4">${l.blurb}</span>`;
    menu.appendChild(item);
  }

  // ── Review phases (independent in-game toggles) ──
  const phaseHeading = document.createElement('div');
  phaseHeading.textContent = 'REVIEW PHASES';
  phaseHeading.style.cssText = 'padding:11px 8px 6px;margin-top:6px;color:#eaf0f7;font-weight:600;'
    + 'letter-spacing:0.08em;border-top:1px solid #2a3340';
  menu.appendChild(phaseHeading);

  const params = new URLSearchParams(location.search);
  for (const p of REVIEW_PHASES) {
    const on = params.has(p.param);
    const item = document.createElement('button');
    item.style.cssText = rowBase + (on ? ';background:#1c2b3a;border-color:#3a5a80' : '');
    item.onmouseenter = () => { if (!on) item.style.background = '#161d27'; };
    item.onmouseleave = () => { if (!on) item.style.background = 'transparent'; };
    item.onclick = () => togglePhase(p.param);
    item.innerHTML =
      `<span style="color:#eaf0f7">${p.icon} ${p.label}`
      + `  <span style="color:${on ? '#6aa3ff' : '#7e8a9c'}">${on ? '● ON' : '○ off'}</span></span>`
      + `<span style="display:block;margin-top:3px;opacity:0.6;font-size:10.5px;line-height:1.4">${p.blurb}</span>`;
    menu.appendChild(item);
  }

  if (anyActive) {
    const exit = document.createElement('button');
    exit.style.cssText = rowBase + ';margin-top:6px;border-top:1px solid #2a3340;border-radius:0 0 6px 6px;color:#9fb0c3';
    exit.onmouseenter = () => { exit.style.background = '#161d27'; };
    exit.onmouseleave = () => { exit.style.background = 'transparent'; };
    exit.textContent = '↩  Exit — back to the game';
    exit.onclick = () => go(null);
    menu.appendChild(exit);
  }

  document.body.appendChild(menu);

  // ── Button ─────────────────────────────────────────────────────────
  const btn = document.createElement('button');
  btn.id = 'demo-menu-btn';
  const activeLabel = active ? demoById(active)!.label : lab ? lab.label : null;
  btn.textContent = activeLabel ? `🚩 ${activeLabel}` : '🚩 REVIEW BUILDS';
  btn.title = 'Review the shipped subsystems, or open a generator lab';
  btn.style.cssText = [
    'position:fixed', 'left:16px', 'bottom:16px', 'z-index:9999',
    'font-family:ui-monospace,Menlo,monospace', 'font-size:11px',
    'letter-spacing:1px', 'padding:7px 12px', 'cursor:pointer',
    'max-width:288px', 'overflow:hidden', 'text-overflow:ellipsis', 'white-space:nowrap',
    `background:${anyActive ? 'rgba(20,40,64,0.94)' : 'rgba(8,10,18,0.9)'}`,
    'color:#aab8e8', `border:1px solid ${anyActive ? 'rgba(120,170,255,0.6)' : 'rgba(120,150,220,0.4)'}`,
    'border-radius:6px', 'box-shadow:0 4px 16px rgba(0,0,0,0.5)',
  ].join(';');
  btn.onclick = (e) => {
    e.stopPropagation();
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
  };
  document.body.appendChild(btn);

  // Dismiss the menu on any outside click.
  document.addEventListener('click', (e) => {
    if (menu.style.display !== 'none' && !menu.contains(e.target as Node) && e.target !== btn) {
      menu.style.display = 'none';
    }
  });
}

/** Top-centre caption naming the active demo + what to look for. */
function buildCaption(id: DemoId): void {
  const d = demoById(id);
  if (!d || document.getElementById('demo-caption')) return;

  const cap = document.createElement('div');
  cap.id = 'demo-caption';
  cap.style.cssText = [
    'position:fixed', 'top:96px', 'left:50%', 'transform:translateX(-50%)',
    'z-index:45', 'max-width:min(560px,92vw)', 'text-align:center',
    'padding:8px 16px', 'pointer-events:none',
    'background:rgba(10,13,20,0.72)', 'border:1px solid rgba(120,150,220,0.28)',
    'border-radius:8px', 'color:#cfd8e3',
    'font:12px/1.5 ui-monospace,SFMono-Regular,monospace', 'letter-spacing:0.02em',
    'backdrop-filter:blur(4px)', '-webkit-backdrop-filter:blur(4px)',
  ].join(';');
  cap.innerHTML =
    `<div style="color:#eaf0f7;font-weight:600;letter-spacing:0.06em">${d.icon} ${d.label.toUpperCase()}</div>`
    + `<div style="margin-top:4px;opacity:0.72">${d.blurb}</div>`;
  document.body.appendChild(cap);
}
