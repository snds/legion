import type { Vec3 } from '../cube-sphere';
import type { AuthoringStore } from './types';

/** Empty authoring overlay — paint diffs keyed by chunk land later. */
export function createAuthoringStore(): AuthoringStore {
  let rev = 0;
  const height = new Map<string, number>();
  const biome = new Map<string, number>();

  return {
    fingerprint() { return `a${rev}:${height.size}:${biome.size}`; },
    heightDelta(_dir: Vec3, chunkKey: string) {
      return height.get(chunkKey) ?? 0;
    },
    biomeOverride(_dir: Vec3, chunkKey: string) {
      return biome.has(chunkKey) ? biome.get(chunkKey)! : null;
    },
    clear() {
      height.clear();
      biome.clear();
      rev++;
    },
  };
}
