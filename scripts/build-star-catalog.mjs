// ═══════════════════════════════════════════════════════════════════
// BUILD STAR CATALOG — HYG v3.8 → compact binary for the real sky.
//
// Downloads the HYG v3.8 database (astronexus, CC BY-SA 4.0), filters to
// the resolved/bright stars (apparent mag ≤ MAG_CUT — fainter stars are the
// diffuse Milky Way already supplied by the baked galaxy backdrop, so
// including them would double-count), rotates equatorial → galactic so the
// real Milky Way band aligns with the rendered galactic disc, maps onto the
// game's Y-up / galactic-plane-in-XZ axes, and packs:
//
//   per star, 20 bytes, little-endian:  f32 x, f32 y, f32 z (parsecs),
//                                       f32 mag (apparent), f32 ci (B−V)
//
// Output: public/star-catalog-v1.bin  (+ public/star-catalog-NOTICE.txt).
// Run with:  node scripts/build-star-catalog.mjs
// The .bin is committed so deploys need no network; re-run to regenerate.
// ═══════════════════════════════════════════════════════════════════

import { gunzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const CACHE = join(__dir, '.cache', 'hyg_v38.csv.gz');
const SRC_URL = 'https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/v3/hyg_v38.csv.gz';
const OUT_BIN = join(__dir, '..', 'public', 'star-catalog-v1.bin');
const OUT_NAV = join(__dir, '..', 'public', 'star-systems-v1.json');
const OUT_NOTICE = join(__dir, '..', 'public', 'star-catalog-NOTICE.txt');

const MAG_CUT = 7.5;      // apparent magnitude; ~naked-eye + binocular sky (background field)
const NAV_DIST_PC = 25;   // navigable nearby catalogue: real named systems within ~81.6 ly,
                          // NO magnitude cut (so the faint-but-common nearby M dwarfs are kept)
const PC_TO_LY = 3.2615638;

// J2000 equatorial → galactic rotation (rows). galactic = R · equatorial.
const R = [
  [-0.0548755604, -0.8734370902, -0.4838350155],
  [+0.4941094279, -0.4448296300, +0.7469822445],
  [-0.8676661490, -0.1980763734, +0.4559837762],
];

// Minimal CSV line parser (handles double-quoted fields).
function parseLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

async function main() {
  if (!existsSync(CACHE)) {
    mkdirSync(dirname(CACHE), { recursive: true });
    console.log('[stars] downloading HYG v3.8 …');
    const res = await fetch(SRC_URL);
    if (!res.ok) throw new Error(`download failed: ${res.status}`);
    writeFileSync(CACHE, Buffer.from(await res.arrayBuffer()));
  }
  console.log('[stars] gunzip + parse …');
  const csv = gunzipSync(readFileSync(CACHE)).toString('utf8');
  const lines = csv.split('\n');
  const head = parseLine(lines[0]);
  const col = (name) => head.indexOf(name);
  const iDist = col('dist'), iMag = col('mag'), iCi = col('ci');
  const iX = col('x'), iY = col('y'), iZ = col('z');
  // Identity + classification columns HYG already carries (previously dropped).
  const iId = col('id'), iProper = col('proper'), iHip = col('hip'), iHd = col('hd');
  const iGl = col('gl'), iBf = col('bf'), iSpect = col('spect'), iCon = col('con');
  const g = (f, i) => (i >= 0 ? (f[i] ?? '').trim() : '');

  const recs = [];   // background field: mag-filtered, f32-packed (unchanged format)
  const nav = [];    // navigable nearby catalogue: real named systems within NAV_DIST_PC
  for (let li = 1; li < lines.length; li++) {
    const line = lines[li];
    if (!line) continue;
    const f = parseLine(line);
    const dist = parseFloat(f[iDist]);
    if (!isFinite(dist) || dist <= 0 || dist >= 100000) continue; // skip Sol + distance sentinels
    const ex = parseFloat(f[iX]), ey = parseFloat(f[iY]), ez = parseFloat(f[iZ]);
    if (!isFinite(ex) || !isFinite(ey) || !isFinite(ez)) continue;
    const ci = parseFloat(f[iCi]);
    const mag = parseFloat(f[iMag]);
    // equatorial → galactic
    const gx = R[0][0] * ex + R[0][1] * ey + R[0][2] * ez;
    const gy = R[1][0] * ex + R[1][1] * ey + R[1][2] * ez;
    const gz = R[2][0] * ex + R[2][1] * ey + R[2][2] * ez;
    // game axes: galactic plane (gx,gy) → XZ, NGP (gz) → +Y
    const px = gx, py = gz, pz = gy;

    // NAVIGABLE nearby catalogue (NO mag cut — keep faint nearby M dwarfs, the
    // commonest planet hosts). Real name + designations + spectral type, parsecs.
    if (dist <= NAV_DIST_PC) {
      const gl = g(f, iGl), hd = g(f, iHd), hip = g(f, iHip), id = g(f, iId);
      const proper = g(f, iProper), bf = g(f, iBf);
      // HYG's `gl` already carries its prefix (e.g. "Gl 551", "NN 3018"); HD/HIP are bare numbers.
      const desigs = [gl, hd && `HD ${hd}`, hip && `HIP ${hip}`].filter(Boolean);
      const name = proper || bf || desigs[0] || `HYG ${id}`;
      nav.push({
        n: name,
        d: desigs.join(' · '),
        s: g(f, iSpect),
        con: g(f, iCon),
        ly: +(dist * PC_TO_LY).toFixed(2),
        x: +px.toFixed(3), y: +py.toFixed(3), z: +pz.toFixed(3), // parsecs, game axes
        m: +(isFinite(mag) ? mag : 99).toFixed(2),
        ci: +(isFinite(ci) ? ci : 0.6).toFixed(3),
      });
    }

    // BACKGROUND field (mag-limited; format unchanged).
    if (!isFinite(mag) || mag > MAG_CUT) continue;
    recs.push([px, py, pz, mag, isFinite(ci) ? ci : 0.6]);
  }

  recs.sort((a, b) => a[3] - b[3]); // brightest first → drawRange LOD friendly
  const buf = new Float32Array(recs.length * 5);
  recs.forEach((r, i) => buf.set(r, i * 5));
  mkdirSync(dirname(OUT_BIN), { recursive: true });
  writeFileSync(OUT_BIN, Buffer.from(buf.buffer));

  nav.sort((a, b) => a.ly - b.ly); // nearest first
  writeFileSync(OUT_NAV, JSON.stringify({
    unit: 'parsec',
    axes: 'game (galactic plane in XZ, NGP +Y)',
    distCutoffPc: NAV_DIST_PC,
    count: nav.length,
    stars: nav,
  }));

  writeFileSync(OUT_NOTICE,
    'star-catalog-v1.bin and star-systems-v1.json are derived from the HYG\n' +
    'Database v3.8 (https://github.com/astronexus/HYG-Database) by David Nash /\n' +
    'astronexus, licensed CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/).\n' +
    `star-catalog-v1.bin: apparent magnitude ≤ ${MAG_CUT}, rotated to galactic\n` +
    'coordinates, packed as f32 [x,y,z(pc), mag, B−V] per star (little-endian).\n' +
    `star-systems-v1.json: the navigable nearby catalogue, all stars within\n` +
    `${NAV_DIST_PC} pc (no magnitude cut), with proper name / catalogue designations\n` +
    '(Gliese/HD/HIP) / spectral type / constellation / distance / position.\n');
  console.log(`[stars] wrote ${recs.length} background stars → ${OUT_BIN} (${(buf.byteLength / 1024) | 0} KB)`);
  console.log(`[stars] wrote ${nav.length} navigable systems ≤ ${NAV_DIST_PC} pc → ${OUT_NAV}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
