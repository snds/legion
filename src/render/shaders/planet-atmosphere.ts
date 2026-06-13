// ═══════════════════════════════════════════════════════════════════
// PLANET ATMOSPHERE SHADER — single-scattering (Rayleigh + Mie)
// Renders on the BackSide of a shell at uAtmosScale × planet radius. The
// fragment ray-marches the camera ray through the atmosphere shell (clamped
// to the planet surface where occluded), accumulating Rayleigh + Mie
// in-scattering with per-channel Rayleigh (∝1/λ⁴) and a Henyey-Greenstein
// Mie phase. This is the system-tier application of the Hillaire 2020 model
// (master roadmap Phase 4 #20): a physical blue day-limb that reddens through
// the terminator from path length — not a tinted fresnel. Work is done in
// NORMALIZED planet-radius units (planet R=1, atmosphere R=uAtmosScale).
// ═══════════════════════════════════════════════════════════════════

export const planetAtmosphereVertexShader = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vViewDir;

  void main() {
    // WORLD-space normal (matches planet-surface.ts fix): normalMatrix is the
    // VIEW-space normal matrix, which made the atmosphere's day/twilight gating
    // rotate with the camera instead of tracking the world-space sun.
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    // Guard: when camera is at object position, toCamera ≈ 0 → normalize produces NaN
    vec3 toCamera = cameraPosition - worldPos.xyz;
    float toCameraDist = length(toCamera);
    vViewDir = toCameraDist > 0.0001 ? toCamera / toCameraDist : vec3(0.0, 0.0, 1.0);

    gl_Position = projectionMatrix * viewMatrix * worldPos;
    #include <logdepthbuf_vertex>
  }
`;

export const planetAtmosphereFragmentShader = /* glsl */ `
  #include <logdepthbuf_pars_fragment>

  uniform vec3 uAtmosColor;     // per-planet tint (Earth ~blue, Mars rust, …)
  uniform vec3 uSunDir;         // world, normalized
  uniform vec3 uPlanetCenter;   // world
  uniform float uPlanetRadius;  // world
  uniform float uAtmosScale;    // atmosphere / planet radius (≈1.08)
  uniform float uSunIntensity;
  uniform float uScatterScale;  // overall optical-depth tuning

  varying vec3 vWorldPos;

  // Ray vs sphere at origin, radius R. Returns (tNear, tFar); tFar<0 ⇒ miss.
  vec2 raySphere(vec3 ro, vec3 rd, float R) {
    float b = dot(ro, rd);
    float c = dot(ro, ro) - R * R;
    float d = b * b - c;
    if (d < 0.0) return vec2(1.0, -1.0);
    float s = sqrt(d);
    return vec2(-b - s, -b + s);
  }

  void main() {
    #include <logdepthbuf_fragment>

    float Rp = 1.0;
    float Ra = uAtmosScale;
    float T  = Ra - Rp;                 // atmosphere thickness (planet radii)

    // Normalized frame: planet at origin, radius 1.
    vec3 ro = (cameraPosition - uPlanetCenter) / uPlanetRadius;
    vec3 rd = normalize((vWorldPos - uPlanetCenter) / uPlanetRadius - ro);
    vec3 L  = normalize(uSunDir);

    vec2 atm = raySphere(ro, rd, Ra);
    if (atm.y < 0.0) discard;
    float tStart = max(atm.x, 0.0);
    float tEnd   = atm.y;
    vec2 pl = raySphere(ro, rd, Rp);    // clamp the march to the planet surface
    if (pl.x > 0.0) tEnd = min(tEnd, pl.x);
    float segLen = tEnd - tStart;
    if (segLen <= 0.0) discard;

    const int VIEW_N = 16;
    const int LIGHT_N = 8;
    float ds = segLen / float(VIEW_N);
    float Hr = 0.33 * T;                // Rayleigh scale height
    float Hm = 0.12 * T;                // Mie scale height (lower haze)
    vec3  betaR = vec3(5.8, 13.5, 33.1) * uScatterScale; // per-channel ∝1/λ⁴
    float betaM = 21.0 * uScatterScale;
    float g = 0.76;

    float mu = dot(rd, L);
    float phaseR = 0.0596831 * (1.0 + mu * mu);                 // 3/(16π)(1+μ²)
    float gg = g * g;
    float phaseM = 0.1193662 * (1.0 - gg)
                 / ((2.0 + gg) * pow(max(1.0 + gg - 2.0 * g * mu, 1e-4), 1.5));

    float odViewR = 0.0, odViewM = 0.0;
    vec3 sumR = vec3(0.0);
    float sumM = 0.0;

    for (int i = 0; i < VIEW_N; i++) {
      vec3 P = ro + rd * (tStart + (float(i) + 0.5) * ds);
      float h = length(P) - Rp;
      float hr = exp(-h / Hr) * ds;
      float hm = exp(-h / Hm) * ds;
      odViewR += hr; odViewM += hm;

      // Light ray P → sun: in shadow if the planet is between P and the sun.
      vec2 lp = raySphere(P, L, Rp);
      if (lp.x > 0.0) continue;          // planet occludes the sun → no in-scatter
      vec2 la = raySphere(P, L, Ra);
      if (la.y <= 0.0) continue;
      float dl = la.y / float(LIGHT_N);
      float odLightR = 0.0, odLightM = 0.0;
      for (int j = 0; j < LIGHT_N; j++) {
        vec3 Q = P + L * ((float(j) + 0.5) * dl);
        float hl = length(Q) - Rp;
        odLightR += exp(-hl / Hr) * dl;
        odLightM += exp(-hl / Hm) * dl;
      }
      vec3 tau = betaR * (odViewR + odLightR) + betaM * 1.1 * (odViewM + odLightM);
      vec3 atten = exp(-tau);
      sumR += atten * hr;
      sumM += atten.g * hm;
    }

    vec3 col = uSunIntensity * (sumR * betaR * phaseR + vec3(sumM) * betaM * phaseM);
    col *= uAtmosColor;                  // per-planet tint
    float a = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
    if (a < 0.0025) discard;
    // Additive blending (material): rgb adds the in-scattered light.
    gl_FragColor = vec4(col, 1.0);
  }
`;
