/** Sonidos sintetizados con WebAudio (sin archivos). Música + efectos de fichas. */
let ctx = null;
let muted = localStorage.getItem("domino_mute") === "1";
let musicTimer = null;
let musicOn = false;

export function isMuted() { return muted; }
export function toggleMute() {
  muted = !muted;
  localStorage.setItem("domino_mute", muted ? "1" : "0");
  if (muted) stopMusic();
  return muted;
}

function ac() {
  ctx ??= new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

/** Tono simple con envolvente. */
function tone({ freq = 440, ms = 90, vol = 0.12, type = "sine", when = 0, slideTo = null }) {
  if (muted) return;
  try {
    const c = ac();
    const t0 = c.currentTime + when;
    const o = c.createOscillator();
    const g = c.createGain();
    o.connect(g); g.connect(c.destination);
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + ms / 1000);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + ms / 1000);
    o.start(t0);
    o.stop(t0 + ms / 1000 + 0.02);
  } catch { /* sin audio */ }
}

/** Golpe seco de ficha (ruido + tumbo grave). */
function knock(vol = 0.25) {
  if (muted) return;
  try {
    const c = ac();
    const t0 = c.currentTime;
    // Chasquido: ruido corto filtrado.
    const len = Math.floor(c.sampleRate * 0.07);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = "bandpass"; f.frequency.value = 2200; f.Q.value = 0.8;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.09);
    src.connect(f); f.connect(g); g.connect(c.destination);
    src.start(t0);
    // Tumbo grave de madera.
    tone({ freq: 170, slideTo: 90, ms: 110, vol: vol * 0.9, type: "sine" });
  } catch { /* sin audio */ }
}

// ---- Efectos ----
export const sndSelect = () => tone({ freq: 700, ms: 50, vol: 0.07, type: "triangle" });
export const sndPlace = () => knock(0.28);
export const sndPlay = () => knock(0.28);
export const sndDraw = () => { tone({ freq: 300, slideTo: 640, ms: 140, vol: 0.09, type: "triangle" }); };
export const sndPass = () => { tone({ freq: 330, ms: 110, vol: 0.09, type: "sine" }); tone({ freq: 220, ms: 150, vol: 0.09, type: "sine", when: 0.1 }); };
export const sndTurn = () => tone({ freq: 660, ms: 70, vol: 0.06, type: "sine" });
export const sndWin = () => {
  [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, ms: 160, vol: 0.11, type: "triangle", when: i * 0.13 }));
  knock(0.2);
};

// ---- Música de fondo: loop latino suave (Am - F - C - G) ----
// Bajo + acordes con ritmo de "tumbao" + piquete de melodía pentatónica.
const PROG = [
  { bass: 110.0, chord: [220.0, 261.63, 329.63] },  // Am
  { bass: 87.31, chord: [174.61, 220.0, 261.63] },  // F
  { bass: 130.81, chord: [261.63, 329.63, 392.0] },  // C
  { bass: 98.0, chord: [196.0, 246.94, 293.66] },    // G
];
const MELODY = [440, 0, 523.25, 587.33, 0, 523.25, 440, 392, 0, 440, 523.25, 0, 659.25, 587.33, 523.25, 0];
const STEP_MS = 240;

export function startMusic() {
  if (musicOn || muted) return;
  try { ac(); } catch { return; }
  musicOn = true;
  let step = 0;
  const tick = () => {
    if (!musicOn || muted) return;
    const bar = Math.floor(step / 4) % PROG.length;
    const pos = step % 4;
    const { bass, chord } = PROG[bar];
    if (pos === 0) tone({ freq: bass, ms: 420, vol: 0.075, type: "sine" });
    if (pos === 2) tone({ freq: bass * 1.5, ms: 200, vol: 0.05, type: "sine" });
    if (pos % 2 === 1) chord.forEach((f) => tone({ freq: f, ms: 200, vol: 0.022, type: "triangle" }));
    const m = MELODY[step % MELODY.length];
    if (m) tone({ freq: m, ms: 220, vol: 0.035, type: "triangle" });
    // Palmas suaves en los tiempos 2 y 4.
    if (pos === 1 || pos === 3) knock(0.05);
    step += 1;
  };
  tick();
  musicTimer = setInterval(tick, STEP_MS);
}

export function stopMusic() {
  musicOn = false;
  if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
}

export function musicPlaying() { return musicOn; }
