// Метроном, привязанный к времени внутри записи: щелчки попадают в доли песни
// при любой скорости воспроизведения, после перемотки и паузы.
//
// Доли берутся либо из списка (найдены по записи и «дышат» вместе с музыкой),
// либо из ровной сетки (темп + сдвиг) — например, если темп настучали вручную.
//
// Музыка и щелчки идут через один AudioContext, поэтому у них одинаковая задержка
// вывода (важно для Bluetooth-наушников, где она бывает 0,1–0,3 с).

export class Metronome {
  constructor(audio) {
    this.audio = audio;
    this.ctx = null;
    this.gain = null;
    this.bpm = 0;
    this.offset = 0;
    this.beats = null;      // список долей в секундах записи или null
    this.on = false;
    this.volume = 0.6;
    this.timer = null;
    this.lastScheduled = -Infinity;
    this.onBeat = null;
    this.pending = new Set();
    this.visualTimers = new Set();
    this.source = null;
    this.previousAudioTime = null;
    for (const ev of ['seeking', 'seeked', 'play', 'pause', 'waiting', 'playing', 'ended', 'emptied', 'ratechange']) audio?.addEventListener(ev, () => this.reset());
    audio?.addEventListener('play', () => this.ctx?.resume());
  }

  reset() {
    for (const osc of this.pending) { try { osc.stop(); } catch {} osc.disconnect(); }
    this.pending.clear();
    for (const timer of this.visualTimers) clearTimeout(timer);
    this.visualTimers.clear();
    this.lastScheduled = -Infinity;
    this.previousAudioTime = null;
  }

  setGrid(bpm, offset) {
    this.bpm = bpm;
    this.offset = offset;
    this.beats = null;
    this.reset();
  }

  setBeats(beats, bpm) {
    this.beats = beats?.length ? beats : null;
    this.bpm = bpm;
    this.offset = beats?.[0] || 0;
    this.reset();
  }

  // ½: оставить каждую вторую долю; ×2: добавить доли посередине.
  half() {
    if (this.beats) this.beats = this.beats.filter((_, i) => i % 2 === 0);
    this.bpm /= 2;
    this.reset();
  }

  double() {
    if (this.beats) {
      const out = [];
      this.beats.forEach((b, i) => { out.push(b); if (i + 1 < this.beats.length) out.push((b + this.beats[i + 1]) / 2); });
      this.beats = out;
    }
    this.bpm *= 2;
    this.offset %= 60 / this.bpm;
    this.reset();
  }

  // Сдвинуть все доли так, чтобы ближайшая оказалась в момент нажатия.
  alignTo(t) {
    if (this.beats) {
      const i = this.nearestIndex(t);
      const delta = t - this.beats[i];
      this.beats = this.beats.map(b => b + delta);
    } else if (this.bpm) {
      const period = 60 / this.bpm;
      this.offset = ((t % period) + period) % period;
    }
    this.reset();
  }

  shift(delta) {
    if (this.beats) this.beats = this.beats.map(b => b + delta);
    this.offset += delta;
    this.reset();
  }

