// Tiny synthesized sound effects using the Web Audio API.
// No assets to download, no CDN, plays only after the user interacts (browser policy).

let ctx = null;
function getCtx() {
  if (typeof window === 'undefined') return null;
  if (ctx) return ctx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

function tone({ freq = 440, duration = 0.12, type = 'sine', gain = 0.05, sweep = 0 }) {
  const c = getCtx();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  if (sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + sweep), c.currentTime + duration);
  g.gain.value = gain;
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + duration);
  osc.connect(g).connect(c.destination);
  osc.start();
  osc.stop(c.currentTime + duration);
}

export const sounds = {
  place:     () => tone({ freq: 540, duration: 0.06, type: 'square', gain: 0.04 }),
  submit:    () => { tone({ freq: 660, duration: 0.08, type: 'triangle', gain: 0.05 }); setTimeout(() => tone({ freq: 880, duration: 0.1, type: 'triangle', gain: 0.05 }), 60); },
  reject:    () => tone({ freq: 220, duration: 0.18, type: 'sawtooth', gain: 0.06, sweep: -120 }),
  yourTurn:  () => { tone({ freq: 700, duration: 0.1, type: 'sine', gain: 0.05 }); setTimeout(() => tone({ freq: 900, duration: 0.12, type: 'sine', gain: 0.05 }), 90); },
  timerWarn: () => tone({ freq: 330, duration: 0.08, type: 'square', gain: 0.04 }),
  win:       () => {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone({ freq: f, duration: 0.15, type: 'triangle', gain: 0.06 }), i * 100));
  },
};