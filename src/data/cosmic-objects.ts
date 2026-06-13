// ═══════════════════════════════════════════════════════════════════
// COSMIC OBJECTS — non-system map entities (nebulae, megastructures)
//
// PLACEHOLDER DATA. These populate the local star-map with the new cosmic
// object iconography so the types are visible and tunable. Swap in real
// entities / lore at will — the marker pipeline (createCosmicMarker →
// layers.regional, with the same screen-constant sizing, fade, stems,
// labels, declutter and selection as the star systems) is the contract.
//
// Positions are a DIRECTION (x,y,z, normalised in main.ts) × distLy, placed
// on the same distance-accurate local map as STAR_SYSTEMS — directions chosen
// to sit clear of the star markers.
// ═══════════════════════════════════════════════════════════════════

export type CosmicType = 'nebula' | 'dyson_sphere' | 'dyson_swarm' | 'megastructure';

export interface CosmicObject {
  name: string;
  type: CosmicType;
  x: number; y: number; z: number; // direction from home (ε Eridani)
  distLy: number;
  color: number;
  subtitle: string;
}

export const COSMIC_OBJECTS: CosmicObject[] = [
  { name: 'Witch Head',  type: 'nebula',        x:  3, y:  7, z: -2, distLy: 9.0,  color: 0xc971d6, subtitle: 'EMISSION NEBULA' },
  { name: 'Helios Shell', type: 'dyson_sphere',  x: -2, y: -5, z:  7, distLy: 7.5,  color: 0x48d6c4, subtitle: 'DYSON SPHERE' },
  { name: 'Sigma Array',  type: 'dyson_swarm',   x:  9, y:  3, z:  5, distLy: 11.0, color: 0xe0a94a, subtitle: 'DYSON SWARM' },
  { name: 'The Loom',     type: 'megastructure', x: -8, y:  4, z: -6, distLy: 8.5,  color: 0x9b86e0, subtitle: 'RINGWORLD' },
];
