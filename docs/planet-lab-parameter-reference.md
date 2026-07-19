# Planet Lab — parameter reference (pre-"systemic controls" snapshot)

**Purpose.** The authoritative record of the planet lab's parameter set **as of 2026-07-19**, before
any consolidation into higher-level systemic controls. If a later macro-control layer turns out to be
the wrong abstraction, this document is what we revert to: every slider, its range, what it feeds, and
how the climate terms combine.

Sources of truth in code: `src/render/planet/presets.ts` (`Preset` / `PlanetRenderParams`),
`src/render/planet/plates.ts` (`MacroParams`), `src/render/planet/bake.ts` (`BakeParams`),
`src/render/planet/glsl.ts` (the shader math), `src/render/planet/planet-lab.ts` (the panel).

---

## 1. Sections and sliders (surface archetypes)

### Tectonics — `MacroParams`, per archetype (`MACRO[type]`)
| Slider | Key | Range | Feeds |
|---|---|---|---|
| Plates | `plateCount` | 3–48 | Voronoi plate count; boundaries become ranges |
| Continents | `continents` | 1–8 | number of continent seeds |
| Land coverage | `landCoverage` | 0.02–0.98 | continent cap radii → land fraction |
| Size variety | `sizeVariety` | 0–1 | variance in continent size |
| Range uplift | `uplift` | 0–0.6 | convergent-boundary height |
| Range width | `rangeWidth` | 0.02–0.2 | how far ranges spread inland (dot-space) |
| Range variation | `rangeVar` | 0–1 | along-boundary uplift variation (P-04 fix) |
| Coastline rough | `coastAmp` | 0–0.8 | coastline fracture amplitude (radians) |
| Coastline scale | `coastFreq` | 0.5–6 | bay/peninsula scale |

### Terrain — `Preset` + `MacroParams`
| Slider | Key | Range | Feeds |
|---|---|---|---|
| Detail scale | `detailScale` (macro) | 1–8 | fBm/ridged detail frequency |
| Normal depth | `normalStrength` (macro) | 0–0.8 | relief-normal (shading only) |
| Displacement | `displacement` | 0–0.12 | radial vertex displacement |
| Ridged | `ridged` | 0–1 | fBm hills ↔ ridged mountains |
| Roughness | `roughness` | 0–1 | specular breakup |
| Sea level | `seaLevel` | 0–1 | waterline; also flat-ocean vertex + bathymetry + ice shelf |
| Polar ice | `latitudeIce` | 0–1 | cap extent → cap MASS and colour (`iceCap()`) |

### Climate — `Preset` (the moisture/biome field)
| Slider | Key | Range | Feeds |
|---|---|---|---|
| Base humidity | `moisture` | 0–1.5 | the field's starting level |
| Arid belts | `aridBelts` | 0–1.5 | Hadley: +ITCZ, −subtropics, −poles |
| Rain shadow | `rainShadow` | 0–1.5 | leeward drying behind upwind ranges |
| Windward wetting | `orographic` | 0–1.5 | wet flank where air is forced up |
| Lapse rate | `lapseRate` | 0–2 | altitude cooling (montane belt position) |
| Treeline | `treeline` | 0–0.6 | temperature below which vegetation stops |
| Wind bearing | `windBearing` | −1.57–1.57 | meridional tilt of the zonal wind |
| Continentality | `continental` | 0–1.5 | inland drying |
| Altitude drying | `altitudeDry` | 0–1.5 | highland drying |
| Patchiness | `patchiness` | 0–1.5 | mesoscale variation |
| Lush depth | `lushDepth` | 0–1.5 | strength of the biome palette over bare ground |

### Surface features — `MacroParams`
| Slider | Key | Range |
|---|---|---|
| Craters / density / depth | `craters` 0–1, `craterFreq` 3–32, `craterDepth` 0–0.2 |
| Canyons / scale / depth | `canyons` 0–1, `canyonFreq` 1–6, `canyonDepth` 0–0.25 |

### Clouds — `Preset`
`cloudCover` 0–1 · `cloudShadow` 0–1 · `cloudFlow` 0–2 · `cloudTurb` 0–1.5 · `cyclones` 0–1 ·
`cycloneSize` 0.04–0.4 · `cloudTerrain` 0–1 · `cloudDetail` 0.5–4 · `cloudSpeed` 0–1 ·
`cloudWisp` 0–1 · `cloudRegion` 0–1

### Atmosphere / Ocean / Emissive
`hasAtmosphere` · `atmosphereDensity` 0–2 · `nightLights` 0–1 · `atmosphere` (colour) ·
`oceanShallow` / `oceanDeep` (colours) · `emissiveStrength` 0–3 · `emissive` (colour)

### Master bake (erosion) — `BakeParams`, shared across archetypes
`Baked + eroded` (per-type toggle) · `res` 64–512 · `droplets` 0–120000 · `erosionStrength` 0–1 ·
`talus` 0.001–0.02 · `thermalIters` 0–20

---

## 2. How the climate terms combine (the load-bearing math)

Moisture is **base + signed contributions**, never a product chain (five sub-1 factors multiplied
collapse the field to ~0 and the planet goes drab):

```
m  = moisture                                            // base
m += aridBelts * (0.30*itcz - 0.55*dryBelt - 0.30*polar)  // circulation
m -= rainShadow * smoothstep(0.02, 0.22, barrier-here)    // lee of upwind range
m += orographic * smoothstep(0.015, 0.16, ahead-here)     // windward flank
m -= continental * 0.40 * landFraction(ring)              // interior
m -= altitudeDry * (0.35*hh + 0.75*smoothstep(0.45,0.85,hh))
m += patchiness * 0.55 * fbm(...)
m  = clamp(m, 0, 1)
```

Temperature is the second Whittaker axis:
```
t = 1 - smoothstep(0.02, 0.98, |lat|)   // insolation
t -= lapseRate * hh                      // environmental lapse rate
t += 0.06 * fbm(...)                     // regional variation
```

Colour = `biomeColor(t, m)` blended over the bare-ground ramp by
`cover = smoothstep(treeline±, t) * (0.35 + 0.65*smoothstep(0.05,0.35,m))`, scaled by `lushDepth`.

**Calibration invariant:** any single driver at full strength should shift a biome **one step**, not
strip the planet. Weights above are tuned to that rule.

---

## 3. Known coupling (why a systemic layer is tempting)

These move together in reality and currently must be moved by hand, one slider at a time:

| Physical change | Sliders that must all move |
|---|---|
| Warmer world (hothouse) | `latitudeIce`↓ `treeline`↓ `moisture`↑ `aridBelts`↓ `cloudCover`↑ `seaLevel`↑ |
| Colder world (glacial) | `latitudeIce`↑ `treeline`↑ `moisture`↓ `aridBelts`↑ `continental`↑ `seaLevel`↓ |
| More water | `seaLevel`↑ `landCoverage`↓ `continental`↓ `moisture`↑ |
| Supercontinent | `continents`↓ `landCoverage`↑ `continental`↑↑ |
| Older/quieter tectonics | `uplift`↓ `ridged`↓ `craters`↑ `canyons`↓ |

A systemic layer should drive these bundles; **this table is the mapping to implement, and this
document is the revert target if the layer proves wrong.**
