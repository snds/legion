// ═══════════════════════════════════════════════════════════════════
// PAINT INPUT — source-agnostic pointer normalization (Phase 2a).
//
// One layer that turns mouse / trackpad / touch / Apple Pencil into a single BrushSample stream, so the
// brush engine never touches a raw PointerEvent again and the desktop + iPad paths are ONE code path.
//
// What the web actually exposes on iPadOS Safari (researched + adversarially verified, 2026-06):
//   • pointerType 'pen' | 'touch' | 'mouse' — the router key. (iOS 13.2+.)
//   • pressure 0..1 — REAL for a pen on contact; the spec sentinel 0.5 (buttons!==0) / 0 means "no
//     sensor", so finger + mouse collapse to a default. pointerup is always pressure 0.
//   • altitudeAngle / azimuthAngle (rad) — Safari 18.2+ ONLY; pre-18.2 we derive from tiltX/tiltY.
//   • hover (pen above glass, M2+ iPads) — discriminated by buttons===0, NOT pressure.
//   • getCoalescedEvents() — Safari 18.2+; recovers the sub-frame samples merged into one 120Hz move.
// NOT exposed (never design on these): Pencil Pro barrel-roll / PointerEvent.twist (reads constant 0),
//   squeeze, double-tap, haptics, tangentialPressure, simultaneous pen+finger (WebKit serializes input).
//
// Phase 2a ships the layer with the smoothing/coalescing OFF by default (passthrough = byte-identical to
// the old PaintBrush); Phase 2b turns on pressure→intensity + arc-length resample + lazy-rope stabilize;
// Phase 2f consumes tilt. The pure helpers (resolvePressure, tiltToAltAz, passesSpacing, applyStabilize)
// carry no DOM and are unit-tested directly.
// ═══════════════════════════════════════════════════════════════════

export type PointerKind = 'pen' | 'touch' | 'mouse';

/** One normalized input sample. Canvas-relative CSS px; the brush raycasts it to galPc itself. */
export interface BrushSample {
  readonly x: number;
  readonly y: number;
  /** Always 0..1. Pen = real (curved) force; mouse/touch = the PressureModel default (never the 0.5 sentinel). */
  readonly pressure: number;
  /** Radians from the surface plane (~0 flat, ~π/2 upright). null when the device/OS can't report tilt. */
  readonly altitude: number | null;
  /** Radians, compass direction of the tip. null when unavailable. */
  readonly azimuth: number | null;
  /** API symmetry only — ALWAYS 0 for Apple Pencil on the web. Never branch on it. */
  readonly twist: number;
  /** True for a hovering pointer (buttons===0, tip above glass): drives the preview ring, commits nothing. */
  readonly hover: boolean;
  readonly kind: PointerKind;
  /** event.timeStamp — drives velocity taper + stabilizer dt. */
  readonly t: number;
}

/** A complete down→up interaction as a dense, (optionally) smoothed sample stream. */
export interface BrushStrokeSamples {
  readonly kind: PointerKind;
  readonly samples: readonly BrushSample[];
}

export interface PressureModel {
  /** Output for devices with no real sensor (mouse, and the finger 0.5 sentinel). Default 1.0 (full strength). */
  readonly defaultPressure: number;
  /** Remap raw 0..1 → effective 0..1. The single hook Phase 8's editable curve graph swaps into. */
  readonly curve: (raw: number) => number;
}

export interface PointerSourceOptions {
  /** Pressure response. Defaults to a soft gamma curve with a min-output floor. */
  readonly pressure?: Partial<PressureModel>;
  /** Use getCoalescedEvents() where available (Safari 18.2+). Default false (Phase 2a passthrough). */
  readonly coalesce?: boolean;
  /** Arc-length resample spacing in CSS px before a sample is emitted. 0 = off. Default 0 (Phase 2a). */
  readonly spacingPx?: number;
  /** Lazy-rope / EMA position smoothing 0..1 (0 = none, ~0.35 = Procreate-ish). Default 0 (Phase 2a). */
  readonly stabilize?: number;
}

