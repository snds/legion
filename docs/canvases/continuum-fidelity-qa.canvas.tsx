import {
  Callout,
  Divider,
  Grid,
  H1,
  H2,
  Pill,
  Row,
  Stack,
  Stat,
  Table,
  Text,
} from 'cursor/canvas';

/**
 * Continuum full-harness visual QA + NORTHSTAR (SE + SC) fidelity re-eval.
 * Captures: 2026-08-06 accept run (F10, after F1-F9 landed) + refs/continuum/
 * {stills,motion}/NORTHSTAR/. SC audio: Whisper transcript of Planet Tech V5 / Genesis recap.
 */
export default function ContinuumFidelityQa() {
  return (
    <Stack gap={24} style={{ maxWidth: 980, margin: '0 auto', padding: 24 }}>
      <Stack gap={8}>
        <H1>Continuum fidelity QA</H1>
        <Text tone="secondary">
          Full accept harness (re-run after F1-F9) plus NORTHSTAR re-eval (Space Engine + Star Citizen
          stills/motion, SC Planet Tech V5 audio transcript). Official refs under
          refs/continuum/stills|motion/NORTHSTAR/.
        </Text>
        <Row gap={8} style={{ flexWrap: 'wrap' }}>
          <Pill tone="warning">NORTHSTAR unsigned</Pill>
          <Pill tone="info">Playwright Chromium</Pill>
          <Pill tone="neutral">SE + SC refs present</Pill>
          <Pill tone="success">Night ≠ day (F3 fixed)</Pill>
          <Pill tone="success">Cloud V-seam gone (F1 fixed)</Pill>
          <Pill tone="success">Cover thinner (F4 fixed)</Pill>
          <Pill tone="warning">Limb still white/cream (F2 partial)</Pill>
          <Pill tone="deleted">look-orient shimmer (new)</Pill>
        </Row>
      </Stack>

      <Callout tone="warning" title="Authoritative budget is still your native Chrome JSON">
        F10 re-run: 0.8 AU worst 5.305 ms, 0.3 AU worst 8.256 ms (both under the 14 ms budget
        individually). Your earlier native Chrome capture was ~15 / ~32 ms — treat these Playwright
        Chromium numbers as trend-only until system Chrome channel is available.
      </Callout>

      <H2>Harness numbers (F10 re-run)</H2>
      <Grid columns={4} gap={16}>
        <Stat value="5.305 ms" label="0.8 AU worst (auto)" />
        <Stat value="8.256 ms" label="0.3 AU worst (auto)" />
        <Stat value="96" label="0.3 AU medianTex" tone="success" />
        <Stat value="MAD 20.65" label="approach-surface spike (new)" tone="warning" />
      </Grid>
      <Text tone="secondary">
        Source: refs/continuum/perf/*.json and qa/*/qa_report.md · 2026-08-06 F10 re-run. Toolkit TOTAL
        that sums worst+baked+noplanet is a false fail; use the worst row. medianTex 96 at 0.3 AU
        confirms F6's close-AU bake fix landed (was ~20 pre-F6).
      </Text>

      <H2>What the files show (F10 re-run)</H2>
      <Table
        headers={['Pose / path', 'Observation', 'vs SE / SC language']}
        rows={[
          [
            '0.8 day',
            'Ocean/continents now visible through thinner cloud breaks; limb reads white/cream, not cyan',
            'SC Pyro I: volumetric self-shadow + cast ground shadows + cyan limb; SE: soft blue limb, ocean through breaks',
          ],
          [
            '0.8 night',
            'Fixed — clearly dim/blue-toned disc with faint night-side lights, unambiguously distinct from day',
            'SE eclipse plates: deep black disc, thin warm rim, diamond-ring energy',
          ],
          [
            '0.3 coast',
            'medianTex 96 (floor met); clear coastline/land-sea structure; limb still white/cream',
            'SC Fairo: fractal coasts, liquid specular, thin cyan limb; SE close Earth scale continuity',
          ],
          [
            '0.6 clouds',
            'Cloud V/chevron gone; cover thinner; warm terminator glow visible at top/bottom of disc',
            'SC: thick clouds cast ground shadow; soft terminator; multi-material under side light (Obsidian)',
          ],
          [
            'approach-surface',
            'Zoom clean, no seam or HUD leak; toolkit flags one MAD 20.65 temporal spike at frame 97→98',
            'SE approach: detail climbs without billboard mush or cube seams',
          ],
          [
            'SC / SE motion',
            'SC: surface WIP mountains/canopy + tech talk; SE: icy/airless texture climb',
            'Useful technique refs; not same-pose Terran orbit accept plates',
          ],
        ]}
      />

      <H2>SC Planet Tech V5 audio (chase vs skip)</H2>
      <Text tone="secondary">
        Transcript: refs/continuum/qa/northstar-review/sc-planet-tech-v5-transcript.md (Whisper base from
        motion/NORTHSTAR/star citizen/source.mp4). Community recap of Ali Brown Spectrum answers.
      </Text>
      <Table
        headers={['Chase for Continuum lab', 'Skip / defer']}
        rows={[
          [
            'Seamless clouds; better cloud language (self + ground shadow)',
            'Full V5 volumetric cloud system / raymarch',
          ],
          [
            'Thin Rayleigh limb; night rim; side-light microrelief',
            'Genesis art-placed POIs, ArcCorp, building density',
          ],
          [
            'Fractal coast + liquid specular; close tex climb without pop',
            'Dynamic weather/rain beyond storm-gated lightning',
          ],
          [
            'Incremental visual ship (cover then polish), not big-bang',
            'Planet size upsizing; orbits/server-meshing; Vulkan/GI dependency',
          ],
        ]}
      />

      <H2>Fidelity improvements (revised priority)</H2>
      <Table
        headers={['#', 'Improvement', 'Delta vs prior', 'Likely locus']}
        rows={[
          [
            '1',
            'Kill cloud cube-face V / center seam',
            'Was #2 → #1',
            'cloud shell UV / cube mapping + cloud-voxels',
          ],
          [
            '2',
            'Rayleigh limb (cyan/blue graze) + warm terminator / night rim',
            'Was #4 → #2; merges night rim',
            'continuumAtmosFrag + aerial haze gates',
          ],
          [
            '3',
            'Fix night pose + night disc energy',
            'Was #1 → #3',
            'accept poseSun + shaders skyFill/antiSun',
          ],
          [
            '4',
            'Thin Terran cloud cover + cast ground shadows',
            'Was #5 → #4',
            'climate/cloud density + surface shadow term',
          ],
          [
            '5',
            'Cloud self-shadow / thickness cue',
            'Was #7 → #5',
            'cloud shell lighting (cheap; not full V5 volumes)',
          ],
          [
            '6',
            'Restore close-AU albedo climb (≥96 medianTex)',
            'Was #3 → #6',
            'chunk-pool polish cadence + facing medianTex',
          ],
          [
            '7',
            'Ocean glint + coast AA + bathymetry hide',
            'Was #6 → #7',
            'surface shader radial water normals + shelf fringe',
          ],
          [
            '8',
            'Side-light multi-material / microrelief cue',
            'NEW (Obsidian / Genesis spirit)',
            'surface material variance under non-front sun',
          ],
          [
            '9',
            'Accept capture hygiene',
            'Was #8 → #9',
            'hideLabChrome + playwright Chrome channel',
          ],
        ]}
      />

      <Divider />
      <H2>Signing / reference_match</H2>
      <Callout tone="danger" title="Cannot sign yet (F10: still NOT signed, per task brief)">
        se-planet remains Literal-within-WebGPU but unsigned for reference_match: still need same-pose SE Earth
        day / coast / terminator under refs/northstars/se-planet/. Current SE plates prove limb/eclipse language
        only. F1/F3/F4/F9 fixes (seam, night, cover, HUD) now visually confirmed in the F10 re-run; the limb
        cyan gap (F2, partial) is the main remaining Continuum-side blocker. SC is spirit/technique, not a
        Literal substitute.
      </Callout>
      <Callout tone="info" title="Recommended next slice (post-F10)">
        Strengthen the non-terminator Rayleigh limb tint (F2 follow-up) so it reads cyan/blue at capture
        exposure, then triage the two new toolkit findings (look-orient shimmer MAD 12.22, approach-surface
        spike MAD 20.65 at frame 97→98) before attempting reference_match sign-off.
      </Callout>
    </Stack>
  );
}
