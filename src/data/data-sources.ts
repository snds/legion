// ═══════════════════════════════════════════════════════════════════
// DATA SOURCES — the attribution registry (single source of truth).
// Every external dataset / image Legion ships is recorded here with its
// license and usage-permission TYPE; the Settings panel renders this as
// the in-app CREDITS section (several of these licenses REQUIRE visible
// attribution). The public/*-NOTICE.txt files restate the same facts for
// anyone redistributing the built assets.
//
// Permission types are deliberately coarse — they answer the one question
// that matters at ship time: "what does using this data oblige us to do?"
// ═══════════════════════════════════════════════════════════════════

export type UsagePermission =
  | 'public-domain'          // no obligations (e.g. US Government work)
  | 'attribution'            // free use, credit required
  | 'attribution-sharealike' // credit required + derived DATA stays under the same license
  | 'non-commercial'         // credit required + commercial use PROHIBITED
  | 'unverified';            // provenance unconfirmed — resolve before any public release

/** Short badge text shown next to each source in the Credits UI. */
export const PERMISSION_LABEL: Record<UsagePermission, string> = {
  'public-domain':          'PUBLIC DOMAIN',
  'attribution':            'CREDIT REQUIRED',
  'attribution-sharealike': 'CREDIT + SHARE-ALIKE',
  'non-commercial':         'NON-COMMERCIAL ONLY',
  'unverified':             'UNVERIFIED',
};

export interface DataSource {
  name: string;
  provider: string;
  url: string;
  license: string;     // human-readable license name
  permission: UsagePermission;
  creditLine: string;  // the exact attribution line to display
  usedFor: string;     // what Legion derives from it
  /** false = evaluated and documented here, but NOT in the build. */
  shipped: boolean;
  note?: string;
}

