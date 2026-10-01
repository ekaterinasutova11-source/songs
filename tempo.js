// Определение темпа (BPM) и положения долей по аудиофайлу.
// 1. Декодируем и пересэмплируем в моно 11025 Гц.
// 2. Считаем «силу атак» (spectral flux) — где в музыке появляются новые звуки.
// 3. Автокорреляцией находим период, затем уточняем темп и сдвиг так,
//    чтобы сетка долей точнее всего совпадала с атаками на протяжении всей песни.

const SR = 11025;
// Короткое окно уменьшает опережение атак: длинное окно замечало
// удар задолго до его центра и требовало произвольного сдвига щелчков.
const FFT = 512;
const HOP = 128;
const FPS = SR / HOP; // ≈ 86 кадров в секунду
export const TEMPO_VERSION = 2;

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
    // Среднее по долям предпочитало половинный темп: он мог пропускать
    // половину столь же сильных атак без какого-либо штрафа.
    const score = n ? sum / Math.sqrt(n) : 0;
    if (score > best) { best = score; bestPhase = phase; }
  }
  return { score: best, phase: bestPhase };
}

export async function detectTempo(url, { onProgress, signal } = {}) {
  onProgress?.('Скачиваю запись…');
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Не удалось загрузить запись (${response.status})`);
  const data = await response.arrayBuffer();
  onProgress?.('Слушаю ритм…');
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const tmp = new Ctx();
  let decoded;
  try { decoded = await tmp.decodeAudioData(data); } finally { await tmp.close(); }
  signal?.throwIfAborted();
  const dur = decoded.duration;
  const off = new OfflineAudioContext(1, Math.ceil(dur * SR), SR);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const mono = (await off.startRendering()).getChannelData(0);
  return analyzeSamples(mono, { signal });
}

// Отдельный вход для проверки на сигналах с заранее известным ритмом.
export async function analyzeSamples(mono, { signal } = {}) {
  const env = await onsetEnvelope(mono);
  signal?.throwIfAborted();
  return analyzeOnsets(env, { signal });
}

export async function analyzeOnsets(env, { signal } = {}) {
  await tick();
  let energy = 0;
  for (const v of env) energy += v * v;
  if (env.length < FPS * 4 || energy < 1e-8) throw new Error('В записи нет достаточно отчётливого ритма');
  // Больше не превращаем быстрые песни в медленные по одному порогу BPM.
  // Рассматриваем несколько локальных максимумов, а не единственный период.
  const minLag = Math.floor(FPS * 60 / 240), maxLag = Math.ceil(FPS * 60 / 45);
  let bestLag = minLag, bestVal = -Infinity;
  const candidates = [];
  const ac = new Float32Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = 0; i + lag < env.length; i++) s += env[i] * env[i + lag];
    ac[lag] = s / Math.max(1, env.length - lag);
  }
  for (let lag = minLag + 1; lag <= maxLag; lag++) {
    const bpm = 60 * FPS / lag;
    const weight = Math.exp(-0.5 * (Math.log2(bpm / 115) / 2) ** 2);
    const v = ac[lag] * weight;
    if (ac[lag] >= ac[lag - 1] && ac[lag] >= ac[lag + 1]) candidates.push({ bpm, value: v });
    if (v > bestVal && ac[lag] >= ac[lag - 1] && ac[lag] >= ac[lag + 1]) { bestVal = v; bestLag = lag; }
  }
  // Уточнение сетки: точность BPM важна на длинных ровных фонограммах.
  candidates.sort((a, b) => b.value - a.value);
  let best = { bpm: 60 * FPS / bestLag, score: -1, phase: 0 };
  for (const candidate of candidates.filter(c => c.value > bestVal * 0.45).slice(0, 5)) {
    const center = candidate.bpm;
    const range = Math.max(3, center * center / (60 * FPS) * 0.7);
    for (let bpm = Math.max(45, center - range); bpm <= Math.min(240, center + range); bpm += 0.1) {
      const g = gridScore(env, 60 * FPS / bpm);
      if (g.score > best.score) best = { bpm, ...g };
    }
    signal?.throwIfAborted();
    await tick();
  }
  for (const [range, step] of [[0.12, 0.005]]) {
    const center = best.bpm;
    for (let bpm = center - range; bpm <= center + range; bpm += step) {
      const g = gridScore(env, 60 * FPS / bpm);
      if (g.score > best.score) best = { bpm, ...g };
    }
    signal?.throwIfAborted();
    await tick();
  }
  // Никакой произвольной поправки +30 мс: время относится к центру FFT-окна.
  const toSec = f => (f + FFT / HOP / 2) / FPS;
  const bpm = best.bpm;
  let frames = trackBeats(env, 60 * FPS / bpm, best.phase);
  const period = 60 * FPS / bpm;
  const residuals = frames.map(f => {
    const nearest = best.phase + Math.round((f - best.phase) / period) * period;
    return Math.abs(f - nearest);
  }).sort((a, b) => a - b);
  // Если запись ровная, используем уточнённую сетку. Отдельные слоги
  // и акценты не должны заставлять щелчки гулять вокруг точного темпа.
  if (frames.length > 8 && residuals[Math.floor(residuals.length * 0.9)] < FPS * 0.035) {
    const first = frames[0], last = frames[frames.length - 1];
    frames = [];
    for (let k = Math.ceil((first - best.phase - FPS * 0.035) / period); ; k++) {
      const f = best.phase + k * period;
      if (f > last + FPS * 0.035) break;
      if (f >= 0) frames.push(f);
    }
  }
  const beats = frames.map(toSec);
  if (beats.length < 4) throw new Error('Не получилось найти доли');
  // Оценка того, насколько найденные доли поддержаны звуковыми атаками.
  // Она не гарантирует верный музыкальный выбор между четвертями и восьмыми.
  const mean = env.reduce((s, v) => s + v, 0) / env.length;
  const supported = frames.filter(f => at(env, f) > mean).length / frames.length;
  const p = 60 / bpm;
  return {
    bpm: Math.round(bpm * 100) / 100,
    offset: Math.round((beats[0] % p) * 1000) / 1000,
    beats,
    uncertain: supported < 0.65,
  };
}

// Поиск каждой доли отдельно (динамическое программирование, метод Эллиса):
// доли должны стоять на сильных атаках, а расстояние между соседними — быть близким к периоду.
// Так метроном следует за живой музыкой, даже если темп немного «дышит».
function trackBeats(env, period, phase) {
  const n = env.length;
  if (n < period * 4) return [];
  let mean = 0, sq = 0;
  for (const v of env) { mean += v; sq += v * v; }
  mean /= n;
  const std = Math.sqrt(sq / n - mean * mean) || 1;
  const o = Float32Array.from(env, v => v / std);
  const TIGHT = 100;
  // Локальный период позволяет следовать постепенному изменению темпа.
  // Ищем его рядом с основным, чтобы не прыгать между четвертями и восьмыми.
  const stride = Math.round(FPS * 4), radius = Math.round(FPS * 6);
  const periods = [];
  for (let c = 0; c < n; c += stride) {
    let best = -Infinity, chosen = period;
    for (let lag = Math.floor(period * 0.8); lag <= Math.ceil(period * 1.25); lag++) {
      let sum = 0, count = 0;
      for (let i = Math.max(0, c - radius); i < Math.min(n - lag, c + radius); i++) { sum += o[i] * o[i + lag]; count++; }
      const value = sum / Math.max(1, count) * Math.exp(-2 * Math.log(lag / period) ** 2);
      if (value > best) { best = value; chosen = lag; }
    }
    periods.push(chosen);
  }
  const score = new Float32Array(n), from = new Int32Array(n).fill(-1);
  const lo = Math.round(period / 2), hi = Math.round(period * 2);
  for (let t = 0; t < n; t++) {
    const index = Math.floor(t / stride), fraction = t / stride - index;
    const localPeriod = periods[index] * (1 - fraction) + (periods[index + 1] ?? periods[index]) * fraction;
    let best = 0, arg = -1;
    for (let p = t - hi; p <= t - lo; p++) {
      if (p < 0) continue;
      const c = score[p] - TIGHT * Math.log((t - p) / localPeriod) ** 2;
      if (c > best) { best = c; arg = p; }
    }
    // Начальная доля учитывает фазу, уже найденную при уточнении сетки.
    const distance = Math.abs(((t - phase + period * 100) % period) - period / 2);
    const initial = Math.exp(-0.5 * ((period / 2 - distance) / (period / 8)) ** 2);
    score[t] = o[t] + (arg >= 0 ? best : initial);
    from[t] = arg;
  }
  // Последняя доля — лучшая точка среди последних двух периодов.
  let t = n - 1;
  for (let i = Math.max(0, n - Math.round(period * 2)); i < n; i++) if (score[i] > score[t]) t = i;
  const beats = [];
  for (; t >= 0; t = from[t]) beats.push(t);
  beats.reverse();
  // Не кликаем в пустом вступлении и после затухания.
  const active = beats.filter(f => o[f] > mean / std * 0.5);
  if (!active.length) return [];
  return beats.filter(f => f >= active[0] && f <= active[active.length - 1]);
}
