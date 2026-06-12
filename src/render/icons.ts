// ═══════════════════════════════════════════════════════════════════
// ICON FACTORY — Canvas-Rendered Billboard Markers
// Homeworld-style: clean geometric shapes on transparent background.
// Canvas renders at 4× logical resolution for crisp close-up display.
//
// Texture is generated once per icon type and reused across all
// entities sharing that appearance. The billboard always faces camera.
// ═══════════════════════════════════════════════════════════════════

import {
  CanvasTexture, SpriteMaterial, Sprite,
  LinearMipmapLinearFilter, SRGBColorSpace,
  type Texture,
} from 'three';

let maxAnisotropy = 16;

export function setMaxAnisotropy(val: number): void {
  maxAnisotropy = val;
}

// ── Icon Types ───────────────────────────────────────────────────

export type IconShape = 'diamond' | 'circle' | 'triangle' | 'square' | 'hex' | 'star';

export type IconInternal = 'station' | 'factory' | 'comms' | 'mine';

export interface IconConfig {
  shape: IconShape;
  color: string;
  label?: string;
  sublabel?: string;
  size?: number;       // logical size in pixels (default 160)
  outlineWidth?: number;
  glowColor?: string;
  /** Internal glyph anatomy. Only applies to 'hex' for now. */
  internal?: IconInternal;
  /** Capacity 0..1 — drives a 270° ring inside the hex. Hex only. */
  capacity?: number;
  /** Number of lit vertex pips (0..6). Hex only. */
  pips?: number;
}

// ── Texture Cache ────────────────────────────────────────────────

const textureCache = new Map<string, Texture>();

function cacheKey(cfg: IconConfig): string {
  // Labels are NOT baked into the texture (they're standalone child sprites),
  // so the cache key excludes them — every entity of a class shares one texture.
  return [
    cfg.shape, cfg.color,
    cfg.size ?? 160, cfg.internal ?? '', cfg.capacity ?? '', cfg.pips ?? '',
  ].join('|');
}

// ── Canvas Rendering ─────────────────────────────────────────────

function renderIconTexture(cfg: IconConfig): Texture {
  const key = cacheKey(cfg);
  const cached = textureCache.get(key);
  if (cached) return cached;

  const logicalSize = cfg.size ?? 160;
  const SCALE = 4; // 4× supersampling
  const W = logicalSize * SCALE;
  const H = logicalSize * SCALE; // square — labels live in standalone sprites

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  const cx = W / 2;
  const iconR = (logicalSize * 0.35) * SCALE;
  const iconCy = H * 0.5;
  // Stroke floor: at the 28 screen-px display target, a 160-logical canvas
  // shows 1 logical px as 0.175 screen px — the old 2-logical outline mipped
  // to a ~0.35px grey smear (the EVE 'Iconocalypse' sub-pixel trap, docs/
  // zoom-overlay-patterns.md). ≥10 logical ⇒ ≥1.75 screen px.
  const outline = Math.max(cfg.outlineWidth ?? 2, 10) * SCALE;

  // Optional glow
  if (cfg.glowColor) {
    ctx.shadowColor = cfg.glowColor;
    ctx.shadowBlur = 20 * SCALE;
  }

  // Draw shape outline only (no fill)
  ctx.beginPath();
  drawShape(ctx, cfg.shape, cx, iconCy, iconR);

  // Outline stroke
  ctx.shadowBlur = 0;
  ctx.strokeStyle = cfg.color;
  ctx.lineWidth = outline;
  ctx.stroke();

  // Hex internal anatomy — inner pentagon, vertex pips, capacity arc, central glyph
  if (cfg.shape === 'hex' && (cfg.internal || cfg.capacity !== undefined || cfg.pips !== undefined)) {
    drawHexInternals(ctx, cx, iconCy, iconR, cfg, SCALE);
  } else {
    // Center dot (default)
    ctx.beginPath();
    ctx.arc(cx, iconCy, 3 * SCALE, 0, Math.PI * 2);
    ctx.fillStyle = cfg.color;
    ctx.fill();
  }

  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearMipmapLinearFilter;
  texture.anisotropy = maxAnisotropy;
  texture.colorSpace = SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;

  textureCache.set(key, texture);
  return texture;
}

