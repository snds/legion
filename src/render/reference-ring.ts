// ═══════════════════════════════════════════════════════════════════
// REFERENCE RING — labelled scale ring on the reference plane
//
// Solar-System-Scope-style spatial scale cue: a faint circle on the y=0
// plane, centred on the system, at a ROUND radius (~half the view), with a
// label of that radius in the same per-tier units as the HUD view-radius
// readout (AU inside the heliopause, ly at the stellar tiers). Gives the
// player a concrete "this circle is N AU/ly from centre" reference to read
// the depth/scale of the local map against.
//
// Shown at the origin-centred tiers (inner-system → sector); hidden at the
// close tiers (you're at a body) and at arm/galaxy (the camera reframes off
// the origin). updateReferenceRing() runs each frame.
// ═══════════════════════════════════════════════════════════════════

import {
  Group, BufferGeometry, Float32BufferAttribute, LineLoop, LineBasicMaterial,
  Color, type Sprite, type SpriteMaterial, type Texture,
} from 'three';
import { createLabel } from './icons';
import type { DomainName } from '../core/state';

const SEG = 96;
const SHOW_DOMAINS: DomainName[] = ['inner-system', 'outer-system', 'heliopause', 'sector'];
const WU_PER_AU = 10;
const WU_PER_LY = 220;

let ring: Group | null = null;
let circle: LineLoop | null = null;
let labelSprite: Sprite | null = null;
let lastText = '';

/** Nearest of {1,2,5,10}×10ⁿ to v — a "nice" round radius. */
function niceRound(v: number): number {
  if (v <= 1e-6) return 1;
  const e = Math.floor(Math.log10(v));
  const base = Math.pow(10, e);
  const m = v / base;
  const nice = m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10;
  return nice * base;
}

export function createReferenceRing(): Group {
  ring = new Group();
  ring.name = 'reference-ring';
  ring.visible = false;
  ring.renderOrder = -1;

  const pts: number[] = [];
  for (let i = 0; i < SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    pts.push(Math.cos(a), 0, Math.sin(a)); // unit circle in the XZ plane
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pts, 3));
  circle = new LineLoop(geo, new LineBasicMaterial({
    color: new Color(0x4a5878), transparent: true, opacity: 0.5, depthWrite: false,
  }));
  ring.add(circle);
  return ring;
}

/** Per-frame: size + label the ring for the current tier/zoom. */
export function updateReferenceRing(domain: DomainName, camDist: number): void {
  if (!ring || !circle) return;
  const show = SHOW_DOMAINS.includes(domain);
  ring.visible = show;
  if (!show) return;

  // Same unit regime as the HUD readout: ly at the stellar tier, AU otherwise.
  const stellar = domain === 'sector';
  const wuPer = stellar ? WU_PER_LY : WU_PER_AU;
  const unit = stellar ? 'ly' : 'AU';

  // Round radius near ~55% of the view distance, in real units → back to WU.
  const round = niceRound((camDist * 0.55) / wuPer);
  const rWu = round * wuPer;
  circle.scale.set(rWu, 1, rWu);

  const text = `${round} ${unit}`;
  if (text !== lastText) {
    lastText = text;
    if (labelSprite) {
      ring.remove(labelSprite);
      const m = labelSprite.material as SpriteMaterial;
      (m.map as Texture | null)?.dispose();
      m.dispose();
    }
    labelSprite = createLabel(text, 'rgba(180,200,235,0.85)', 13);
    ring.add(labelSprite);
  }
  if (labelSprite) {
    labelSprite.position.set(rWu, 0, 0);          // at the ring's +X edge
    const s = rWu * 0.06;                          // sized relative to the ring
    labelSprite.scale.set(8 * s, s, 1);            // createLabel canvas is 8:1
  }
}
