// ═══════════════════════════════════════════════════════════════════
// THEME — CSS Variable Theme System
// Matches the monolithic Theme IIFE. Controls all UI appearance
// through CSS custom properties on document.documentElement.
// ═══════════════════════════════════════════════════════════════════

// ── Font Catalog ─────────────────────────────────────────────────

export const FONTS = [
  'JetBrains Mono', 'Share Tech', 'Inter', 'Space Grotesk',
  'IBM Plex Sans', 'Outfit', 'Exo 2', 'Rajdhani',
  'Source Sans 3', 'Titillium Web', 'Orbitron',
];

// ── Defaults ─────────────────────────────────────────────────────

interface ThemeValues {
  font: string;
  fontSize: number;
  fontWeight: number;
  fontWeightBold: number;
}

const defaults: ThemeValues = {
  font: 'JetBrains Mono',
  fontSize: 11,
  fontWeight: 400,
  fontWeightBold: 500,
};

let current: ThemeValues = { ...defaults };

// ── Apply ────────────────────────────────────────────────────────

function apply(): void {
  const r = document.documentElement.style;
  r.setProperty('--ui-font', `'${current.font}', 'SF Mono', 'Consolas', monospace`);
  r.setProperty('--ui-font-size', current.fontSize + 'px');
  r.setProperty('--ui-font-weight', String(current.fontWeight));
  r.setProperty('--ui-font-weight-bold', String(current.fontWeightBold));
}

// ── Public API ───────────────────────────────────────────────────

export const Theme = {
  apply,

  setFont(name: string): void {
    current.font = name;
    apply();
  },

  getFont(): string {
    return current.font;
  },

  reset(): void {
    current = { ...defaults };
    apply();
  },
};
