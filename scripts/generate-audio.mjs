import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const outDir = resolve(rootDir, 'public/assets/audio');

const SAMPLE_RATE = 16000;

/**
 * 将 [-1, 1] 浮点采样编码为单声道 16kHz 16-bit PCM WAV Buffer
 */
function encodeWavMono16(samples) {
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);

  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');

  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16); // PCM chunk size
  buf.writeUInt16LE(1, 20); // PCM format
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample

  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const int16 = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
    buf.writeInt16LE(int16, 44 + i * 2);
  }
  return buf;
}

function synthTone(durationSec, renderSample) {
  const total = Math.max(1, Math.floor(SAMPLE_RATE * durationSec));
  const out = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    const t = i / SAMPLE_RATE;
    const progress = i / total;
    out[i] = renderSample(t, progress);
  }
  return encodeWavMono16(out);
}

// 使用可复现伪随机避免每次构建哈希无谓变化
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 0xffffffff) * 2 - 1;
  };
}

function generateAll() {
  mkdirSync(outDir, { recursive: true });

  const specs = [
    {
      file: 'shot.wav',
      build: () => {
        const rand = makeRng(101);
        let phase = 0;
        return synthTone(0.065, (_t, p) => {
          const freq = 620 * Math.pow(165 / 620, p);
          phase += (2 * Math.PI * freq) / SAMPLE_RATE;
          const env = Math.pow(1 - p, 1.8);
          const sq = Math.sin(phase) >= 0 ? 0.55 : -0.55;
          return (sq * 0.72 + rand() * 0.28) * env * 0.52;
        });
      },
    },
    {
      file: 'shotgun.wav',
      build: () => {
        const rand = makeRng(202);
        let phase = 0;
        let lp = 0;
        return synthTone(0.14, (_t, p) => {
          const freq = 240 * Math.pow(48 / 240, p);
          phase += (2 * Math.PI * freq) / SAMPLE_RATE;
          const tri = (2 / Math.PI) * Math.asin(Math.sin(phase));
          lp = lp * 0.68 + rand() * 0.32;
          const env = Math.pow(1 - p, 1.4);
          return (tri * 0.55 + lp * 0.85) * env * 0.72;
        });
      },
    },
    {
      file: 'break.wav',
      build: () => {
        const rand = makeRng(303);
        let phase = 0;
        return synthTone(0.14, (_t, p) => {
          const freq = 320 * Math.pow(860 / 320, p);
          phase += (2 * Math.PI * freq) / SAMPLE_RATE;
          const tri = (2 / Math.PI) * Math.asin(Math.sin(phase));
          const crack = p < 0.28 ? rand() * (1 - p / 0.28) * 0.6 : 0;
          const env = Math.pow(1 - p, 1.35);
          return (tri * 0.65 + crack) * env * 0.65;
        });
      },
    },
    {
      file: 'explosion.wav',
      build: () => {
        const rand = makeRng(404);
        let phase = 0;
        let lp = 0;
        return synthTone(0.28, (_t, p) => {
          const freq = 140 * Math.pow(28 / 140, p);
          phase += (2 * Math.PI * freq) / SAMPLE_RATE;
          const saw = ((phase / Math.PI) % 2) - 1;
          lp = lp * 0.8 + rand() * 0.2;
          const env = Math.pow(1 - p, 1.5);
          return (saw * 0.45 + lp * 1.15) * env * 0.82;
        });
      },
    },
    {
      file: 'crit.wav',
      build: () => {
        let phase = 0;
        return synthTone(0.09, (_t, p) => {
          const freq = 880 * Math.pow(1480 / 880, p);
          phase += (2 * Math.PI * freq) / SAMPLE_RATE;
          const tri = (2 / Math.PI) * Math.asin(Math.sin(phase));
          const env = Math.pow(1 - p, 1.6);
          return tri * env * 0.62;
        });
      },
    },
    {
      file: 'gate.wav',
      build: () => {
        let phase = 0;
        return synthTone(0.15, (_t, p) => {
          const freq = 520 * Math.pow(1040 / 520, p);
          phase += (2 * Math.PI * freq) / SAMPLE_RATE;
          const sine = Math.sin(phase);
          const env = Math.sin(Math.min(1, p * 6) * (Math.PI / 2)) * Math.pow(1 - p, 1.3);
          return sine * env * 0.64;
        });
      },
    },
  ];

  let totalBytes = 0;
  for (const s of specs) {
    const filePath = resolve(outDir, s.file);
    const buffer = s.build();
    writeFileSync(filePath, buffer);
    const size = statSync(filePath).size;
    totalBytes += size;
  }

  console.log(`🔊 已程序化生成 ${specs.length} 个轻量短音效 WAV（总计 ${(totalBytes / 1024).toFixed(2)} KB）-> public/assets/audio/`);
}

generateAll();
