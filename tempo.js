// Определение темпа (BPM) и положения долей по аудиофайлу.
// 1. Декодируем и пересэмплируем в моно 11025 Гц.
// 2. Считаем «силу атак» (spectral flux) — где в музыке появляются новые звуки.
// 3. Автокорреляцией находим период, затем уточняем темп и сдвиг так,
//    чтобы сетка долей точнее всего совпадала с атаками на протяжении всей песни.

const SR = 11025;
const FFT = 1024;
const HOP = 128;
const FPS = SR / HOP; // ≈ 86 кадров в секунду

const tick = () => new Promise(r => setTimeout(r));

function fftMag(re, im, out) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  for (let k = 0; k < out.length; k++) out[k] = Math.hypot(re[k], im[k]);
}

async function onsetEnvelope(samples) {
  const frames = Math.floor((samples.length - FFT) / HOP);
  const env = new Float32Array(Math.max(frames, 0));
  const win = new Float32Array(FFT).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / FFT));
  const bins = FFT / 2;
  let prev = new Float32Array(bins), cur = new Float32Array(bins);
  const re = new Float32Array(FFT), im = new Float32Array(FFT);
  for (let f = 0; f < frames; f++) {
    const off = f * HOP;
    for (let i = 0; i < FFT; i++) { re[i] = samples[off + i] * win[i]; im[i] = 0; }
    fftMag(re, im, cur);
    let flux = 0;
    for (let k = 1; k < bins; k++) {
      const v = Math.log1p(100 * cur[k]);
      cur[k] = v;
      if (f && v > prev[k]) flux += v - prev[k];
    }
    env[f] = flux;
    [prev, cur] = [cur, prev];
    if (f % 2000 === 0) await tick(); // не подвешиваем страницу
  }
  // Убираем медленные изменения громкости: вычитаем среднее за ~0.5 с.
  const w = Math.round(FPS * 0.25);
  const out = new Float32Array(env.length);
  let sum = 0;
  for (let i = 0; i < env.length + w; i++) {
    if (i < env.length) sum += env[i];
    if (i - 2 * w - 1 >= 0) sum -= env[i - 2 * w - 1];
    const c = i - w;
    if (c >= 0 && c < env.length) {
      const cnt = Math.min(c + w, env.length - 1) - Math.max(c - w, 0) + 1;
      out[c] = Math.max(0, env[c] - sum / cnt);
    }
  }
  return out;
}

// Значение огибающей в дробной позиции (линейная интерполяция).
const at = (env, x) => {
  const i = Math.floor(x), f = x - i;
  return i + 1 < env.length ? env[i] * (1 - f) + env[i + 1] * f : 0;
};

// Насколько сетка с данным периодом (в кадрах) совпадает с атаками; лучший сдвиг.
function gridScore(env, period) {
  const steps = Math.max(8, Math.round(period * 2));
  let best = -1, bestPhase = 0;
  for (let s = 0; s < steps; s++) {
    const phase = period * s / steps;
    let sum = 0, n = 0;
    for (let x = phase; x < env.length - 1; x += period) { sum += at(env, x); n++; }
    const score = n ? sum / n : 0;
    if (score > best) { best = score; bestPhase = phase; }
  }
  return { score: best, phase: bestPhase };
}

export async function detectTempo(url, { onProgress } = {}) {
  onProgress?.('Скачиваю запись…');
  const data = await (await fetch(url)).arrayBuffer();
  onProgress?.('Слушаю ритм…');
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const tmp = new Ctx();
  const decoded = await tmp.decodeAudioData(data);
  tmp.close();
  // Для темпа хватает первых 4 минут.
  const dur = Math.min(decoded.duration, 240);
  const off = new OfflineAudioContext(1, Math.ceil(dur * SR), SR);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const mono = (await off.startRendering()).getChannelData(0);
  const env = await onsetEnvelope(mono);
  await tick();

  // Автокорреляция по периодам 60–200 BPM с лёгким предпочтением 90–130 BPM.
  const minLag = Math.floor(FPS * 60 / 200), maxLag = Math.ceil(FPS * 60 / 60);
  let bestLag = minLag, bestVal = -Infinity;
  const ac = new Float32Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = 0; i + lag < env.length; i++) s += env[i] * env[i + lag];
    ac[lag] = s / (env.length - lag);
  }
  for (let lag = minLag + 1; lag <= maxLag; lag++) {
    const bpm = 60 * FPS / lag;
    const weight = Math.exp(-0.5 * (Math.log2(bpm / 115) / 0.9) ** 2);
    const v = ac[lag] * weight;
    if (v > bestVal && ac[lag] >= ac[lag - 1] && ac[lag] >= ac[lag + 1]) { bestVal = v; bestLag = lag; }
  }
  // Уточнение с точностью до сотых BPM по всей записи (иначе к концу песни метроном «уплывёт»).
  const rough = 60 * FPS / bestLag;
  let best = { bpm: rough, score: -1, phase: 0 };
  for (const [range, step] of [[3, 0.1], [0.12, 0.005]]) {
    const center = best.bpm;
    for (let bpm = center - range; bpm <= center + range; bpm += step) {
      const g = gridScore(env, 60 * FPS / bpm);
      if (g.score > best.score) best = { bpm, ...g };
    }
    await tick();
  }
  // Сдвиг первой доли в секундах (половина окна — поправка на положение кадра).
  // (поправка +30 мс подобрана по тестовым записям с известными долями)
  const offset = (best.phase + FFT / HOP / 2) / FPS + 0.03;
  const period = 60 / best.bpm;
  return { bpm: Math.round(best.bpm * 100) / 100, offset: Math.round((offset % period) * 1000) / 1000 };
}
