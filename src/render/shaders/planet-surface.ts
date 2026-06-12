// ═══════════════════════════════════════════════════════════════════
// PLANET SURFACE SHADER — Day/Night Terminator + Specular + Texture
// Lambert diffuse with smoothstep terminator, specular highlight,
// and fresnel rim for atmospheric planets.
// Optional day texture via uDayTexture / uHasTexture uniforms.
// ═══════════════════════════════════════════════════════════════════

export const planetSurfaceVertexShader = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vViewDir;
  varying vec2 vUv;

  void main() {
    // WORLD-space normal. normalMatrix would give a VIEW-space normal, which —
    // dotted against the world-space uSunDir in the fragment shader — made the
    // terminator rotate with the camera instead of staying opposite the sun.
    // mat3(modelMatrix) is exact here: planet transforms are rotation + uniform
    // scale only (normalize() absorbs the scale).
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    // Guard: when camera is at object position, viewDir is zero → normalize produces NaN
    vec3 toCamera = cameraPosition - worldPos.xyz;
    float toCameraDist = length(toCamera);
    vViewDir = toCameraDist > 0.0001 ? toCamera / toCameraDist : vec3(0.0, 0.0, 1.0);
    vUv = uv;

    gl_Position = projectionMatrix * viewMatrix * worldPos;
    #include <logdepthbuf_vertex>
  }