  nearestIndex(t) {
    const b = this.beats;
    let lo = 0, hi = b.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (b[mid] < t) lo = mid + 1; else hi = mid; }
    return lo > 0 && Math.abs(b[lo - 1] - t) < Math.abs(b[lo] - t) ? lo - 1 : lo;
  }

  // Момент, который слушатель слышит прямо сейчас (с учётом задержки вывода).
  heardTime() {
    const stamp = this.ctx?.getOutputTimestamp?.();
    const lag = stamp?.contextTime > 0
      ? Math.max(0, this.ctx.currentTime - stamp.contextTime - (performance.now() - stamp.performanceTime) / 1000)
      : (this.ctx?.outputLatency || 0) + (this.ctx?.baseLatency || 0);
    return this.audio.currentTime - lag * (this.audio.playbackRate || 1);
  }

  setVolume(v) {
    this.volume = v;
    if (this.gain) this.gain.gain.value = v;
  }

  // Вызывать из обработчика нажатия: браузеры разрешают звук только после действия пользователя.
  start() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx({ latencyHint: 'interactive' });
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.ctx.destination);
      // Пускаем музыку через тот же AudioContext (нужен crossOrigin у <audio>).
      if (this.audio) try {
        this.source = this.ctx.createMediaElementSource(this.audio);
        this.source.connect(this.ctx.destination);
      } catch { /* уже подключено или браузер не умеет — щелчки всё равно будут */ }
    }
    this.ctx.resume();
    this.on = true;
    this.reset();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.schedule(), 25);
  }

  stop() {
    this.on = false;
    clearInterval(this.timer);
    this.reset();
  }

  click(when) {
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.frequency.value = 1300;
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(1, when + 0.001);
    env.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
    osc.connect(env).connect(this.gain);
    this.pending.add(osc);
    osc.onended = () => { this.pending.delete(osc); osc.disconnect(); env.disconnect(); };
    osc.start(when);
    osc.stop(when + 0.06);
  }

  // Доли в промежутке [a, b] времени записи.
  beatsBetween(a, b) {
    const out = [];
    if (this.beats) {
      const list = this.beats;
      let i = this.nearestIndex(a);
      if (list[i] < a) i++;
      for (; i < list.length && list[i] <= b; i++) out.push(list[i]);
      // Не придумываем доли после конца разметки (затухание, тишина).
    } else if (this.bpm) {
      const period = 60 / this.bpm;
      for (let k = Math.ceil((a - this.offset) / period); ; k++) {
        const t = this.offset + k * period;
        if (t > b) break;
        out.push(t);
      }
    }
    return out;
  }

  schedule() {
    const a = this.audio;
    if (!this.on || !this.bpm || a.paused || a.seeking || a.readyState < 3 || !this.ctx || this.ctx.state !== 'running') return;
    const rate = a.playbackRate || 1;
    const now = a.currentTime;
    // Зацикливание записи не во всех браузерах вызывает seeking.
    if (this.previousAudioTime !== null && now < this.previousAudioTime - 0.05) this.reset();
    this.previousAudioTime = now;
    for (const t of this.beatsBetween(Math.max(now - 0.01, this.lastScheduled + 1e-3), now + 0.12 * rate)) {
      if (t > a.duration) break;
      const when = Math.max(this.ctx.currentTime, this.ctx.currentTime + (t - now) / rate);
      this.click(when);
      this.lastScheduled = t;
      if (this.onBeat) {
        const timer = setTimeout(() => { this.visualTimers.delete(timer); this.onBeat?.(); }, Math.max(0, (when - this.ctx.currentTime) * 1000));
        this.visualTimers.add(timer);
      }
    }
  }
}