// ── Hex Internal Anatomy ─────────────────────────────────────────
// Reference vocabulary from Oblivion Tet HUD + Homeworld 2:
//   • Inner pentagon scaled to ~0.55r, hairline stroke
//   • 6 vertex pips, lit count driven by `cfg.pips` (default 6)
//   • Capacity arc — 270° ring at radius 0.7r if cfg.capacity provided
//   • Central glyph based on cfg.internal

function drawHexInternals(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number, cfg: IconConfig, SCALE: number,
): void {
  const stroke = cfg.color;
  const dim = withAlpha(stroke, 0.35);

  // Inner pentagon (subtle nested structure)
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = (Math.PI * 2 / 5) * i - Math.PI / 2;
    const ix = cx + r * 0.45 * Math.cos(a);
    const iy = cy + r * 0.45 * Math.sin(a);
    if (i === 0) ctx.moveTo(ix, iy); else ctx.lineTo(ix, iy);
  }
  ctx.closePath();
  ctx.strokeStyle = dim;
  ctx.lineWidth = 8 * SCALE; // stroke floor: ≥1.5 screen px at 28px display target
  ctx.stroke();

  // Vertex pips
  const litCount = cfg.pips ?? 6;
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    const px = cx + r * 0.95 * Math.cos(a);
    const py = cy + r * 0.95 * Math.sin(a);
    ctx.beginPath();
    ctx.arc(px, py, 2.5 * SCALE, 0, Math.PI * 2);
    ctx.fillStyle = i < litCount ? stroke : withAlpha(stroke, 0.18);
    ctx.fill();
  }

  // Capacity arc — 270° starting at the bottom, sweeping clockwise
  if (cfg.capacity !== undefined) {
    const cap = Math.max(0, Math.min(1, cfg.capacity));
    const start = Math.PI * 0.75; // bottom-left
    const end = start + Math.PI * 1.5 * cap; // sweep up to 270°
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.70, start, end);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 8 * SCALE; // stroke floor
    ctx.lineCap = 'round';
    ctx.stroke();
    // Capacity track (unused portion, very faint)
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.70, end, start + Math.PI * 1.5);
    ctx.strokeStyle = withAlpha(stroke, 0.12);
    ctx.lineWidth = 8 * SCALE; // stroke floor
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  // Central glyph
  ctx.fillStyle = stroke;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 8 * SCALE; // stroke floor
  const gR = r * 0.20;
  switch (cfg.internal) {
    case 'station': {
      // Concentric two-circle marker
      ctx.beginPath();
      ctx.arc(cx, cy, gR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 2.5 * SCALE, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'factory': {
      // Three vertical bars (industrial stacks)
      for (let i = -1; i <= 1; i++) {
        ctx.fillRect(cx + i * gR * 0.6 - 1.5 * SCALE, cy - gR * 0.7, 3 * SCALE, gR * 1.4);
      }
      break;
    }
    case 'comms': {
      // Up-pointing triangle (broadcast)
      ctx.beginPath();
      ctx.moveTo(cx, cy - gR);
      ctx.lineTo(cx + gR * 0.866, cy + gR * 0.5);
      ctx.lineTo(cx - gR * 0.866, cy + gR * 0.5);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'mine': {
      // Crossed pickaxes — two diagonals
      ctx.beginPath();
      ctx.moveTo(cx - gR, cy - gR);
      ctx.lineTo(cx + gR, cy + gR);
      ctx.moveTo(cx + gR, cy - gR);
      ctx.lineTo(cx - gR, cy + gR);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 2.5 * SCALE, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    default: {
      // Just a center dot if no internal specified
      ctx.beginPath();
      ctx.arc(cx, cy, 3 * SCALE, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function withAlpha(color: string, alpha: number): string {
  // Accept #rrggbb or rgba(...) or rgb(...)
  if (color.startsWith('#')) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return color;
}

// ── Shape Drawing ────────────────────────────────────────────────

function drawShape(
  ctx: CanvasRenderingContext2D,
  shape: IconShape,
  cx: number, cy: number, r: number,
): void {
  switch (shape) {
    case 'diamond':
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r * 0.7, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r * 0.7, cy);
      ctx.closePath();
      break;

    case 'circle':
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      break;

    case 'triangle':
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r * 0.866, cy + r * 0.5);
      ctx.lineTo(cx - r * 0.866, cy + r * 0.5);
      ctx.closePath();
      break;

    case 'square':
      ctx.rect(cx - r * 0.7, cy - r * 0.7, r * 1.4, r * 1.4);
      break;

    case 'hex': {
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        const px = cx + r * Math.cos(a);
        const py = cy + r * Math.sin(a);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }

    case 'star': {
      for (let i = 0; i < 10; i++) {
        const a = (Math.PI / 5) * i - Math.PI / 2;
        const rad = i % 2 === 0 ? r : r * 0.45;
        const px = cx + rad * Math.cos(a);
        const py = cy + rad * Math.sin(a);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
  }
}

// ── Sprite Factory ───────────────────────────────────────────────

/**
 * Create a billboard sprite with the given icon configuration.
 * Returns a Three.js Sprite that always faces the camera.
 */
// Display target the icon-system scales icons to (mirrors icon-system SCREEN_PX);
// used only to express label sizes as parent-relative ratios.
const ICON_TARGET_PX = 28;
const LABEL_PX = 12;     // label cap height on screen (legibility floor ≥11)
const SUBLABEL_PX = 9;

export function createIcon(cfg: IconConfig): Sprite {
  const texture = renderIconTexture(cfg);
  const material = new SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    sizeAttenuation: true,  // world-space; icon-system rescales per frame
  });

  const sprite = new Sprite(material);
  // Start at a small world-space size — icon-system.scaleFixed() will
  // rescale every frame to maintain constant screen-pixel size.
  const aspect = 1.0; // square texture — labels are standalone child sprites
  sprite.scale.set(1, aspect, 1);
  sprite.userData.aspect = aspect;

  // Labels ride as CHILDREN of the icon sprite with constant parent-relative
  // scale: scaleFixed() scales the parent each frame, so the label keeps its
  // screen-px ratio for free, at legible size (the old baked-into-texture
  // labels rendered ~2 screen px at the 28px icon target — unreadable).
  if (cfg.label) {
    const r = LABEL_PX / ICON_TARGET_PX;
    const label = createLabel(cfg.label, '#ffffff', 13);
    label.scale.set(8 * r, r, 1);          // label canvas is 8:1
    label.position.set(0, -(0.5 + 0.5 * r + 0.10), 0);
    sprite.add(label);
  }
  if (cfg.sublabel) {
    const r = LABEL_PX / ICON_TARGET_PX;
    const r2 = SUBLABEL_PX / ICON_TARGET_PX;
    const sub = createLabel(cfg.sublabel, 'rgba(255,255,255,0.55)', 11);
    sub.scale.set(8 * r2, r2, 1);
    sub.position.set(0, -(0.5 + (cfg.label ? r : 0) + 0.5 * r2 + 0.16), 0);
    sprite.add(sub);
  }

  return sprite;
}

/**
 * Create a text-only label sprite (no icon shape).
 */
export function createLabel(
  text: string,
  color = '#ffffff',
  fontSize = 11,
): Sprite {
  const SCALE = 4;
  const canvas = document.createElement('canvas');
  const W = 256 * SCALE;
  const H = 32 * SCALE;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  ctx.font = `${fontSize * SCALE}px 'JetBrains Mono', monospace`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, W / 2, H / 2, W * 0.95);

  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearMipmapLinearFilter;
  texture.anisotropy = maxAnisotropy;
  texture.colorSpace = SRGBColorSpace;

  const material = new SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: true,
  });

  const sprite = new Sprite(material);
  sprite.scale.set(8, 1, 1);
  // Marked so mesh-fade logic skips labels (their opacity is independent of
  // the icon-state opacity ramps).
  sprite.userData.isLabel = true;
  return sprite;
}

// ── Helpers ──────────────────────────────────────────────────────

function hexToRGBA(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function disposeIconCache(): void {
  for (const tex of textureCache.values()) {
    tex.dispose();
  }
  textureCache.clear();
}
