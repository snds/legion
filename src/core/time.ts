// ═══════════════════════════════════════════════════════════════════
// MASTER CLOCK — Ephemeris Time (et) and calendar conversion
//
// The single authoritative time value is `et`: TDB seconds past the J2000.0
// epoch (2000-01-01 12:00 TT), the SPICE / OpenSpace / KSP convention. It is a
// float64, so 1 ULP ≈ 0.95 µs even centuries from the epoch — far finer than any
// sim or render need. All celestial-body positions are functions of et, which is
// what makes arbitrary time-warp (including negative) stable: position = f(et).
//
// Legion runs on a single canonical time unit: SECONDS. `Game.data.gameTime` is
// elapsed game-seconds since GAME_EPOCH; et = GAME_EPOCH_ET + gameTime. Mean
// motions are rad/second, time-compression tables are game-seconds per real
// second, and planet rotation/transit/AI cadences are all seconds. Never store
// the master clock in days or float32.
//
// See docs/space-engine-techniques-for-legion.md §4.4 (Time system).
// ═══════════════════════════════════════════════════════════════════

export const SECONDS_PER_DAY = 86400;
export const DAYS_PER_JULIAN_YEAR = 365.25;
export const SECONDS_PER_JULIAN_YEAR = DAYS_PER_JULIAN_YEAR * SECONDS_PER_DAY; // 31_557_600
export const SECONDS_PER_JULIAN_CENTURY = 3.15576e9; // 36525 · 86400

/** Julian Date of the J2000.0 epoch (2000-01-01 12:00 TT). */
export const J2000_JD = 2451545.0;

/**
 * TT − UTC offset in seconds. TT = TAI + 32.184 s exactly; 37 leap seconds have
 * been frozen since 2017 ⇒ TT − UTC ≈ 69.184 s. For a far-future fictional date
 * the future leap-second count is unknowable, so we treat this as a constant —
 * cosmetic at calendar resolution. The periodic TDB − TT term (≈1.7 ms) is ignored.
 */
export const TT_MINUS_UTC = 69.184;

// ── Calendar ↔ Julian Date (Meeus, Astronomical Algorithms, ch. 7) ──

/** Gregorian calendar date (proleptic) → Julian Date. Month 1–12, day may be fractional. */
export function gregorianToJD(
  year: number, month: number, day: number,
  hour = 0, minute = 0, second = 0,
): number {
  let y = year;
  let m = month;
  if (m <= 2) { y -= 1; m += 12; }
  const A = Math.floor(y / 100);
  const B = 2 - A + Math.floor(A / 4); // Gregorian correction
  const dayFrac = day + (hour + (minute + second / 60) / 60) / 24;
  return (
    Math.floor(365.25 * (y + 4716)) +
    Math.floor(30.6001 * (m + 1)) +
    dayFrac + B - 1524.5
  );
}

export interface CalendarDate {
  year: number; month: number; day: number;     // day is the integer day of month
  hour: number; minute: number; second: number;
}

/** Julian Date → Gregorian calendar date (Meeus ch. 7). */
export function jdToGregorian(jd: number): CalendarDate {
  const z = Math.floor(jd + 0.5);
  const f = jd + 0.5 - z;
  let a = z;
  if (z >= 2299161) {
    const alpha = Math.floor((z - 1867216.25) / 36524.25);
    a = z + 1 + alpha - Math.floor(alpha / 4);
  }
  const b = a + 1524;
  const c = Math.floor((b - 122.1) / 365.25);
  const d = Math.floor(365.25 * c);
  const e = Math.floor((b - d) / 30.6001);
  const dayWithFrac = b - d - Math.floor(30.6001 * e) + f;
  const day = Math.floor(dayWithFrac);
  const month = e < 14 ? e - 1 : e - 13;
  const year = month > 2 ? c - 4716 : c - 4715;

  let rem = (dayWithFrac - day) * 24;
  const hour = Math.floor(rem);
  rem = (rem - hour) * 60;
  const minute = Math.floor(rem);
  const second = Math.max(0, (rem - minute) * 60);
  return { year, month, day, hour, minute, second };
}

// ── et conversions ──

/** et (TDB seconds past J2000) → Julian Date. */
export function etToJD(et: number): number {
  return J2000_JD + et / SECONDS_PER_DAY;
}

/** Julian centuries past J2000 — the argument to VSOP/JPL secular series. */
export function centuriesSinceJ2000(et: number): number {
  return et / SECONDS_PER_JULIAN_CENTURY;
}

/** et → Gregorian calendar, applying the TT→UTC offset for civil display. */
export function etToCalendar(et: number, asUTC = true): CalendarDate {
  return jdToGregorian(etToJD(et - (asUTC ? TT_MINUS_UTC : 0)));
}

// ── Game epoch ──
// Narrative start: 2347-01-01 00:00 (preserves the prior HUD "YEAR 2347").
// JPL approximate elements (3000 BC–3000 AD table) cover this date.
export const GAME_EPOCH_CALENDAR = { year: 2347, month: 1, day: 1 } as const;
export const GAME_EPOCH_JD = gregorianToJD(
  GAME_EPOCH_CALENDAR.year, GAME_EPOCH_CALENDAR.month, GAME_EPOCH_CALENDAR.day,
);
/** et at game start (gameTime = 0). et = GAME_EPOCH_ET + gameTime. */
export const GAME_EPOCH_ET = (GAME_EPOCH_JD - J2000_JD) * SECONDS_PER_DAY;

/** Convert elapsed game-seconds to ephemeris time. */
export function gameTimeToEt(gameSeconds: number): number {
  return GAME_EPOCH_ET + gameSeconds;
}

// ── HUD formatting ──

/** Day-of-year (1-based) for an et. */
export function dayOfYear(et: number): number {
  const cal = etToCalendar(et);
  const janFirstJD = gregorianToJD(cal.year, 1, 1);
  return Math.floor(etToJD(et - TT_MINUS_UTC) - janFirstJD) + 1;
}

/**
 * "DAY ddd — YEAR yyyy" from elapsed game-seconds, computed from the real
 * Gregorian calendar (leap years included) via the et master clock.
 */
export function formatGameClock(gameSeconds: number): string {
  const et = gameTimeToEt(gameSeconds);
  const cal = etToCalendar(et);
  const doy = dayOfYear(et);
  return `DAY ${String(doy).padStart(3, '0')} — YEAR ${cal.year}`;
}
