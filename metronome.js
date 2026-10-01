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
export class StandaloneMetronome extends Metronome {
  constructor() { super(null); this.setTempo(120); }

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
    for (const t of this.beatsBetween(Math.max(now, this.lastScheduled + 1e-5), now + 0.12)) {
      this.click(t);
      this.lastScheduled = t;
      if (this.onBeat) {
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
