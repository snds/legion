import { describe, it, expect } from 'vitest';
import visualDefaults from './visual-defaults.json';
import galaxyDefaults from './galaxy-defaults.json';
import { VP } from '../render/visual-params';

// The committed defaults are WRITTEN BY MACHINE (the Settings/LAB "Save as
// default" buttons through the dev endpoint) but read on every boot — these
// guards catch a hand-edit or a stale key surviving a rename.

describe('src/config/visual-defaults.json', () => {
  it('contains only known VisualParams keys (+ the _savedAt stamp)', () => {
    const known = new Set([...Object.keys(VP.getDefaults()), '_savedAt']);
    for (const k of Object.keys(visualDefaults)) {
      expect(known.has(k), `unknown VisualParams key '${k}'`).toBe(true);
    }
  });
});

describe('src/config/galaxy-defaults.json', () => {
  const KNOWN = new Set([
    'cfg', 'dust', 'gasIntensity', 'dustOpacity', 'gasPuffKpc', 'gasCore',
    'gasBlurEnabled', 'gasBlurScale', 'gasBlurRadius', 'gasGain',
    'prominentEnabled', 'prominentCount', 'prominentSize', 'prominentBright',
    'prominentVariance', 'cloudEnabled', 'starsEnabled', 'dustEnabled', 'seed',
    '_savedAt',
  ]);
  it('contains only known GalaxyPreset keys', () => {
    for (const k of Object.keys(galaxyDefaults)) {
      expect(KNOWN.has(k), `unknown GalaxyPreset key '${k}'`).toBe(true);
    }
  });
});
