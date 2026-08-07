import {
  BoxGeometry, Group, IcosahedronGeometry, Mesh, ShaderMaterial, Vector3,
} from 'three';
import type { GeneratorBundle } from '../generators';
import {
  continuumCloudBrickFrag, continuumCloudBrickVert,
  continuumCloudShellFrag, continuumCloudShellVert,
} from './shaders';

/** AU distance below which near voxel bricks engage (airplane / low orbit). */
export const NEAR_CLOUD_AU = 0.12;

/**
 * Far cheap shell + near camera-local voxel density bricks.
 * Driven by WeatherProvider (storms + cover).
 */
export class ContinuumClouds {
  readonly group = new Group();
  private readonly shell: Mesh;
  private readonly shellMat: ShaderMaterial;
  private readonly bricks: Mesh[] = [];
  private readonly brickMat: ShaderMaterial;
  private visible = true;
  private viewAu = 0.8;
  private readonly _camObj = new Vector3();
  private readonly _tmp = new Vector3();

  constructor(
    private readonly radius: number,
    private readonly getBundle: () => GeneratorBundle,
  ) {
    this.group.name = 'continuum-clouds';
    this.shellMat = new ShaderMaterial({
      vertexShader: continuumCloudShellVert,
      fragmentShader: continuumCloudShellFrag,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        uSunDir: { value: new Vector3(0.6, 0.35, 0.72) },
        uCover: { value: 0.5 },
        uTime: { value: 0 },
        uDetail: { value: 1 },
        uFlow: { value: 0.7 },
        uTurb: { value: 0.5 },
        uWisp: { value: 0.5 },
        uRegion: { value: 0.5 },
        uLightning: { value: 0.5 },
        uStorm0: { value: new Vector3(0, 1, 0) },
        uStorm1: { value: new Vector3(0, 1, 0) },
        uStorm2: { value: new Vector3(0, 1, 0) },
        uStormS0: { value: 0 },
        uStormS1: { value: 0 },
        uStormS2: { value: 0 },
        uStormSize: { value: 0.12 },
      },
    });
    this.shell = new Mesh(new IcosahedronGeometry(radius * 1.028, 7), this.shellMat);
    this.shell.name = 'cloud-shell';
    this.group.add(this.shell);

    this.brickMat = new ShaderMaterial({
      vertexShader: continuumCloudBrickVert,
      fragmentShader: continuumCloudBrickFrag,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        uSunDir: { value: new Vector3(0.6, 0.35, 0.72) },
        uTime: { value: 0 },
        uCover: { value: 0.5 },
        uBrickHalf: { value: 1 },
        uBrickCenterObj: { value: new Vector3() },
        uPlanetRadius: { value: radius },
      },
    });
    const half = radius * 0.08;
    const geo = new BoxGeometry(half * 2, half * 2, half * 2);
    for (let i = 0; i < 4; i++) {
      const m = new Mesh(geo, this.brickMat);
      m.visible = false;
      m.name = `cloud-brick-${i}`;
      this.bricks.push(m);
      this.group.add(m);
    }
  }

  setVisible(on: boolean): void {
    this.visible = on;
    this.group.visible = on;
  }

  setViewDistanceAu(au: number): void {
    this.viewAu = au;
  }

  /** Shared weather clock for shell + ground shadow field. */
  get cloudTime(): number {
    return this.shellMat.uniforms.uTime.value as number;
  }

  update(dt: number, sunDir: Vector3, camObjLocal: Vector3): void {
    if (!this.visible) return;
    const bundle = this.getBundle();
    const p = bundle.params;
    bundle.weather.tick(dt, p.cloudSpeed);
    const cover = p.cloudCover;
    const storms = bundle.weather.storms();

    const near = this.viewAu <= NEAR_CLOUD_AU;
    this.shell.visible = !near && cover > 0.01;
    for (const b of this.bricks) b.visible = near && cover > 0.01;

    this.shellMat.uniforms.uCover.value = cover;
    this.shellMat.uniforms.uTime.value =
      ((this.shellMat.uniforms.uTime.value as number) + dt * p.cloudSpeed) % 10000;
    this.shellMat.uniforms.uDetail.value = Math.max(p.cloudDetail, 0.25);
    this.shellMat.uniforms.uFlow.value = p.cloudFlow;
    this.shellMat.uniforms.uTurb.value = p.cloudTurb;
    this.shellMat.uniforms.uWisp.value = p.cloudWisp;
    this.shellMat.uniforms.uRegion.value = p.cloudRegion;
    this.shellMat.uniforms.uLightning.value = p.lightning;
    this.shellMat.uniforms.uStormSize.value = p.cycloneSize;
    (this.shellMat.uniforms.uSunDir.value as Vector3).copy(sunDir);
    const setStorm = (i: number): void => {
      const s = storms[i] ?? { pos: [0, 1, 0] as const, strength: 0 };
      const u = this.shellMat.uniforms;
      (u[`uStorm${i}` as 'uStorm0'].value as Vector3).set(s.pos[0], s.pos[1], s.pos[2]);
      u[`uStormS${i}` as 'uStormS0'].value = s.strength;
    };
    setStorm(0); setStorm(1); setStorm(2);

    this.brickMat.uniforms.uCover.value = cover;
    this.brickMat.uniforms.uTime.value =
      ((this.brickMat.uniforms.uTime.value as number) + dt * p.cloudSpeed) % 10000;
    (this.brickMat.uniforms.uSunDir.value as Vector3).copy(sunDir);

    if (near && cover > 0.01) {
      // Place bricks along camera radial toward deck, slightly above surface.
      this._camObj.copy(camObjLocal);
      const len = this._camObj.length() || 1;
      const dir = this._tmp.copy(this._camObj).multiplyScalar(1 / len);
      const deckR = this.radius * 1.03;
      const half = this.radius * (0.04 + 0.06 * Math.min(1, this.viewAu / NEAR_CLOUD_AU));
      this.brickMat.uniforms.uBrickHalf.value = half;
      for (let i = 0; i < this.bricks.length; i++) {
        const ang = (i / this.bricks.length) * Math.PI * 2;
        const ox = Math.cos(ang) * half * 1.2;
        const oz = Math.sin(ang) * half * 1.2;
        // Orthonormal-ish offset in tangent plane
        const tx = dir.z, tz = -dir.x;
        const tlen = Math.hypot(tx, tz) || 1;
        const px = dir.x * deckR + (tx / tlen) * ox;
        const py = dir.y * deckR;
        const pz = dir.z * deckR + (tz / tlen) * oz;
        this.bricks[i].position.set(px, py, pz);
        this.bricks[i].scale.setScalar(half / (this.radius * 0.08));
      }
    }
  }

  dispose(): void {
    this.shell.geometry.dispose();
    this.shellMat.dispose();
    for (const b of this.bricks) {
      // shared geo — dispose once
      b.removeFromParent();
    }
    this.bricks[0]?.geometry.dispose();
    this.brickMat.dispose();
  }
}
