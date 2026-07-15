// ═══════════════════════════════════════════════════════════════════
// GENERATOR LABS — registry for the parameter-tuning views.
//
// Sibling to the read-only demos (render/demos.ts): where a demo just flies you
// to a subsystem, a LAB mounts editable examples + a control panel so you can
// tune the generator's parameters and promote a canonical set. Selected via
// ?lab=<id> from the REVIEW BUILDS dropdown. Planet lab ships first; the others
// are registered as "coming soon" placeholders so the menu shows the roadmap.
// ═══════════════════════════════════════════════════════════════════

export type LabId = 'planet' | 'star' | 'blackhole' | 'nebula';

export const LAB_PARAM = 'lab';

export interface LabDef {
  readonly id: LabId;
  readonly icon: string;
  readonly label: string;
  readonly blurb: string;
  /** Built yet? Unavailable labs render disabled in the menu. */
  readonly available: boolean;
}

export const LABS: readonly LabDef[] = [
  {
    id: 'planet', icon: '🪐', label: 'Planet Lab', available: true,
    blurb: 'Tune the six planet archetype presets on live worlds.',
  },
  {
    id: 'star', icon: '☀️', label: 'Star Lab', available: false,
    blurb: 'Coming soon — spectral type, activity and corona tuning.',
  },
  {
    id: 'blackhole', icon: '🕳️', label: 'Black Hole Lab', available: false,
    blurb: 'Coming soon — disk, spin and horizon tuning.',
  },
  {
    id: 'nebula', icon: '🌫️', label: 'Nebula Lab', available: false,
    blurb: 'Coming soon — shell, emission-line and dust tuning.',
  },
];

/** The active, AVAILABLE lab from the URL, or null. */
export function activeLabId(): LabId | null {
  if (typeof location === 'undefined') return null;
  const v = new URLSearchParams(location.search).get(LAB_PARAM);
  const def = LABS.find((d) => d.id === v);
  return def && def.available ? def.id : null;
}

export function labById(id: LabId | null): LabDef | null {
  return id ? LABS.find((d) => d.id === id) ?? null : null;
}
