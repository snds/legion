// ═══════════════════════════════════════════════════════════════════
// ASSET URL RESOLUTION
// Resolves a public/ asset path against Vite's configured base URL so
// runtime-string asset loads survive a non-root deploy base.
//
// In dev `import.meta.env.BASE_URL` is "/"; on GitHub Pages the build
// sets base to "/legion/", so a hard-coded "/textures/sol/earth.jpg"
// would 404. Route every runtime asset string through asset() instead.
//
// NOTE: this is only for paths loaded via runtime strings (TextureLoader,
// fetch, Audio src). Assets imported through the bundler (import x from
// '...') or `new URL('./x', import.meta.url)` are rewritten by Vite and
// must NOT be passed through here.
// ═══════════════════════════════════════════════════════════════════

/** Prefix a leading-slash public asset path with Vite's base URL. */
export function asset(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, ''); // "" in dev, "/legion" on Pages
  return base + (path.startsWith('/') ? path : `/${path}`);
}
