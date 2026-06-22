// ═══════════════════════════════════════════════════════════════════
// BUILD EXOPLANETS — NASA Exoplanet Archive → real planets for nearby hosts.
//
// Pulls the confirmed-planet composite parameters (pscomppars) for host stars
// within 30 pc from the NASA Exoplanet Archive TAP service, groups by host,
// and writes a compact sidecar keyed by cross-match designations (HIP / HD /
// Gliese / proper name). At runtime the navigable catalogue (star-systems.ts)
// resolves a real system from this where a host matches, overriding the
// generated one (system-gen.ts). NASA data is a US-government work — public
// domain — so it is commercial-safe (see workspace memory
// decision-commercial-data-licensing).
//
// Output: public/exoplanets-v1.json  (+ appends to star-catalog-NOTICE.txt).
// Run with:  node scripts/build-exoplanets.mjs   (needs network; commit the JSON)
// ═══════════════════════════════════════════════════════════════════

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dir, '..', 'public', 'exoplanets-v1.json');
const NOTICE = join(__dir, '..', 'public', 'star-catalog-NOTICE.txt');
const DIST_PC = 30;

const TAP = 'https://exoplanetarchive.ipac.caltech.edu/TAP/sync';
const ADQL = `select pl_name,hostname,hd_name,hip_name,pl_rade,pl_bmasse,pl_orbper,pl_orbsmax,discoverymethod ` +
  `from pscomppars where sy_dist < ${DIST_PC} order by hostname, pl_orbsmax`;

// Minimal CSV parser (handles double-quoted fields).
function parseLine(line) {
  const out = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += ch; }
    else if (ch === '"') inQ = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur); return out;
}

// Cross-match keys — MUST stay in sync with the catalogue side (exoplanets.ts).
//   hip:<digits> · hd:<digits> · gj:<number+optional ab, lowercased, spaces removed> · name:<lower, single-spaced>
function hostKeys(hostname, hd, hip) {
  const out = new Set();
  const dig = (s) => (s || '').replace(/\D/g, '');
  if (dig(hip)) out.add('hip:' + dig(hip));
  if (dig(hd)) out.add('hd:' + dig(hd));
  const h = (hostname || '').trim();
  const gj = h.match(/^(?:GJ|Gl|Gliese|NN)\s*([\dAB.]+)/i);
  if (gj) out.add('gj:' + gj[1].toLowerCase().replace(/\s+/g, ''));
  const hd2 = h.match(/^HD\s*(\d+)/i); if (hd2) out.add('hd:' + hd2[1]);
  const hip2 = h.match(/^HIP\s*(\d+)/i); if (hip2) out.add('hip:' + hip2[1]);
  if (h) out.add('name:' + h.toLowerCase().replace(/\s+/g, ' '));
  return [...out];
}

async function main() {
  console.log('[exo] querying NASA Exoplanet Archive TAP …');
  const url = `${TAP}?format=csv&query=${encodeURIComponent(ADQL)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TAP query failed: ${res.status}`);
  const csv = await res.text();
  const lines = csv.split('\n').filter((l) => l.length);
  const head = parseLine(lines[0]);
  const c = (n) => head.indexOf(n);
  const iName = c('pl_name'), iHost = c('hostname'), iHd = c('hd_name'), iHip = c('hip_name');
  const iRade = c('pl_rade'), iMasse = c('pl_bmasse'), iPer = c('pl_orbper'), iSmax = c('pl_orbsmax'), iMethod = c('discoverymethod');

  const byHost = new Map();
  for (let li = 1; li < lines.length; li++) {
    const f = parseLine(lines[li]);
    const host = (f[iHost] || '').trim();
    if (!host) continue;
    if (!byHost.has(host)) byHost.set(host, { name: host, hd: f[iHd], hip: f[iHip], planets: [] });
    const num = (x) => { const v = parseFloat(x); return isFinite(v) ? v : null; };
    // Planet short letter ("Proxima Cen b" → "b", "HD 95735 c" → "c").
    const pl = (f[iName] || '').trim();
    const lm = pl.match(/\s([A-Za-z](?:\s?\d)?)$/);
    const letter = lm ? lm[1] : (pl.startsWith(host) ? pl.slice(host.length).trim() : pl);
    byHost.get(host).planets.push({
      n: letter || pl,
      rade: num(f[iRade]), masse: num(f[iMasse]),
      per: num(f[iPer]), smax: num(f[iSmax]),
      method: (f[iMethod] || '').trim(),
    });
  }

  const hosts = [...byHost.values()].map((h) => ({
    name: h.name,
    keys: hostKeys(h.name, h.hd, h.hip),
    planets: h.planets,
  }));
  const planetCount = hosts.reduce((a, h) => a + h.planets.length, 0);

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({
    source: 'NASA Exoplanet Archive (pscomppars)',
    license: 'public domain (US Government work)',
    distCutoffPc: DIST_PC,
    hostCount: hosts.length,
    planetCount,
    hosts,
  }));

  // Append archive attribution to the NOTICE (idempotent).
  const tag = 'NASA Exoplanet Archive';
  const prev = existsSync(NOTICE) ? readFileSync(NOTICE, 'utf8') : '';
  if (!prev.includes(tag)) {
    writeFileSync(NOTICE, prev +
      `\nexoplanets-v1.json: real confirmed planets for host stars within ${DIST_PC} pc from the\n` +
      'NASA Exoplanet Archive (https://exoplanetarchive.ipac.caltech.edu), operated by\n' +
      'Caltech/IPAC under contract with NASA. US Government work — public domain.\n');
  }
  console.log(`[exo] wrote ${planetCount} real planets across ${hosts.length} hosts → ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
