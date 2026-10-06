// Procedural soundtrack + sample-accurate SFX → dist/mix.wav (48 kHz, 24-bit stereo). No samples, no licenses.
//   node render/audio.mjs
//
// Music, 120 BPM, 12 bars + a final hit: | Am9 | Fmaj7 | Cadd9 | G6 | ×3, then C on 24.0 s (bar 13, the last beat).
//   bar 1: pad + filtered arp (the intro orbit) · bar 2: kick, clap, hats, bass come in · bar 12: snare roll and
//   riser into the hit · 24.0 s: C major stab with kick and a soft crash, ringing out under the end card.
// SFX from the timeline's event list (src/timeline.js → events()): soft clicks, whooshes for camera flights and
// zooms, key ticks while typing, a two-note chime on Share. They sit ~10 dB under the music.
// Mix: −14 LUFS integrated, true peak ≤ −1 dBTP, both measured with ffmpeg's EBU R128 meter (ebur128, peak=true).
import { writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { BPM, BEAT, BAR, HIT, FILM } from "../src/tokens.js";
import { events } from "../src/timeline.js";

const SR = 48000, N = Math.round(FILM * SR), TAU = Math.PI * 2;
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
const at = (bar, beat = 0) => (bar - 1) * BAR + beat * BEAT;          // bar is 1-based

function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
class Bus { constructor() { this.L = new Float32Array(N); this.R = new Float32Array(N); } }
function add(bus, buf, t, gain = 1, pan = 0) {
  const i0 = Math.round(t * SR), gl = gain * Math.cos((pan + 1) * Math.PI / 4), gr = gain * Math.sin((pan + 1) * Math.PI / 4);
  for (let i = 0; i < buf.length; i++) { const j = i0 + i; if (j < 0 || j >= N) continue; bus.L[j] += buf[i] * gl; bus.R[j] += buf[i] * gr; }
}
function biquad(type, f, q = 0.707) {
  const w = TAU * f / SR, c = Math.cos(w), s = Math.sin(w), al = s / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  if (type === "lp") { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
  else if (type === "hp") { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
  else { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }      // band-pass
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => { const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
}
function svf() {                       // state-variable low-pass whose cutoff can move per sample
  let lp = 0, bp = 0;
  return (x, f, q = 0.8) => { const g = 2 * Math.sin(Math.PI * Math.min(f, SR / 6) / SR); lp += g * bp; const hp = x - lp - q * bp; bp += g * hp; return lp; };
}
const env = (t, a, d) => (t < a ? t / a : Math.exp(-(t - a) / d));
const noise = (n, r) => { const b = new Float32Array(n); for (let i = 0; i < n; i++) b[i] = r() * 2 - 1; return b; };

/* ── music ───────────────────────────────────────────────────────────────── */
const CH = {                           // pad voicing, bass root, arp notes
  Am9:   { pad: [57, 60, 64, 67, 71], root: 45, arp: [69, 72, 76, 79, 83, 79, 76, 72] },
  Fmaj7: { pad: [53, 57, 60, 64, 67], root: 41, arp: [65, 69, 72, 76, 79, 76, 72, 69] },
  Cadd9: { pad: [48, 55, 60, 62, 64], root: 36, arp: [67, 72, 74, 76, 79, 76, 74, 72] },
  G6:    { pad: [55, 59, 62, 64, 67], root: 43, arp: [67, 71, 74, 76, 79, 76, 74, 71] },
  C:     { pad: [48, 55, 60, 64, 67, 72], root: 36, arp: [72, 76, 79, 84] },
};
const PROG = ["Am9", "Fmaj7", "Cadd9", "G6"];
const chordOf = (bar) => CH[PROG[(bar - 1) % 4]];
const BARS = Math.round(HIT / BAR);    // 12 bars, then the hit at bar 13

function kick() { const n = Math.round(0.32 * SR), o = new Float32Array(n); let ph = 0; for (let i = 0; i < n; i++) { const t = i / SR; ph += TAU * (46 + 90 * Math.exp(-t / 0.035)) / SR; o[i] = Math.tanh(1.6 * Math.sin(ph)) * env(t, 0.002, 0.11); } return o; }
function clap(r) { const n = Math.round(0.22 * SR), b = noise(n, r), bp = biquad("bp", 1500, 0.9), o = new Float32Array(n); for (let i = 0; i < n; i++) { const t = i / SR, burst = t < 0.03 ? (Math.floor(t / 0.0095) % 2 ? 0.6 : 1) : 1; o[i] = bp(b[i]) * env(t, 0.001, 0.06) * burst * 2.2; } return o; }
function hat(r, open = false) { const n = Math.round((open ? 0.18 : 0.05) * SR), b = noise(n, r), hp = biquad("hp", 8000, 0.7), o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = hp(b[i]) * env(i / SR, 0.001, open ? 0.06 : 0.014); return o; }
function snare(r) { const n = Math.round(0.16 * SR), b = noise(n, r), bp = biquad("bp", 2200, 0.7), o = new Float32Array(n); let ph = 0; for (let i = 0; i < n; i++) { const t = i / SR; ph += TAU * 190 / SR; o[i] = (bp(b[i]) * 1.4 + Math.sin(ph) * 0.5 * Math.exp(-t / 0.03)) * env(t, 0.001, 0.045); } return o; }
function bassNote(f, len) { const n = Math.round(len * SR), o = new Float32Array(n), lp = svf(); let ph = 0; for (let i = 0; i < n; i++) { const t = i / SR; ph += f / SR; const saw = 2 * (ph % 1) - 1, sq = (ph % 1) < 0.5 ? 1 : -1; o[i] = lp(0.6 * saw + 0.4 * sq, 180 + 900 * Math.exp(-t / 0.05)) * env(t, 0.004, 0.16) * Math.min(1, (len - t) / 0.01); } return o; }
function pluck(f, bright = 1) { const n = Math.round(0.42 * SR), o = new Float32Array(n), lp = svf(); let p1 = 0, p2 = 0; for (let i = 0; i < n; i++) { const t = i / SR; p1 += f / SR; p2 += f * 1.006 / SR; const s = (2 * (p1 % 1) - 1) + (2 * (p2 % 1) - 1); o[i] = lp(s * 0.5, (500 + 3800 * bright) * Math.exp(-t / 0.09) + 300) * env(t, 0.002, 0.13); } return o; }
function crash(r) { const n = Math.round(1.6 * SR), b = noise(n, r), hp = biquad("hp", 5200, 0.6), o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = hp(b[i]) * env(i / SR, 0.002, 0.45); return o; }
function riser(r, dur) { const n = Math.round(dur * SR), b = noise(n, r), o = new Float32Array(n), f = svf(); for (let i = 0; i < n; i++) { const p = i / n; o[i] = f(b[i], 400 + 7000 * p * p, 0.6) * p * p; } return o; }

function renderMusic() {
  const bus = new Bus(), r = rng(21);
  // sidechain pump (from bar 2): every beat the pad and bass dip and recover
  const pump = (t) => { if (t < at(2) || t >= HIT) return 1; const k = ((t / BEAT) % 1) * BEAT; return 0.55 + 0.45 * Math.min(1, k / 0.18); };
  // pad: detuned saws through a low-pass that opens over the first bars, one chord per bar
  for (let bar = 1; bar <= BARS + 1; bar++) {
    const ch = bar > BARS ? CH.C : chordOf(bar), t0 = at(bar), last = bar > BARS;
    const len = last ? FILM - t0 : BAR + 0.08, n = Math.round(len * SR), s0 = Math.round(t0 * SR);
    const vs = ch.pad.flatMap((m, vi) => [-7, 7].map((c) => ({ f: mtof(m) * 2 ** (c / 1200), ph: r(), pan: (vi % 2 ? 0.4 : -0.4) * Math.sign(c) })));
    const fl = svf(), fr = svf();
    for (let k = 0; k < n; k++) {
      const j = s0 + k; if (j >= N) break;
      const t = j / SR, lt = k / SR;
      const a = Math.min(1, lt / 0.03) * (last ? Math.exp(-lt / 0.55) : Math.min(1, (len - lt) / 0.06));
      const cut = last ? 2600 * Math.exp(-lt / 0.6) + 500 : Math.min(2200, 700 + 380 * (t / BAR));
      let L = 0, R = 0;
      for (const v of vs) { const s = 2 * ((v.ph + v.f * t) % 1) - 1; L += s * (1 - v.pan); R += s * (1 + v.pan); }
      const g = 0.03 * a * (last ? 1.4 : pump(t));
      bus.L[j] += fl(L, cut) * g; bus.R[j] += fr(R, cut) * g;
    }
  }
  // arp: 8ths through the chord, brighter as the film goes on
  for (let bar = 1; bar <= BARS; bar++) for (let e = 0; e < 8; e++) {
    if (bar === BARS && e >= 6) continue;                       // leave room for the fill
    const ch = chordOf(bar), t = at(bar, e / 2), bright = Math.min(1, 0.25 + t / 12);
    add(bus, pluck(mtof(ch.arp[e % ch.arp.length]), bright), t, 0.14 * (bar === 1 ? 0.8 : 1), e % 2 ? 0.35 : -0.35);
  }
  // drums + bass from bar 2
  const K = kick();
  for (let bar = 2; bar <= BARS; bar++) {
    const ch = chordOf(bar);
    for (let beat = 0; beat < 4; beat++) {
      const fill = bar === BARS && beat >= 2;
      if (!fill) add(bus, K, at(bar, beat), 0.5);
      if ((beat === 1 || beat === 3) && !fill) add(bus, clap(r), at(bar, beat), 0.32, 0.05);
      add(bus, hat(r, beat === 3 && bar % 4 === 0), at(bar, beat + 0.5), 0.13, 0.3);
      if (bar >= 4) for (const q of [0.25, 0.75]) add(bus, hat(r), at(bar, beat + q), 0.045, -0.3);
    }
    for (let e = 0; e < 8; e++) {
      if (bar === BARS && e >= 6) continue;
      const f = mtof(ch.root + (e % 2 ? 12 : 0));
      add(bus, bassNote(f, BEAT / 2 - 0.02), at(bar, e / 2), 0.3 * (e % 2 ? 0.7 : 1));
    }
  }
  // the fill: a snare roll and a riser over the last two beats of bar 12
  for (let s = 0; s < 8; s++) add(bus, snare(r), at(BARS, 2 + s / 4), 0.12 + 0.03 * s, s % 2 ? 0.15 : -0.15);
  add(bus, riser(r, BEAT * 2), at(BARS, 2), 0.16);
  // the hit on 24.0 s
  add(bus, K, HIT, 0.75); add(bus, crash(r), HIT, 0.22);
  for (const [i, m] of CH.C.arp.entries()) add(bus, pluck(mtof(m), 1), HIT + i * 0.004, 0.13, i % 2 ? 0.3 : -0.3);
  add(bus, bassNote(mtof(36), 0.9), HIT, 0.34);
  return bus;
}

/* ── SFX ─────────────────────────────────────────────────────────────────── */
const R = rng(5);
const SFX = {
  click() { const n = Math.round(0.03 * SR), b = noise(n, R), bp = biquad("bp", 2900, 1.3), o = new Float32Array(n); for (let i = 0; i < n; i++) { const t = i / SR; o[i] = bp(b[i]) * env(t, 0.0008, 0.006) * 1.5 + Math.sin(TAU * 1900 * t) * env(t, 0.0005, 0.004) * 0.22; } return o; },
  whoosh(dur) { const n = Math.round(dur * SR), b = noise(n, R), o = new Float32Array(n), f = svf(); for (let i = 0; i < n; i++) { const p = i / n, w = Math.sin(Math.PI * Math.min(1, p * 1.25)) ** 2; o[i] = f(b[i], 300 + 2400 * w, 0.5) * w; } return o; },
  key(i) { const n = Math.round(0.018 * SR), b = noise(n, R), bp = biquad("bp", 3300 + (i % 4) * 280, 2), o = new Float32Array(n); for (let k = 0; k < n; k++) o[k] = bp(b[k]) * env(k / SR, 0.0004, 0.0035) * 1.3; return o; },
  chime() { const n = Math.round(1.1 * SR), o = new Float32Array(n); for (const [d, m] of [[0, 84], [0.09, 91]]) { const f = mtof(m), s0 = Math.round(d * SR); for (let k = 0; k + s0 < n; k++) { const t = k / SR; o[k + s0] += (Math.sin(TAU * f * t) + 0.3 * Math.sin(TAU * f * 2.76 * t) * Math.exp(-t / 0.06)) * env(t, 0.002, 0.28) * 0.6; } } return o; },
};
function voice(e) {
  const p = ((e.time * 0.37) % 1) * 0.4 - 0.2;
  switch (e.type) {
    case "click": return [SFX.click(), 0.5, p];
    case "whoosh": return [SFX.whoosh(e.dur), 0.16, 0];
    case "zoom": return [SFX.whoosh(e.dur * 0.9), 0.09, 0];
    case "swipe": return [SFX.whoosh(e.dur), 0.06, 0.2];
    case "key": return [SFX.key(e.i ?? 0), 0.22, p];
    case "chime": return [SFX.chime(), 0.3, 0];
    default: return null;
  }
}

/* ── mix tools ───────────────────────────────────────────────────────────── */
function reverb(bus, wet) {
  const combs = [1557, 1617, 1491, 1422], aps = [225, 556];
  for (const ch of ["L", "R"]) {
    const x = bus[ch], y = new Float32Array(N), spread = ch === "R" ? 23 : 0;
    for (const d0 of combs) { const d = d0 + spread, buf = new Float32Array(d); let idx = 0, lp = 0; for (let i = 0; i < N; i++) { const out = buf[idx]; lp = out * 0.75 + lp * 0.25; buf[idx] = x[i] + lp * 0.8; idx = (idx + 1) % d; y[i] += out * 0.25; } }
    for (const d0 of aps) { const d = d0 + spread, buf = new Float32Array(d); let idx = 0; for (let i = 0; i < N; i++) { const bo = buf[idx], v = y[i]; buf[idx] = v + bo * 0.5; y[i] = bo - v * 0.5; idx = (idx + 1) % d; } }
    for (let i = 0; i < N; i++) x[i] = x[i] * (1 - wet) + y[i] * wet * 1.5;
  }
}
function lufs(bus) {                   // ITU-R BS.1770 (K-weighted, gated), for balancing the stems
  const run = (inp, b, a) => { const o = new Float32Array(inp.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0; for (let i = 0; i < inp.length; i++) { const y = b[0] * inp[i] + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2; x2 = x1; x1 = inp[i]; y2 = y1; y1 = y; o[i] = y; } return o; };
  const kw = (x) => run(run(x, [1.53512485958697, -2.69169618940638, 1.19839281085285], [-1.69065929318241, 0.73248077421585]), [1, -2, 1], [-1.99004745483398, 0.99007225036621]);
  const L = kw(bus.L), Rr = kw(bus.R), blk = Math.round(0.4 * SR), hop = Math.round(0.1 * SR), z = [];
  for (let s = 0; s + blk <= N; s += hop) { let m = 0; for (let i = s; i < s + blk; i++) m += L[i] * L[i] + Rr[i] * Rr[i]; z.push(m / blk); }
  const ld = (m) => -0.691 + 10 * Math.log10(m), abs = z.filter((m) => ld(m) > -70);
  const rel = ld(abs.reduce((a, b) => a + b, 0) / abs.length) - 10, g = abs.filter((m) => ld(m) > rel);
  return ld(g.reduce((a, b) => a + b, 0) / g.length);
}
const gain = (bus, db) => { const g = 10 ** (db / 20); const o = new Bus(); for (let i = 0; i < N; i++) { o.L[i] = bus.L[i] * g; o.R[i] = bus.R[i] * g; } return o; };
function limit(src, ceilingDb) {       // look-ahead peak limiter with a smooth release
  const bus = gain(src, 0), c = 10 ** (ceilingDb / 20), look = Math.round(0.004 * SR), rel = Math.exp(-1 / (0.06 * SR));
  const need = new Float32Array(N);
  for (let i = 0; i < N; i++) { const p = Math.max(Math.abs(bus.L[i]), Math.abs(bus.R[i])); need[i] = p > c ? c / p : 1; }
  const gmin = new Float32Array(N);
  for (let i = N - 1; i >= 0; i--) { let m = need[i]; for (let k = 1; k < look && i + k < N; k++) m = Math.min(m, need[i + k]); gmin[i] = m; }
  let g = 1; for (let i = 0; i < N; i++) { g = gmin[i] < g ? gmin[i] : g * rel + gmin[i] * (1 - rel); bus.L[i] *= g; bus.R[i] *= g; }
  return bus;
}
function writeWav(path, bus) {         // 24-bit PCM
  const data = Buffer.alloc(44 + N * 6);
  data.write("RIFF", 0); data.writeUInt32LE(36 + N * 6, 4); data.write("WAVEfmt ", 8); data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20); data.writeUInt16LE(2, 22); data.writeUInt32LE(SR, 24); data.writeUInt32LE(SR * 6, 28);
  data.writeUInt16LE(6, 32); data.writeUInt16LE(24, 34); data.write("data", 36); data.writeUInt32LE(N * 6, 40);
  const q = (v) => Math.max(-8388608, Math.min(8388607, Math.round(v * 8388607)));
  for (let i = 0; i < N; i++) { data.writeIntLE(q(bus.L[i]), 44 + i * 6, 3); data.writeIntLE(q(bus.R[i]), 47 + i * 6, 3); }
  writeFileSync(path, data);
}
/** Integrated loudness and true peak, as ffmpeg's EBU R128 meter reports them. */
export function measure(file) {
  const r = spawnSync(ffmpegPath, ["-hide_banner", "-nostats", "-i", file, "-filter_complex", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" });
  const s = r.stderr.slice(r.stderr.lastIndexOf("Summary:"));
  return { lufs: +s.match(/I:\s+(-?[\d.]+) LUFS/)[1], tp: +s.match(/Peak:\s+(-?[\d.]+) dBFS/)[1], lra: +s.match(/LRA:\s+(-?[\d.]+) LU/)[1] };
}

/* ── build ───────────────────────────────────────────────────────────────── */
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const ev = events();
  const music = renderMusic(); reverb(music, 0.16);
  const fx = new Bus(); let used = 0;
  for (const e of ev) { const v = voice(e); if (!v) continue; add(fx, v[0], e.time, v[1], v[2]); used++; }
  reverb(fx, 0.1);
  const mL = lufs(music), fL = lufs(fx);
  const m = gain(music, -14 - mL), f = gain(fx, -24 - fL);   // SFX ~10 dB under the music
  const sum = new Bus(); for (let i = 0; i < N; i++) { sum.L[i] = m.L[i] + f.L[i]; sum.R[i] = m.R[i] + f.R[i]; }
  // final gain and limiter ceiling, measured with ffmpeg until −14.0 LUFS (±0.1) and true peak ≤ −1.2 dBTP
  mkdirSync("dist", { recursive: true });
  let pre = -14 - lufs(sum), ceiling = -1.6, res;
  for (let pass = 0; pass < 8; pass++) {
    writeWav("dist/mix.wav", limit(gain(sum, pre), ceiling));
    res = measure("dist/mix.wav");
    const okL = Math.abs(res.lufs + 14) <= 0.1, okP = res.tp <= -1.2;
    if (okL && okP) break;
    if (!okP) ceiling -= res.tp + 1.25;
    if (!okL) pre += -14 - res.lufs;
  }
  console.log(`${ev.length} events (${used} sounds) · ${BPM} BPM · ${FILM}s · music ${mL.toFixed(1)}→-14, sfx ${fL.toFixed(1)}→-24 LUFS`);
  console.log(`dist/mix.wav: ${res.lufs.toFixed(1)} LUFS integrated, true peak ${res.tp.toFixed(1)} dBTP, LRA ${res.lra.toFixed(1)} LU (limiter ceiling ${ceiling.toFixed(2)} dBFS)`);
}