`;

export const planetSurfaceFragmentShader = /* glsl */ `
  #include <logdepthbuf_pars_fragment>

  uniform vec3 uColor;
  uniform vec3 uSunDir;
  uniform float uTerminatorSoftness;
  uniform float uTerminatorOffset;
  uniform float uSpecularPower;
  uniform float uSpecularOffset;
  uniform sampler2D uDayTexture;
  uniform bool uHasTexture;
  uniform float uTime;
  uniform bool uHasAtmosphere;
  uniform float uSpecularScale;   // 0..1, gates specular intensity per planet class
  uniform vec3 uTwilightTint;     // warm rim color at the terminator
  uniform float uTwilightStrength;
  // Planetshine: a single secondary bounce light (e.g. a moon lit by its gas
  // giant's reflected sunlight). uBounceStrength is 0 for bodies with no bright
  // neighbour (set per-frame on the CPU). See docs §5.7.
  uniform vec3 uBounceDir;        // world-space direction to the bounce source
  uniform vec3 uBounceColor;      // reflected-light tint (the source body's albedo color)
  uniform float uBounceStrength;
  // Ring shadow cast onto the planet surface (ringed planets only). Project the
  // fragment toward the sun onto the ring plane; if it lands in the annulus, the
  // ring occludes the sun. World-space. See docs §5.6.
  uniform bool uHasRingShadow;
  uniform vec3 uRingNormal;       // ring-plane normal (world)
  uniform vec3 uPlanetCenter;     // planet center (world)
  uniform float uRingInner;       // annulus radii (world units)
  uniform float uRingOuter;
  uniform float uRingShadowStrength;
  // Jónsson limb darkening (Cassini-fitted, bjj.mmedia.is/3dtest/jup_shading.html)
  // for gas/ice giants: diffuse follows cos(i)^k instead of pure Lambert, and
  // past cos(e) < uLimbCe the disc darkens per-channel — blue falls off least,
  // giving the photographic faintly-blue limb. Gated by uLimbDarken (0/1).
  uniform float uLimbDarken;
  uniform float uLimbK;           // incidence exponent (~0.85)
  uniform float uLimbCe;          // emission-angle threshold (~0.75)

  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vViewDir;
  varying vec2 vUv;

  // Simple hash for storm positions
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  // Value noise for storm clustering
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    #include <logdepthbuf_fragment>

    vec3 N = normalize(vNormal);
    vec3 L = normalize(uSunDir);
    vec3 V = normalize(vViewDir);

    // Base color — from texture or uniform
    vec3 baseColor = uColor;
    if (uHasTexture) {
      baseColor = texture2D(uDayTexture, vUv).rgb;
    }

    // Lambert diffuse with smooth terminator
    float NdotL = dot(N, L);
    float dayFactor = smoothstep(uTerminatorOffset, uTerminatorOffset + uTerminatorSoftness, NdotL);

    // Day side color
    vec3 dayColor = baseColor * dayFactor;

    // Night side — true darkness, no blue lift. Space is black.
    vec3 nightColor = baseColor * 0.015;

    // Night-side storm lightning (atmospheric uninhabited planets only)
    if (uHasAtmosphere && dayFactor < 0.1) {
      float nightMask = 1.0 - smoothstep(0.0, 0.1, dayFactor);
      // Cluster storms in mid-latitude bands
      float latBand = sin(vUv.y * 6.283) * 0.5 + 0.5;
      latBand = smoothstep(0.2, 0.5, latBand) * smoothstep(0.8, 0.5, latBand);
      // Sparse storm cells
      float stormCell = vnoise(vUv * 30.0);
      float stormActive = step(0.75, stormCell);
      // Pulsing flash
      float flash = sin(uTime * 8.0 + hash(floor(vUv * 30.0)) * 100.0);
      flash = max(0.0, flash) * max(0.0, sin(uTime * 3.0 + stormCell * 50.0));
      float stormBrightness = stormActive * flash * latBand * nightMask * 0.03;
      nightColor += vec3(0.7, 0.75, 1.0) * stormBrightness;
    }

    vec3 surfaceColor = mix(nightColor, dayColor, dayFactor);

    // Gas/ice giant limb darkening (Jónsson): replace the day-side shading
    // with cos(i)^k Lambert shaping plus a per-channel emission-angle falloff.
    // Continuous remap pow(x, rp)·(1−rc)+rc → 1 at the threshold, rc at the
    // limb (blue rc=0.5 falls least ⇒ faintly blue limb, per Cassini fits).
    if (uLimbDarken > 0.5) {
      float ci = max(NdotL, 0.0);
      float ce = max(dot(N, V), 0.0);
      vec3 giantDay = baseColor * pow(ci, uLimbK);
      if (ce < uLimbCe) {
        vec3 rp = vec3(0.2, 0.125, 0.04);
        vec3 rc = vec3(0.1, 0.07, 0.5);
        float x = ce / uLimbCe;
        vec3 limb = pow(vec3(x), rp) * (1.0 - rc) + rc;
        // Phase factor blends the limb term in most strongly near full phase.
        float phase = (dot(L, V) + 1.0) * 0.5;
        giantDay *= mix(vec3(1.0), limb, phase);
      }
      surfaceColor = mix(nightColor, giantDay, dayFactor);
    }

    // Specular highlight (Blinn-Phong) — gated by uSpecularScale per planet class.
    // Oceanic worlds get strong specular (sea-glint), ice giants medium,
    // rocky and gas giants none.
    // Guard: if L and V are opposite, L+V ≈ 0 → normalize produces NaN
    vec3 halfVec = L + V;
    float halfLen = length(halfVec);
    vec3 H = halfLen > 0.0001 ? halfVec / halfLen : vec3(0.0, 1.0, 0.0);
    float spec = pow(max(dot(N, H), 0.0), uSpecularPower);
    spec *= smoothstep(0.0, uSpecularOffset, NdotL); // only on day side
    surfaceColor += vec3(spec * 0.35) * uSpecularScale;

    // Twilight band — warm scattering tint exactly at the terminator.
    // Peaks where the sun grazes the surface; falls off into day and night.
    float terminatorBand = 1.0 - abs(NdotL * 2.0 - 0.0) ; // 1 near terminator
    terminatorBand = clamp(1.0 - abs(NdotL), 0.0, 1.0);
    terminatorBand = pow(terminatorBand, 8.0);
    surfaceColor += uTwilightTint * terminatorBand * uTwilightStrength;

    // Planetshine — diffuse fill from the bounce source (Lambert on uBounceDir).
    // Additive and dim, so it reads only where the sun doesn't (the night side
    // facing the parent body): the "moon lit blue/tan by its gas giant" cue.
    float bounceNdotL = max(dot(N, normalize(uBounceDir)), 0.0);
    surfaceColor += uBounceColor * (uBounceStrength * bounceNdotL);

    // Ring shadow — march from the fragment toward the sun to the ring plane.
    if (uHasRingShadow) {
      float denom = dot(L, uRingNormal);
      if (abs(denom) > 1e-4) {
        // t along +L (toward sun) to reach the ring plane through the center.
        float t = dot(uPlanetCenter - vWorldPos, uRingNormal) / denom;
        if (t > 0.0) {                          // ring lies between fragment and sun
          vec3 hit = vWorldPos + t * L;
          float rHit = length(hit - uPlanetCenter);
          // soft inner/outer edges; ~constant optical depth across the annulus
          float band = smoothstep(uRingInner, uRingInner * 1.03, rHit)
                     * (1.0 - smoothstep(uRingOuter * 0.97, uRingOuter, rHit));
          surfaceColor *= (1.0 - uRingShadowStrength * band);
        }
      }
    }

    gl_FragColor = vec4(surfaceColor, 1.0);
  }
`;
