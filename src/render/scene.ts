// ═══════════════════════════════════════════════════════════════════
// SCENE MANAGER — Three.js Scene, Camera, Lighting
// Matches the monolithic prototype's scene composition:
// FogExp2, PointLight from star, subtle ambient.
// ═══════════════════════════════════════════════════════════════════

import {
  Scene, PerspectiveCamera, AmbientLight, PointLight,
  Group, Clock, Color,
  type Object3D,
} from 'three';
import { VP } from './visual-params'; // ADMIN VISUAL EDITOR — REMOVE

export interface LayerGroups {
  local: Group;       // planets, bobs, asteroids, stations (system view)
  regional: Group;    // star system markers (regional view)
  galactic: Group;    // galaxy structure (galaxy view)
  background: Group;  // background starfield (always visible)
  ui: Group;          // selection rings, markers, overlays
}

export interface SceneContext {
  scene: Scene;
  camera: PerspectiveCamera;
  layers: LayerGroups;
  renderObjectMap: Map<number, Object3D>;
  clock: Clock;
}

export function registerRenderObject(
  map: Map<number, Object3D>, eid: number, obj: Object3D,
): void {
  map.set(eid, obj);
  obj.userData.eid = eid;
}

export function createScene(): SceneContext {
  const scene = new Scene();

  // Skybox — deep space background color (texture fallback)
  scene.background = new Color(0x020208);
  // Camera — matches prototype: FOV 55, near 0.01, far 200000
  const camera = new PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.01,
    200000,
  );
  camera.position.set(0, 40, 80);

  // Lighting — star point light + subtle ambient
  const starLight = new PointLight(
    new Color(VP.get('starLightColor')),
    VP.get('starLightIntensity'),
    4000, 1,
  );
  starLight.position.set(0, 0, 0);
  scene.add(starLight);

  const ambient = new AmbientLight(
    new Color(VP.get('ambientColor')),
    VP.get('ambientIntensity'),
  );
  scene.add(ambient);

  // ADMIN VISUAL EDITOR — REMOVE: VP subscription for live lighting adjustment
  VP.subscribe((key) => {
    switch (key) {
      case 'starLightIntensity':
        starLight.intensity = VP.get('starLightIntensity');
        break;
      case 'starLightColor':
        starLight.color.set(VP.get('starLightColor'));
        break;
      case 'ambientIntensity':
        ambient.intensity = VP.get('ambientIntensity');
        break;
      case 'ambientColor':
        ambient.color.set(VP.get('ambientColor'));
        break;
    }
  });

  // Layer groups — visibility toggled per zoom tier
  const local = new Group();
  local.name = 'layer-local';

  const regional = new Group();
  regional.name = 'layer-regional';
  regional.visible = false;  // hidden until sector zoom

  const galactic = new Group();
  galactic.name = 'layer-galactic';
  galactic.visible = false;  // hidden until arm/galaxy zoom

  const background = new Group();
  background.name = 'layer-background';

  const ui = new Group();
  ui.name = 'layer-ui';

  scene.add(local);
  scene.add(regional);
  scene.add(galactic);
  scene.add(background);
  scene.add(ui);

  const layers: LayerGroups = { local, regional, galactic, background, ui };
  const renderObjectMap = new Map<number, Object3D>();
  const clock = new Clock();

  // Resize handler
  const onResize = (): void => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', onResize);

  return { scene, camera, layers, renderObjectMap, clock };
}
