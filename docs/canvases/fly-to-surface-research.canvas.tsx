import {
  Callout,
  Card,
  CardBody,
  CardHeader,
  Divider,
  Grid,
  H1,
  H2,
  H3,
  Pill,
  Row,
  Stack,
  Stat,
  Table,
  Text,
} from 'cursor/canvas';

/**
 * Fly-to-surface continuum research + hitching diagnosis (2026-07-30).
 * Fixture: lab-ideal.json ocean @ 0.8 AU.
 */
export default function FlyToSurfaceResearch() {
  return (
    <Stack gap={24} style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
      <Stack gap={8}>
        <H1>Fly-to-surface continuum</H1>
        <Text tone="secondary">
          Star Citizen-style identity across distance, mapped onto Legion. Hitching
          measured against committed ocean ideal (?lab=planet&au=0.8).
        </Text>
        <Row gap={8} style={{ flexWrap: 'wrap' }}>
          <Pill tone="info">lab-ideal.json</Pill>
          <Pill>Research 2026-07-30</Pill>
          <Pill tone="warning">LOD spin thrash</Pill>
        </Row>
      </Stack>

      <Callout tone="success" title="Hitching: LOD gate shipped">
        Rebuild gate is now tilt-local camera + ~12° spin yaw + 120 ms cooldown.
        Idle spin: ~0.3 rebuilds/s (was ~1.9). Selection still uses surface-local
        camera so facing leaves stay correct.
      </Callout>

      <Grid columns={3} gap={12}>
        <Stat value="~0.3/s" label="LOD rebuilds (spin on)" tone="success" />
        <Stat value="0/s" label="LOD rebuilds (spin off)" tone="success" />
        <Stat value="was ~1.9/s" label="Before fix (spin on)" tone="warning" />
      </Grid>

      <Divider />

      <H2>Continuum rule</H2>
      <Text>
        State is continuous; fidelity is not. Coastlines, climate, ice, weather, and
        settlement fields stay the same object from orbit to surface. Tessellation,
        shader cost, and cloud renderer may change.
      </Text>

      <Grid columns={2} gap={16}>
        <Card>
          <CardHeader>Must retain identity</CardHeader>
          <CardBody>
            <Stack gap={6}>
              <Text>Height master (analytic + bake cache)</Text>
              <Text>Climate (temp × moisture / Whittaker)</Text>
              <Text>Ice extent</Text>
              <Text>Weather clock + storms + cover</Text>
              <Text>Night habitability field</Text>
            </Stack>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>May change with distance</CardHeader>
          <CardBody>
            <Stack gap={6}>
              <Text>Quadtree leaf density / MAX_LEVEL</Text>
              <Text>Shader octaves (uCloudCheap, climate tiers)</Text>
              <Text>Cloud renderer: shell → volume bricks</Text>
              <Text>Scatter / flora residency</Text>
              <Text>Shadow cascade count</Text>
            </Stack>
          </CardBody>
        </Card>
      </Grid>

      <Divider />

      <H2>Star Citizen → Legion</H2>
      <Table
        headers={['SC idea', 'Legion today', 'Next']}
        rows={[
          [
            'Shared data pools (geology, T, humidity)',
            'Plates + climate uniforms + bake atlas',
            'Keep one master; cheaper LODs sample it',
          ],
          [
            'Virtual Terrain (no macro pop)',
            'Cube-sphere quadtree + merge',
            'Spin-invariant LOD + CDLOD morph',
          ],
          [
            'Far shader approximates unloaded assets',
            'Flat impostor',
            'Climate-summary far color',
          ],
          [
            'Planet-scale weather fields',
            'CPU storms + shared cloudDensity',
            'Same field → shell or volume',
          ],
          [
            'Volumetric clouds as thicker lighting',
            'Translucent shell',
            'Half-res march; no frozen orbit bake',
          ],
        ]}
        rowTone={[undefined, 'warning', undefined, undefined, undefined]}
      />

      <Divider />

      <H2>Volumetric clouds (without freezing dynamics)</H2>
      <Stack gap={8}>
        <Text>
          Reuse cloudDensity + cyclone uniforms + weather clock as the authority.
          Change only integration: shell at distance, half-res volume near camera,
          optional sparse bricks around the view (sector-cloud pattern). Never replace
          live weather with a static voxel planet bake at practical lab distances.
        </Text>
        <Callout tone="info" title="Acceptance">
          At 0.8 AU and low orbit, storm eyes, regional clear, and moving shadows stay
          recognizable; only softness and light scattering may improve.
        </Callout>
      </Stack>

      <Divider />

      <H2>Recommended sequence</H2>
      <Table
        headers={['#', 'Lever', 'Why']}
        rows={[
          ['1', 'Spin-aware LOD rebuild gate', 'SHIPPED — tilt gate + spin angle + cooldown'],
          ['2', 'Zone-quality climate/clouds at 0.8 AU', 'Frame budget without identity loss'],
          ['3', 'Half-res volumetric clouds (shared field)', 'SC-like thickness, live dynamics'],
          ['4', 'Clipmap + detail-over-master', 'True fly-to-surface height continuity'],
          ['5', 'Far climate summary impostor', 'Orbit color matches unloaded surface'],
        ]}
      />

      <H3>Idempotent test</H3>
      <Text tone="secondary">
        ?lab=planet&au=0.8 · window.__labGlobe().lodRebuildCount · docs/fly-to-surface-research.md
      </Text>
    </Stack>
  );
}
