// ═══════════════════════════════════════════════════════════════════
// GALAXY LAB PANEL — the in-game control surface for the physical galaxy.
//
// Now a thin adapter over the shared lab shell (control-panel.ts): it maps the
// galaxy's declarative GalaxyControls schema onto a LabSchema and mounts it as a
// flyout on the single '🌌 LAB' button, so the galaxy lab shares the SAME chrome
// (docked header + collapse-all + docked footer) as the planet lab and any future
// generator lab. The galaxy still owns its schema + persistence; the shell only
// renders + calls the actions.
//
// The galaxy's input-vs-commit tuning is preserved via the shell's SliderCtrl:
// a bake-time control previews cheaply on `set` (drag) and commits a full resample
// on `commit` (release); a `live` control applies on `set` and never resamples.
// ═══════════════════════════════════════════════════════════════════

import { mountControlPanel, type LabSchema, type LabSection, type LabCtrl, type ControlPanelHandle } from './control-panel';
import type { GalaxyControls, Ctrl, Toggle } from '../render/galaxy-sim';

let mounted: ControlPanelHandle | null = null;

/** Map one galaxy Ctrl/Toggle onto a shared-shell LabCtrl, preserving the
 *  live / preview-on-drag / rebuild-on-release behaviour. */
function mapCtrl(controls: GalaxyControls, c: Ctrl | Toggle): LabCtrl {
  if ('kind' in c) { // Toggle
    return {
      kind: 'toggle', label: c.label, get: c.get,
      set: (v) => { c.set(v); if (c.live) c.live(); else controls.rebuild(); },
    };
  }
  return {
    label: c.label, min: c.min, max: c.max, step: c.step, scale: c.scale, unit: c.unit,
    get: c.get,
    set: (v) => { c.set(v); if (c.live) c.live(); else controls.previewRebuild(); },
    commit: c.live ? undefined : () => { controls.rebuild(); },
  };
}

function toSchema(controls: GalaxyControls, resync: () => void): LabSchema {
  const sections: LabSection[] = controls.sections.map((s) => ({
    title: s.title, key: s.key, ctrls: s.ctrls.map((c) => mapCtrl(controls, c)),
  }));
  return {
    title: '🌌 GALAXY',
    collapseKey: controls.collapseKey,
    sections,
    actions: [
      { label: 'Re-seed', onClick: () => { controls.reseed(); } },
      { label: 'Save', onClick: () => controls.save().then((w) => (w === 'committed' ? 'Committed ✓' : 'Saved (browser)')) },
      { label: 'Revert', onClick: () => { controls.revert(); resync(); return 'Canonical'; } },
      { label: 'Copy JSON', minor: true, onClick: () => {
        const json = JSON.stringify(controls.snapshot(), null, 2);
        return navigator.clipboard?.writeText(json).then(() => 'Copied ✓', () => 'Copy failed') ?? 'No clipboard';
      } },
    ],
  };
}

/** Mount the LAB button + flyout driving `controls`. Null (e.g. ?proto-buildout,
 *  or a ?lab= view owns the flyout) → no-op. */
export function initGalaxyLabPanel(controls: GalaxyControls | null): void {
  if (typeof document === 'undefined' || !controls || mounted) return;
  // `resync` re-syncs every input to the current get() values (used by Revert to
  // snap the sliders back to the reverted canonical look). Defined via the handle,
  // which exists after mount — the action only fires on a later click.
  let handle: ControlPanelHandle | null = null;
  handle = mountControlPanel(toSchema(controls, () => handle?.sync()), {
    // Docked, but COLLAPSED by default — normal play sees only the edge tab; open
    // it to tune the live galaxy. (Persisted per browser.)
    dock: { open: false, storeKey: 'legion.galaxyLab.dock' },
  });
  mounted = handle;
}