/** Sinks the brush (or any consumer) implements. Hover is preview-only; a stroke is begin→sample*→end. */
export interface PointerSink {
  /** Hovering move (no button) — drives the brush preview ring. */
  onHover?: (s: BrushSample) => void;
  onStrokeBegin?: (s: BrushSample) => void;
  /** Each accepted sample along the drag — live preview / incremental work. */
  onStrokeSample?: (s: BrushSample) => void;
  /** Drag released — commit to the op-list. */
  onStrokeEnd?: (stroke: BrushStrokeSamples) => void;
  /** pointercancel (system gesture / app switch) — roll back any in-progress op. */
  onStrokeCancel?: (pointerId: number) => void;
}

const DEG2RAD = Math.PI / 180;

/** The default soft pressure response: a gentle gamma (fine control lives in the low end) + a min floor
 *  so a feather touch still deposits something. defaultPressure 1.0 ⇒ mouse/finger paint at full strength. */
export const DEFAULT_PRESSURE: PressureModel = {
  defaultPressure: 1.0,
  curve: (raw: number): number => 0.05 + 0.95 * Math.pow(Math.min(Math.max(raw, 0), 1), 1.8),
};

/** Resolve a sample's pressure. Only a PEN in the active-buttons state yields real force; the spec's 0.5
 *  "no sensor" sentinel and every non-pen device collapse to the model default (NOT 0.5 leaking through
 *  as mid-pressure). All `pointerup` events report pressure 0, so those fall through to the default too. */
export function resolvePressure(
  pointerType: string, pressure: number, buttons: number, model: PressureModel,
): number {
  if (pointerType === 'pen' && buttons !== 0 && pressure > 0 && pressure !== 0.5) {
    return model.curve(pressure);
  }
  return model.defaultPressure;
}

/** Convert tiltX/tiltY (degrees, the pre-18.2 fallback pair) → { altitude, azimuth } in radians, per the
 *  Pointer Events spec. (0,0) ⇒ upright (altitude π/2). Used only when altitudeAngle isn't natively present. */
export function tiltToAltAz(tiltXDeg: number, tiltYDeg: number): { altitude: number; azimuth: number } {
  if (tiltXDeg === 0 && tiltYDeg === 0) return { altitude: Math.PI / 2, azimuth: 0 };
  const tanX = Math.tan(tiltXDeg * DEG2RAD);
  const tanY = Math.tan(tiltYDeg * DEG2RAD);
  const altitude = Math.atan(1 / Math.hypot(tanX, tanY));
  let azimuth = Math.atan2(tanY, tanX);
  if (azimuth < 0) azimuth += 2 * Math.PI;
  return { altitude, azimuth };
}

/** Arc-length gate: accept a candidate only when it's ≥ spacingPx from the last accepted sample.
 *  spacingPx ≤ 0 (or no prior) ⇒ always accept (raw passthrough). */
export function passesSpacing(prev: BrushSample | null, candX: number, candY: number, spacingPx: number): boolean {
  if (spacingPx <= 0 || !prev) return true;
  return Math.hypot(candX - prev.x, candY - prev.y) >= spacingPx;
}

/** Lazy-rope position smoothing: pull the candidate a fraction `factor` back toward the previous sample.
 *  factor ≤ 0 (or no prior) ⇒ return the candidate unchanged (passthrough). Only x/y are smoothed. */
export function applyStabilize(prev: BrushSample | null, cand: BrushSample, factor: number): BrushSample {
  if (factor <= 0 || !prev) return cand;
  const k = Math.min(Math.max(factor, 0), 0.95);
  return { ...cand, x: cand.x + (prev.x - cand.x) * k, y: cand.y + (prev.y - cand.y) * k };
}

interface ActiveStroke {
  readonly kind: PointerKind;
  readonly samples: BrushSample[];
  lastAccepted: BrushSample | null;
}

/** Attaches pointer listeners to a canvas and emits normalized BrushSamples to a sink. The camera keeps
 *  its own right/middle/wheel listeners; this source claims only PAINT pointers (pen, touch, or left
 *  mouse), so the two coexist on the same element without forking. */
export class PointerSource {
  private readonly active = new Map<number, ActiveStroke>();
  private readonly model: PressureModel;
  private readonly coalesce: boolean;
  private readonly spacingPx: number;
  private readonly stabilize: number;
  private readonly cleanup: Array<() => void> = [];

