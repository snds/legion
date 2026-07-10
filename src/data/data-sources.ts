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
  {
    name: 'Solar-system texture maps',
    provider: 'UNKNOWN — present since initial import',
    url: '',
    license: 'Unverified',
    permission: 'unverified',
    creditLine: 'Planetary surface maps — provenance under verification.',
    usedFor: 'Sol planet/moon surface textures (public/textures/sol/*).',
    shipped: true,
    note: 'No provenance was recorded when these were added. Confirm the original source '
        + '(NASA/USGS vs. third-party, e.g. Solar System Scope CC BY 4.0) before any public release.',
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
