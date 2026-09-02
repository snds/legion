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
 * Continuum rocky archetype QA — pass 2 after lab-sun hide + dusty atmos.
 * Captures: 2026-08-07 accept --type rocky (Playwright Chromium, Vite :5175).
 */
export default function ContinuumRockyQa() {
  return (
    <Stack gap={24} style={{ maxWidth: 980, margin: '0 auto', padding: 24 }}>
      <Stack gap={8}>
        <H1>Continuum rocky QA — pass 2</H1>
        <Text tone="secondary">
          lab-ideal + PRESETS.rocky · stills refs/continuum/stills/continuum-rocky-*.png · harness scripts/legion-accept.mjs
        </Text>
        <Row gap={8} style={{ flexWrap: 'wrap' }}>
          <Pill tone="warning">Archetype unsigned</Pill>
          <Pill tone="success">Lab-sun hidden</Pill>
          <Pill tone="success">Dusty atmos on</Pill>
          <Pill tone="success">Night ≠ day</Pill>
          <Pill tone="success">medianTex 96 @ 0.3</Pill>
        </Row>
      </Stack>

      <Callout tone="success" title="Pass 2 blockers cleared">
        Accept hides lab-sun (`?accept` + setLabPropsVisible). Rocky now boots with
        thin dusty atmos (density 0.38, warm tint, blueBias-gated so limb stays ochre).
        Day disc no longer shows the cream concentric mesh.
      </Callout>

      <H2>Default knobs (pass 2)</H2>
      <Grid columns={4} gap={16}>
        <Stat value="true" label="hasAtmosphere" tone="success" />
        <Stat value="0.38" label="atmosphereDensity" />
        <Stat value="0.08" label="cloudCover" />
        <Stat value="0.045" label="displacement" />
      </Grid>
      <Text tone="secondary">
        Exemplar: super-earth · au 1.6 · R 1.4 Re · insolation 0.4 · craters 0.5 · nightLights 0
      </Text>

      <H2>Capture numbers</H2>
      <Table
        headers={['Pose', 'medianTex', 'Center mean', 'Read']}
        rows={[
          ['0.8 day', '160', '~175', 'Warm dusty disc + thin limb; no lab-sun'],
          ['0.8 night', '160', '~36', 'Dark disc — night pose holds'],
          ['0.8 day noclouds', '160', '~175', 'Ochre patches; crater/ridge language'],
          ['0.3 surface', '96', '~119', 'F6 floor met; warmer than pass 1'],
          ['0.6 terminator', '96', '~23', 'Side-light; seams still visible'],
        ]}
      />

      <H2>Ocean checklist on rocky</H2>
      <Table
        headers={['Ocean fix', 'Rocky status', 'Next']}
        rows={[
          ['F2 Rayleigh limb', 'Pass — warm dust / blueBias', 'Tune density vs SE'],
          ['F3 night pose', 'Pass', 'Keep'],
          ['F6 close tex ≥96', 'Pass', 'Keep'],
          ['F8 side-light relief', 'Partial under front day', 'Prefer terminator look pose'],
          ['F9 chrome + lab-sun', 'Pass', 'Keep accept hide'],
          ['Cube seams / limb', 'Open at terminator', 'Shared Continuum LOD work'],
        ]}
      />

      <H2>Harness readiness</H2>
      <Table
        headers={['Target', 'Command', 'Artifacts']}
        rows={[
          ['Planet Continuum', 'accept:continuum --type rocky|all', 'refs/continuum/stills/'],
          ['All archetypes', 'accept:archetypes', 'continuum-{type}-*.png'],
          ['Star / BH / nebula / galaxy', 'accept:demos or --lab star', 'refs/demos/<id>/stills/'],
          ['Unified entry', 'accept:legion', 'planet + demo modes'],
        ]}
      />
      <Text tone="secondary">
        Star/blackhole/nebula labs are available:false; harness maps --lab star|blackhole|nebula to review demos until labs ship.
      </Text>

      <H2>Still open for rocky identity</H2>
      <Table
        headers={['#', 'Item', 'Why']}
        rows={[
          ['1', 'Stronger ochre/rust albedo', 'Still pale under front light'],
          ['2', 'Terminator as default look pose', 'Front day flattens microrelief'],
          ['3', 'Cube-seam / faceted limb', 'Exposed at terminator'],
          ['4', 'Close-AU land AA', 'Jagged limb remnants @ 0.3'],
        ]}
      />

      <Divider />
      <Text tone="secondary">
        Notes: docs/superpowers/specs/2026-08-07-continuum-rocky-qa-notes.md
      </Text>
    </Stack>
  );
}