  constructor(
    private readonly el: HTMLCanvasElement,
    opts: PointerSourceOptions,
    private readonly sink: PointerSink,
  ) {
    this.model = { ...DEFAULT_PRESSURE, ...(opts.pressure ?? {}) };
    this.coalesce = opts.coalesce ?? false;
    this.spacingPx = opts.spacingPx ?? 0;
    this.stabilize = opts.stabilize ?? 0;
    el.style.touchAction = 'none'; // hand every touch sequence to us (kills iOS pinch/double-tap-zoom on the canvas)

    const onDown = (e: PointerEvent): void => {
      if (!isPaintDown(e)) return; // right/middle mouse → the camera owns it
      try { el.setPointerCapture(e.pointerId); } catch { /* best-effort: synthetic / already-released pointer */ }
      const s = this.toSample(e, false);
      this.active.set(e.pointerId, { kind: s.kind, samples: [s], lastAccepted: s });
      this.sink.onStrokeBegin?.(s);
    };

    const onMove = (e: PointerEvent): void => {
      const buf = this.active.get(e.pointerId);
      if (!buf) { // not drawing → a hover move (only bother if someone's listening)
        if (this.sink.onHover && e.buttons === 0) this.sink.onHover(this.toSample(e, true));
        return;
      }
      const raw = this.coalesce && typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
      for (const ce of raw) {
        if (!passesSpacing(buf.lastAccepted, ce.clientX, ce.clientY, this.spacingPx)) continue;
        const s = applyStabilize(buf.lastAccepted, this.toSample(ce, false), this.stabilize);
        buf.samples.push(s);
        buf.lastAccepted = s;
        this.sink.onStrokeSample?.(s);
      }
    };

    const onUp = (e: PointerEvent): void => {
      const buf = this.active.get(e.pointerId);
      if (!buf) return;
      this.active.delete(e.pointerId);
      this.sink.onStrokeEnd?.({ kind: buf.kind, samples: buf.samples });
    };

    const onCancel = (e: PointerEvent): void => {
      if (this.active.delete(e.pointerId)) this.sink.onStrokeCancel?.(e.pointerId);
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    this.cleanup.push(
      () => el.removeEventListener('pointerdown', onDown),
      () => el.removeEventListener('pointermove', onMove),
      () => window.removeEventListener('pointerup', onUp),
      () => el.removeEventListener('pointercancel', onCancel),
    );
  }

  private toSample(e: PointerEvent | { clientX: number; clientY: number; pointerType?: string; pressure?: number; buttons?: number; tiltX?: number; tiltY?: number; timeStamp?: number } & Partial<{ altitudeAngle: number; azimuthAngle: number }>, hover: boolean): BrushSample {
    const rect = this.el.getBoundingClientRect();
    const pointerType = e.pointerType ?? 'mouse';
    let altitude: number | null = null;
    let azimuth: number | null = null;
    if (typeof e.altitudeAngle === 'number') { // Safari 18.2+ native
      altitude = e.altitudeAngle;
      azimuth = typeof e.azimuthAngle === 'number' ? e.azimuthAngle : null;
    } else if (pointerType === 'pen' && (e.tiltX || e.tiltY)) { // pre-18.2 fallback
      const aa = tiltToAltAz(e.tiltX ?? 0, e.tiltY ?? 0);
      altitude = aa.altitude;
      azimuth = aa.azimuth;
    }
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      pressure: resolvePressure(pointerType, e.pressure ?? 0, e.buttons ?? 0, this.model),
      altitude,
      azimuth,
      twist: 0,
      hover,
      kind: (pointerType as PointerKind) || 'mouse',
      t: e.timeStamp ?? 0,
    };
  }

  dispose(): void { for (const fn of this.cleanup) fn(); }
}

/** A PAINT pointer-down: a pen tip, a touch, or the LEFT mouse button. Right/middle belong to the camera. */
function isPaintDown(e: PointerEvent): boolean {
  return e.pointerType === 'pen' || e.pointerType === 'touch' || (e.pointerType === 'mouse' && e.button === 0);
}