export const DATA_SOURCES: DataSource[] = [
  {
    name: 'HYG Database v3.8',
    provider: 'David Nash / Astronexus',
    url: 'https://www.astronexus.com/projects/hyg',
    license: 'CC BY-SA 4.0',
    permission: 'attribution-sharealike',
    creditLine: 'Star catalogue derived from the HYG Database (astronexus.com) by David Nash, CC BY-SA 4.0.',
    usedFor: 'Sky star field (24,940 stars) + the navigable nearby-systems catalogue (all stars within 25 pc).',
    shipped: true,
  },
  {
    name: 'NASA Exoplanet Archive',
    provider: 'Caltech/IPAC, under contract with NASA',
    url: 'https://exoplanetarchive.ipac.caltech.edu',
    license: 'US Government work — public domain',
    permission: 'public-domain',
    creditLine: 'Exoplanet data from the NASA Exoplanet Archive, operated by Caltech/IPAC under contract with NASA.',
    usedFor: 'Real confirmed planets for host stars within 30 pc (exoplanets-v1.json).',
    shipped: true,
  },
  {
    name: 'Deep Star Maps 2020',
    provider: 'Ernie Wright, NASA/GSFC Scientific Visualization Studio',
    url: 'https://svs.gsfc.nasa.gov/4851',
    license: 'NASA SVS — public domain',
    permission: 'public-domain',
    creditLine: 'Milky Way sky backdrop from NASA/GSFC SVS "Deep Star Maps 2020" by Ernie Wright (Hipparcos-2, Tycho-2, Gaia DR2).',
    usedFor: 'System-tier photographic sky backdrop (milkyway-galactic-4k.jpg).',
    shipped: true,
  },
  {
    name: 'Milky Way face-on concept (ssc2008-10a)',
    provider: 'NASA/JPL-Caltech / R. Hurt (SSC/Caltech)',
    url: 'https://www.spitzer.caltech.edu/image/ssc2008-10a-the-milky-way',
    license: 'NASA/JPL-Caltech imagery — free with credit',
    permission: 'attribution',
    creditLine: 'Galaxy structure reference: NASA/JPL-Caltech / R. Hurt (SSC/Caltech).',
    usedFor: 'Luminance map driving in-plane star density for the galaxy build-out.',
    shipped: true,
  },
  {
    name: 'Keplerian planetary ephemerides',
    provider: 'E.M. Standish & J.G. Williams, NASA/JPL',
    url: 'https://ssd.jpl.nasa.gov/planets/approx_pos.html',
    license: 'US Government work — public domain',
    permission: 'public-domain',
    creditLine: 'Sol planetary orbits from JPL approximate Keplerian elements (Standish & Williams).',
    usedFor: 'Real orbital elements for the eight Sol planets at the game epoch.',
    shipped: true,
  },
  // Sol texture provenance was verified forensically on 2026-07-10 (embedded
  // PDS captions/XMP + MD5 + pixel correlation against candidate sources) —
  // full per-file table in public/textures/sol/NOTICE.txt.
  {
    name: 'Solar System Scope planet textures',
    provider: 'INOVE / Solar System Scope',
    url: 'https://www.solarsystemscope.com/textures/',
    license: 'CC BY 4.0',
    permission: 'attribution',
    creditLine: 'Planet, Moon and Saturn-ring textures by Solar System Scope (solarsystemscope.com), CC BY 4.0.',
    usedFor: 'mercury/venus/earth/mars/jupiter/saturn/uranus/neptune/moon .jpg + saturn_ring_alpha.png '
        + '(10 files). Verified: ring byte-identical (MD5); the rest correlate ≥ 0.997 (re-grade/upscale only).',
    shipped: true,
  },
  {
    name: 'Voyager–Galileo global mosaics (Galilean moons)',
    provider: 'USGS Astrogeology Science Center · NASA/JPL',
    url: 'https://astrogeology.usgs.gov/search',
    license: 'US Government work — public domain',
    permission: 'public-domain',
    creditLine: 'Io, Europa, Ganymede and Callisto maps: USGS Astrogeology Science Center '
        + 'Voyager–Galileo SSI global mosaics (NASA/JPL).',
    usedFor: 'io/europa/ganymede/callisto .jpg (4 files). Verified: Europa + Callisto exactly match the '
        + 'USGS 1024-px browse products (corr 1.000); Io carries the Galileo PDS caption; Ganymede is an '
        + 'older edition of the same mosaic (corr 0.965).',
    shipped: true,
  },
  {
    name: 'Titan, Phobos & Deimos maps',
    provider: 'UNKNOWN — real-mission-data derivatives, author unidentified',
    url: '',
    license: 'Unverified',
    permission: 'unverified',
    creditLine: 'Titan/Phobos/Deimos maps — authorship under verification.',
    usedFor: 'titan.jpg, phobos.jpg, deimos.jpg (3 files).',
    shipped: true,
    note: 'Content derives from real mission data (Cassini for Titan; Viking-era relief for the Mars '
        + 'moons) but the specific map authors were not identified; the likely candidates (Albers, '
        + 'DeviantArt map makers) publish NON-COMMERCIAL terms. Tested and ruled out: Solar System '
        + 'Scope, JHT Planet Pixel Emporium, USGS Cassini ISS mosaic, Stooke PDS photomosaics. '
        + 'REPLACE before any public release — public-domain drop-ins: USGS Cassini ISS global mosaic '
        + '(Titan), USGS Viking/Mars-Express mosaics (Phobos/Deimos) — or generate procedurally.',
  },
  {
    name: 'ESA Gaia DR3',
    provider: 'ESA / Gaia Data Processing and Analysis Consortium (DPAC)',
    url: 'https://www.cosmos.esa.int/web/gaia-users/license',
    license: 'CC BY-NC 3.0 IGO',
    permission: 'non-commercial',
    creditLine: 'This work has made use of data from the European Space Agency (ESA) mission Gaia, '
        + 'processed by the Gaia Data Processing and Analysis Consortium (DPAC).',
    usedFor: 'NOT SHIPPED. Evaluated for the star catalogue; the NC license would gate a commercial '
        + 'release, so the HYG database (CC BY-SA) is used instead.',
    shipped: false,
    note: 'If DR3 columns are ever added, this entry flips to shipped and the game becomes '
        + 'non-commercial-only absent separate ESA permission.',
  },
];
