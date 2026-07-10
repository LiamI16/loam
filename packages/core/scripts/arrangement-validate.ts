// biome-ignore-all lint/style/noNonNullAssertion: dev-only validation script over fixed-size arrays.
/**
 * Offline range-validation for the arrangement controller (docs/arrangement.md).
 * Pure seed-math — no audio. Measures, across many seeds, whether the proposed
 * ranges produce (a) target change-frequency (~1–2 min), (b) meaningful
 * cross-seed distinctness, (c) no degenerate seeds. Run:
 *   node --experimental-strip-types packages/core/scripts/arrangement-validate.ts
 */
import { Seed } from '../dist/index.js';

// ── palette ────────────────────────────────────────────────────────
// bits = (bass, chords, melody, drums); pad implicit-always.
const BITS: number[][] = [
  [1, 1, 1, 1],
  [1, 1, 0, 1],
  [1, 1, 1, 0],
  [1, 0, 0, 1],
  [1, 1, 0, 0],
  [1, 0, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 0],
];
const BASE_PI = [0.3, 0.14, 0.14, 0.1, 0.1, 0.09, 0.08, 0.05];
const ADJ: number[][] = [[1, 2], [0, 3, 4], [0, 4], [1, 5], [1, 2, 5], [3, 4, 7], [7], [5, 6]];
const N = 8;
const INST = ['bass', 'chords', 'melody', 'drums'];

// ── tunable ranges under test ──────────────────────────────────────
const BIAS_M = 1.6; // presence-bias half-width (multiplicative), most instruments
const MELODY_U_LO = -0.4; // melody downside floor (protect germ)
const LAMBDA_LO = 0.5;
const LAMBDA_HI = 0.86;
const PHRASE_BARS = 8;

function presenceBias(seed: Seed, m: number): number[] {
  const rng = seed.child('arrangement-presence-bias').rng();
  return INST.map((_, i) => {
    const u = i === 2 ? rng.nextRange(MELODY_U_LO, 1) : rng.nextRange(-1, 1);
    return Math.exp(u * Math.log(m));
  });
}

function biasedPi(b: number[]): number[] {
  const raw = BITS.map((bits, s) => {
    let w = BASE_PI[s]!;
    for (let i = 0; i < 4; i++) if (bits[i]) w *= b[i]!;
    return w;
  });
  const sum = raw.reduce((a, c) => a + c, 0);
  return raw.map((w) => w / sum);
}

/** Metropolis-Hastings on the adjacency graph; stationary = pi exactly. */
function mhMatrix(pi: number[]): number[][] {
  const P: number[][] = Array.from({ length: N }, () => new Array(N).fill(0));
  for (let i = 0; i < N; i++) {
    const deg = ADJ[i]!.length;
    let off = 0;
    for (const j of ADJ[i]!) {
      const a = Math.min(1, (pi[j]! * deg) / (pi[i]! * ADJ[j]!.length));
      P[i]![j] = (1 / deg) * a;
      off += P[i]![j]!;
    }
    P[i]![i] = 1 - off;
  }
  return P;
}

function lazy(P: number[][], lambda: number): number[][] {
  return P.map((row, i) =>
    row.map((p, j) => (i === j ? lambda + (1 - lambda) * p : (1 - lambda) * p)),
  );
}

function stationary(P: number[][]): number[] {
  let x = new Array(N).fill(1 / N);
  for (let it = 0; it < 8000; it++) {
    const y = new Array(N).fill(0);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) y[j] += x[i]! * P[i]![j]!;
    x = y;
  }
  return x;
}

const bpmSec = (phrases: number, bpm: number) => (phrases * PHRASE_BARS * 4 * 60) / bpm;

// ── run ────────────────────────────────────────────────────────────
const SEED_COUNT = 2000;
const meta = Seed.from(1234567n).rng();
const changePhrasesArr: number[] = [];
const maxOccArr: number[] = [];
const fullTimeArr: number[] = [];
const deepTimeArr: number[] = [];
const statErrArr: number[] = [];
const presencePerInst: number[][] = [[], [], [], []];
const piVectors: number[][] = [];

for (let s = 0; s < SEED_COUNT; s++) {
  const seed = new Seed(BigInt(Math.floor(meta.nextFloat() * 2 ** 53)));
  const b = presenceBias(seed, BIAS_M);
  const pi = biasedPi(b);
  const P0 = mhMatrix(pi);
  const lambda = seed.child('arrangement-frequency').rng().nextRange(LAMBDA_LO, LAMBDA_HI);
  const P = lazy(P0, lambda);
  const st = stationary(P);

  // stationary should ≈ pi (no Dirichlet drift). L1 error.
  statErrArr.push(st.reduce((a, v, i) => a + Math.abs(v - pi[i]!), 0));

  // mean phrases between ANY state change = 1 / Σ pi_s (1 - P_ss)
  const leaveRate = st.reduce((a, v, i) => a + v * (1 - P[i]![i]!), 0);
  changePhrasesArr.push(1 / leaveRate);

  maxOccArr.push(Math.max(...st));
  fullTimeArr.push(st[0]!);
  deepTimeArr.push(st[7]!);
  piVectors.push(st);
  for (let i = 0; i < 4; i++) {
    const present = st.reduce((a, v, sIdx) => a + (BITS[sIdx]![i] ? v : 0), 0);
    presencePerInst[i]!.push(present);
  }
}

