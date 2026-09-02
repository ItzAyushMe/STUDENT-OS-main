// ============================================================
// StudentOS — procedural sound asset generator
// Generates ambient loops (rain, ocean, lofi, white noise) and
// sound effects (complete chime, level-up arpeggio) as small
// mono 16-bit WAV files. No dependencies — pure Node.
//   node scripts/generate-sounds.mjs
// ============================================================
import fs from 'node:fs';
import path from 'node:path';

const SR = 22050; // sample rate — small files, fine for ambience
const OUT = path.join(process.cwd(), 'assets', 'sounds');
fs.mkdirSync(OUT, { recursive: true });

function writeWav(name, samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767 * 0.9), 44 + i * 2);
  }
  fs.writeFileSync(path.join(OUT, name), buf);
  console.log(`${name}  (${(n / SR).toFixed(1)}s, ${(buf.length / 1024).toFixed(0)}KB)`);
}

// deterministic-ish random
let seed = 42;
const rand = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

const seconds = (s) => Math.floor(s * SR);

// ---------------- white noise ----------------
{
  const n = seconds(20);
  const out = new Float32Array(n);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const w = rand() * 2 - 1;
    lp = lp * 0.92 + w * 0.08; // soften
    out[i] = lp * 0.6 + w * 0.4 * 0.25;
  }
  // fade edges for seamless-ish loop
  const f = seconds(0.5);
  for (let i = 0; i < f; i++) {
    const g = i / f;
    out[i] *= g;
    out[n - 1 - i] *= g;
  }
  writeWav('whitenoise.wav', out);
}

// ---------------- rain ----------------
{
  const n = seconds(20);
  const out = new Float32Array(n);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const w = rand() * 2 - 1;
    lp = lp * 0.86 + w * 0.14; // pink-ish
    out[i] = lp * 1.6;
  }
  // droplets: short decaying pings
  const droplets = 90;
  for (let d = 0; d < droplets; d++) {
    const start = Math.floor(rand() * (n - seconds(0.05)));
    const freq = 1400 + rand() * 2600;
    const len = seconds(0.02 + rand() * 0.03);
    for (let i = 0; i < len; i++) {
      const env = Math.exp(-i / (len / 4));
      out[start + i] += Math.sin((2 * Math.PI * freq * i) / SR) * env * 0.08;
    }
  }
  writeWav('rain.wav', out);
}

// ---------------- ocean ----------------
{
  const n = seconds(20);
  const out = new Float32Array(n);
  let brown = 0;
  for (let i = 0; i < n; i++) {
    const w = rand() * 2 - 1;
    brown = (brown + 0.02 * w) / 1.02; // brown noise
    // two slow swells for wave rhythm
    const t = i / SR;
    const swell = 0.55 + 0.45 * Math.sin((2 * Math.PI * t) / 7.5) * Math.sin((2 * Math.PI * t) / 13.3);
    out[i] = brown * 4.2 * (0.35 + 0.65 * Math.abs(swell));
  }
  const f = seconds(1);
  for (let i = 0; i < f; i++) {
    const g = i / f;
    out[i] *= g;
    out[n - 1 - i] *= g;
  }
  writeWav('ocean.wav', out);
}

// ---------------- lofi pad ----------------
{
  const n = seconds(20);
  const out = new Float32Array(n);
  // gentle 4-chord loop: Cmaj7 Am7 Fmaj7 G6 (5s each)
  const chords = [
    [261.63, 329.63, 392.0, 493.88],
    [220.0, 261.63, 329.63, 392.0],
    [174.61, 220.0, 261.63, 329.63],
    [196.0, 246.94, 293.66, 392.0],
  ];
  const seg = n / 4;
  for (let i = 0; i < n; i++) {
    const chord = chords[Math.floor(i / seg) % 4];
    const t = i / SR;
    // slow attack/release envelope within each chord segment
    const posInSeg = (i % seg) / seg;
    const env = Math.min(1, posInSeg * 6) * Math.min(1, (1 - posInSeg) * 6);
    let v = 0;
    for (let f = 0; f < chord.length; f++) {
      const detune = 1 + (f % 2 === 0 ? 0.0015 : -0.0015);
      v += Math.sin(2 * Math.PI * chord[f] * detune * t) * (0.16 / (f + 1));
      // soft octave shimmer
      v += Math.sin(2 * Math.PI * chord[f] * 2 * t) * 0.03 / (f + 1);
    }
    // vinyl crackle
    const crackle = rand() < 0.0015 ? (rand() * 2 - 1) * 0.05 : 0;
    out[i] = v * env + crackle;
  }
  writeWav('lofi.wav', out);
}

// ---------------- SFX: complete chime ----------------
{
  const n = seconds(0.9);
  const out = new Float32Array(n);
  const notes = [659.25, 880.0]; // E5, A5
  notes.forEach((f, k) => {
    const start = Math.floor(k * seconds(0.22));
    for (let i = start; i < n; i++) {
      const dt = (i - start) / SR;
      const env = Math.exp(-dt * 4.5);
      out[i] += Math.sin(2 * Math.PI * f * dt) * env * 0.4;
      out[i] += Math.sin(2 * Math.PI * f * 2 * dt) * env * 0.1;
    }
  });
  writeWav('complete.wav', out);
}

// ---------------- SFX: level up arpeggio ----------------
{
  const n = seconds(1.4);
  const out = new Float32Array(n);
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  notes.forEach((f, k) => {
    const start = Math.floor(k * seconds(0.16));
    for (let i = start; i < n; i++) {
      const dt = (i - start) / SR;
      const env = Math.exp(-dt * 3.2);
      out[i] += Math.sin(2 * Math.PI * f * dt) * env * 0.34;
    }
  });
  writeWav('levelup.wav', out);
}

console.log('Done — sounds written to assets/sounds/');
