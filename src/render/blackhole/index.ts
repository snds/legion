// Black-hole set-piece — physically-correct Schwarzschild geodesic renderer.
// Public surface for the module; see blackhole.ts for the drop-in Object3D.

export { BlackHole, createBlackHole, type BlackHoleOptions } from './blackhole';
export { R_BOUND, createBlackholeMaterial } from './blackhole-shader';
export {
  buildBlackbodyRamp, blackbodyRGB, rampCoord, RAMP_MIN_K, RAMP_MAX_K,
} from './blackbody';
export {
  eventHorizon, photonSphere, criticalImpactParameter, isco,
  weakFieldDeflection, temperatureProfile, diskFluxProfile, peakFluxRadius,
  gravitationalRedshift, orbitalBeta, redshiftFactor, traceFromInfinity,
  type GeodesicResult,
} from './schwarzschild';