// Самостоятельный метроном: его часы — AudioContext, аудиозапись не нужна.
const repeatHits = (hits, bars) => Array.from({ length: bars }, (_, bar) => hits.map(hit => hit + bar * 16)).flat();
export const DRUM_PATTERNS = {
  click: { name: 'Щелчки', steps: 4 },
  pop: { name: 'Поп · 4/4', steps: 16, kick: [0, 8], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
  soft: { name: 'Мягкий · 4/4', steps: 16, kick: [0, 8], rim: [4, 12], shaker: [0, 2, 4, 6, 8, 10, 12, 14] },
  rock: { name: 'Рок · 4/4', steps: 16, kick: [0, 6, 8, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
  hiphop: { name: 'Хип-хоп · 4/4', steps: 16, kick: [0, 7, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14, 15] },
  waltz: { name: 'Вальс · 3/4', steps: 12, kick: [0], rim: [4, 8], shaker: [0, 2, 4, 6, 8, 10] },
  funk: { name: 'Фанк · шуршащий', steps: 32, kick: [0, 3, 10, 16, 22, 26, 30], snare: [4, 12, 20, 28], ghost: [7, 15, 19, 25, 31], hat: [...repeatHits([0, 1, 2, 4, 5, 7, 8, 9, 10, 12, 13, 15], 2)], openhat: [6, 14, 23, 30], levels: { hat: 0.65 } },
  latin: { name: 'Латина · конги', steps: 32, congalow: [0, 6, 12, 16, 22, 28], congahigh: [3, 7, 10, 14, 19, 23, 26, 29, 31], cowbell: [0, 6, 10, 16, 20, 26], shaker: repeatHits([0, 2, 4, 6, 8, 10, 12, 14], 2) },
  breakbeat: { name: 'Брейкбит · ломаный', steps: 32, kick: [0, 6, 10, 16, 19, 26, 30], snare: [4, 12, 20, 27, 28, 31], ghost: [9, 15, 23], hat: [0, 2, 7, 8, 11, 16, 18, 22, 25, 29], openhat: [14, 24], clap: [12, 28], levels: { snare: 1.2, clap: 0.6 } },
  shuffle: { name: 'Шаффл · джазовый', steps: 24, subdivisions: 3, kick: [0, 12], rim: [3, 9, 15, 21], ride: [0, 3, 5, 6, 9, 11, 12, 15, 17, 18, 21, 23], ghost: [8, 20], levels: { kick: 0.65 } },
  popfill: { name: 'Поп · хлопки и сбивка', steps: 64, kick: [...repeatHits([0, 4, 8, 12], 3), 48, 52, 56], clap: [...repeatHits([4, 12], 3), 52, 58, 60, 61, 63], shaker: [...repeatHits([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], 3), 48, 50, 52, 54, 56], openhat: [...repeatHits([2, 6, 10, 14], 3), 50, 54], congahigh: [59, 62], levels: { shaker: 0.6 } },
  rockfill: { name: 'Рок · томы и сбивка', steps: 64, kick: [...repeatHits([0, 6, 8, 10], 3), 48, 54, 56], snare: [...repeatHits([4, 12], 3), 52, 57], ride: [...repeatHits([0, 2, 4, 6, 8, 10, 12, 14], 3), 48, 50, 52, 54], tomhigh: [58, 59], tomlow: [60, 62, 63], levels: { snare: 1.25, ride: 0.8 } },
};

// Частоты, огибающие и фильтры дают каждому инструменту собственный тембр.
const DRUM_VOICES = {
  kick: { duration: 0.22, level: 0.8, tone: [145, 45, 'sine'] },
  rim: { duration: 0.04, level: 0.22, tone: [650, 300, 'triangle'] },
  tomhigh: { duration: 0.18, level: 0.48, tone: [260, 130, 'sine'] },
  tomlow: { duration: 0.28, level: 0.55, tone: [150, 70, 'sine'] },
  congahigh: { duration: 0.095, level: 0.3, tone: [520, 260, 'triangle'] },
  congalow: { duration: 0.16, level: 0.4, tone: [330, 160, 'sine'] },
  cowbell: { duration: 0.065, level: 0.055, tone: [830, 800, 'square'] },
  snare: { duration: 0.15, level: 0.3, filter: ['bandpass', 1800] },
  ghost: { duration: 0.07, level: 0.065, filter: ['bandpass', 1800] },
  clap: { duration: 0.16, level: 0.28, filter: ['bandpass', 1200] },
  hat: { duration: 0.05, level: 0.12, filter: ['highpass', 7000] },
  openhat: { duration: 0.23, level: 0.13, filter: ['highpass', 6500] },
  ride: { duration: 0.32, level: 0.09, filter: ['bandpass', 8500] },
  shaker: { duration: 0.05, level: 0.08, filter: ['bandpass', 4500] },
};

export class StandaloneMetronome extends Metronome {
  constructor() { super(null); this.pattern = 'click'; this.noise = null; this.setTempo(120); }

  setPattern(pattern) {
    if (!Object.hasOwn(DRUM_PATTERNS, pattern)) throw new RangeError('Неизвестный ритм');
    this.pattern = pattern;
    this.setTempo(this.bpm);
  }

  // Собственные синтезированные звуки: ни записи, ни сторонние сэмплы не используются.
  drum(voice, when, velocity = 1) {
    const ctx = this.ctx, env = ctx.createGain();
    const sound = DRUM_VOICES[voice];
    const duration = sound.duration;
    const level = sound.level * velocity;
    let source, filter;
    if (sound.tone) {
      source = ctx.createOscillator();
      source.type = sound.tone[2];
      source.frequency.setValueAtTime(sound.tone[0], when);
      source.frequency.exponentialRampToValueAtTime(sound.tone[1], when + duration);
      source.connect(env);
    } else {
      if (!this.noise) {
        this.noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.5), ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        let seed = 137;
        for (let i = 0; i < data.length; i++) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; data[i] = (seed >>> 0) / 2147483648 - 1; }
      }
      source = ctx.createBufferSource(); source.buffer = this.noise;
      filter = ctx.createBiquadFilter();
      filter.type = sound.filter[0];
      filter.frequency.value = sound.filter[1];
      filter.Q.value = 0.7;
      source.connect(filter).connect(env);
    }
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(level, when + 0.002);
    if (voice === 'clap') {
      // Три коротких импульса создают хлопок с широким хвостом.
      for (const offset of [0.012, 0.024]) {
        env.gain.linearRampToValueAtTime(level * 0.08, when + offset - 0.002);
        env.gain.linearRampToValueAtTime(level, when + offset);
      }
    }
    env.gain.exponentialRampToValueAtTime(0.001, when + duration);
    env.connect(this.gain);
    this.pending.add(source);
    source.onended = () => { this.pending.delete(source); source.disconnect(); filter?.disconnect(); env.disconnect(); };
    source.start(when); source.stop(when + duration + 0.01);
  }

  setTempo(bpm) {
    if (!Number.isFinite(bpm) || bpm < 1 || bpm > 999) throw new RangeError('Темп — от 1 до 999 BPM');
    this.setGrid(bpm, (this.ctx?.currentTime || 0) + 0.04);
  }

  start() {
    super.start();
    this.offset = this.ctx.currentTime + 0.04;
    this.schedule();
  }

  schedule() {
    if (!this.on || !this.bpm || this.ctx?.state !== 'running') return;
    const now = this.ctx.currentTime;
    // После долгой задержки вкладки пропускаем старые удары без пачки щелчков.
    const pattern = DRUM_PATTERNS[this.pattern];
    const subdivisions = this.pattern === 'click' ? 1 : (pattern.subdivisions || 4);
    const step = 60 / this.bpm / subdivisions;
    const first = Math.max(0, Math.ceil((Math.max(now, this.lastScheduled + 1e-5) - this.offset) / step));
    for (let k = first; ; k++) {
      const t = this.offset + k * step;
      if (t > now + 0.12) break;
      if (this.pattern === 'click') this.click(t);
      else {
        const position = k % pattern.steps;
        for (const voice of Object.keys(DRUM_VOICES)) {
          if (pattern[voice]?.includes(position)) this.drum(voice, t, (position % subdivisions ? 0.65 : 1) * (pattern.levels?.[voice] ?? 1));
        }
      }
      this.lastScheduled = t;
      if (this.onBeat && k % subdivisions === 0) {
        const timer = setTimeout(() => { this.visualTimers.delete(timer); this.onBeat?.(); }, Math.max(0, (t - now) * 1000));
        this.visualTimers.add(timer);
      }
    }
  }
}

// «Настучать»: по нажатиям в такт (время записи) находим темп и положение долей.
export function fitTaps(taps) {
  if (taps.length < 4) return null;
  const iv = taps.slice(1).map((t, i) => t - taps[i]).sort((x, y) => x - y);
  const med = iv[iv.length >> 1];
  if (!(med > 0.2 && med < 2)) return null;
  // Номер доли для каждого нажатия (на случай пропущенного удара).
  const k = taps.map(t => Math.round((t - taps[0]) / med));
  const n = taps.length;
  const mk = k.reduce((s, x) => s + x, 0) / n, mt = taps.reduce((s, x) => s + x, 0) / n;
  let num = 0, den = 0;
  taps.forEach((t, i) => { num += (k[i] - mk) * (t - mt); den += (k[i] - mk) ** 2; });
  const period = den ? num / den : med;
  const offset = mt - mk * period;
  return { bpm: 60 / period, offset: ((offset % period) + period) % period };
}
