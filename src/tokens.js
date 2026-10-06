// Single source of truth for rhythm, motion and color. Shared by the film page (browser) and the
// render/audio scripts (Node), so nothing here may touch the DOM.

export const BPM = 120;
export const BEAT = 60 / BPM;          // 0.5 s
export const BAR = BEAT * 4;           // 2.0 s
/** Beats → seconds. Every action in the timeline sits on this grid (eighths at most). */
export const b = (beats) => beats * BEAT;

export const HIT = b(48);              // 24.0 s: the music's last beat (bar 13, downbeat); the end card is fully in
export const FILM = HIT + 1;           // 25.0 s: the final chord rings out under the end card

export const STEP = 1000 / 60;         // the app's virtual clock always advances 60 frames per second
export const SIZE = { w: 1920, h: 1080 };

// Motion: the configurator's own curves (styles.css --ease / --ease-io), plus one slower curve for
// screen-recording zooms. Calm, no overshoot anywhere.
export const DUR = {
  zoom: b(1.75),                       // 0.875 s viewport zoom in or out
  move: b(1.1),                        // 0.55 s cursor travel between controls
  hop: b(0.8),                         // 0.4 s cursor travel to a neighbouring control
  far: b(1.5),                         // 0.75 s cursor travel across the screen
  press: 0.11,                         // cursor press-down + release
  caption: b(0.6),                     // caption fade
  scroll: 0.45,                        // smooth scroll in a list
  key: 0.09,                           // one typed letter
};

export const COLOR = {                 // the app's dark-theme tokens
  bg: "#0B0B0D", surface: "#121214", ink: "#EDEDEF", muted: "#9C9CA5", faint: "#6E6E77",
  border: "#232328", borderStrong: "#33333A", chip: "rgb(22 22 26 / .86)", live: "#34D399",
};

export const URL_LIVE = "aowshad.github.io/bike-configurator-3d";
export const PRODUCT = "Gravity DH";
export const TAGLINE = "Live 3D bike configurator";

/* ── easing ─────────────────────────────────────────────────────────────── */
function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t, sy = (t) => ((ay * t + by) * t + cy) * t;
  const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0; if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) { const e = sx(t) - x, d = dx(t); if (Math.abs(e) < 1e-6 || !d) break; t -= e / d; }
    return sy(Math.min(1, Math.max(0, t)));
  };
}
export const EASE = {
  ui: bezier(0.2, 0, 0, 1),            // --ease: entrances, fades
  io: bezier(0.4, 0, 0.2, 1),          // --ease-io: cursor travel
  zoom: bezier(0.65, 0, 0.35, 1),      // slow in, slow out: viewport zooms
};
export const clamp01 = (x) => Math.min(1, Math.max(0, x));