const pct = (arr: number[], p: number) => {
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.floor(p * (a.length - 1))]!;
};
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const std = (a: number[]) => {
  const m = mean(a);
  return Math.sqrt(mean(a.map((v) => (v - m) ** 2)));
};

console.log(`Arrangement range validation — ${SEED_COUNT} seeds\n`);

console.log('CHANGE FREQUENCY (mean phrases between any state change):');
for (const p of [0.05, 0.5, 0.95]) {
  const ph = pct(changePhrasesArr, p);
  console.log(
    `  p${(p * 100).toFixed(0).padStart(2)}: ${ph.toFixed(2)} phrases  =  ` +
      `${bpmSec(ph, 90).toFixed(0)}s @90bpm / ${bpmSec(ph, 74).toFixed(0)}s @74 / ${bpmSec(ph, 60).toFixed(0)}s @60`,
  );
}

console.log('\nCROSS-SEED DISTINCTNESS (fraction of time each instrument is present):');
for (let i = 0; i < 4; i++) {
  const a = presencePerInst[i]!;
  console.log(
    `  ${INST[i]!.padEnd(7)} mean ${mean(a).toFixed(2)}  std ${std(a).toFixed(3)}  ` +
      `range [${pct(a, 0.05).toFixed(2)}, ${pct(a, 0.95).toFixed(2)}]`,
  );
}
// median pairwise L1 distance between seed pi-vectors (sampled).
let dsum = 0;
let dn = 0;
for (let k = 0; k < 3000; k++) {
  const i = Math.floor(meta.nextFloat() * SEED_COUNT);
  const j = Math.floor(meta.nextFloat() * SEED_COUNT);
  if (i === j) continue;
  dsum += piVectors[i]!.reduce((a, v, s) => a + Math.abs(v - piVectors[j]![s]!), 0);
  dn++;
}
console.log(`  mean pairwise L1 distance between seed distributions: ${(dsum / dn).toFixed(3)}`);

console.log('\nDEGENERACY / EXTREMES:');
console.log(
  `  max single-state occupancy: mean ${mean(maxOccArr).toFixed(2)}  p95 ${pct(maxOccArr, 0.95).toFixed(2)}  worst ${Math.max(...maxOccArr).toFixed(2)}`,
);
console.log(
  `  time at FULL:          mean ${mean(fullTimeArr).toFixed(2)}  range [${pct(fullTimeArr, 0.05).toFixed(2)}, ${pct(fullTimeArr, 0.95).toFixed(2)}]`,
);
console.log(
  `  time at deep-breather: mean ${mean(deepTimeArr).toFixed(2)}  range [${pct(deepTimeArr, 0.05).toFixed(2)}, ${pct(deepTimeArr, 0.95).toFixed(2)}]`,
);
console.log(
  `\nSTATIONARY-vs-π' L1 error (should be ~0, no drift): max ${Math.max(...statErrArr).toExponential(1)}`,
);

// ── presence-bias magnitude sweep (distinctness sensitivity) ────────
console.log('\nPRESENCE-BIAS M SWEEP (per-instrument presence std across seeds + pairwise L1):');
for (const m of [1.3, 1.4, 1.6, 1.8, 2.0]) {
  const perInst: number[][] = [[], [], [], []];
  const vecs: number[][] = [];
  const sweepMeta = Seed.from(1234567n).rng();
  for (let s = 0; s < 1500; s++) {
    const seed = new Seed(BigInt(Math.floor(sweepMeta.nextFloat() * 2 ** 53)));
    const st = biasedPi(presenceBias(seed, m));
    vecs.push(st);
    for (let i = 0; i < 4; i++)
      perInst[i]!.push(st.reduce((a, v, si) => a + (BITS[si]![i] ? v : 0), 0));
  }
  let ds = 0;
  let dnn = 0;
  for (let k = 0; k < 2000; k++) {
    const i = Math.floor(sweepMeta.nextFloat() * 1500);
    const j = Math.floor(sweepMeta.nextFloat() * 1500);
    if (i === j) continue;
    ds += vecs[i]!.reduce((a, v, sIdx) => a + Math.abs(v - vecs[j]![sIdx]!), 0);
    dnn++;
  }
  const stds = perInst.map((a) => std(a).toFixed(3)).join(' ');
  const maxOcc = vecs.map((v) => Math.max(...v));
  const fullT = vecs.map((v) => v[0]!);
  const deepT = vecs.map((v) => v[7]!);
  console.log(
    `  M=${m.toFixed(1)}  std=${stds}  pairL1=${(ds / dnn).toFixed(3)}  ` +
      `maxOcc(worst ${Math.max(...maxOcc).toFixed(2)})  FULL[p95 ${pct(fullT, 0.95).toFixed(2)}]  deep[p95 ${pct(deepT, 0.95).toFixed(2)}]`,
  );
}
