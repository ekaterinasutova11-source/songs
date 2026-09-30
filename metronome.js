// Метроном, привязанный к времени внутри записи: щелчки попадают в доли песни
// при любой скорости воспроизведения, после перемотки и паузы.

export class Metronome {
  constructor(audio) {
    this.audio = audio;
    this.ctx = null;
    this.gain = null;
    this.bpm = 0;
    this.offset = 0;
    this.on = false;
    this.volume = 0.6;
    this.timer = null;
    this.nextBeat = null; // номер следующей доли, которую ещё не запланировали
    this.onBeat = null;   // (номер доли) → для мигающего индикатора
    for (const ev of ['seeking', 'seeked', 'play', 'ratechange']) audio.addEventListener(ev, () => { this.nextBeat = null; });
  }

  setTempo(bpm, offset) {
    this.bpm = bpm;
    this.offset = offset;
    this.nextBeat = null;
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
    }
    this.ctx.resume();
    this.on = true;
    this.nextBeat = null;
    clearInterval(this.timer);
    this.timer = setInterval(() => this.schedule(), 25);
  }

  stop() {
    this.on = false;
    clearInterval(this.timer);
  }

  // «Попасть в долю»: пользователь нажимает в момент доли — сдвигаем сетку к этому месту.
  tap() {
    if (!this.bpm) return;
    const period = 60 / this.bpm;
    this.offset = ((this.audio.currentTime - this.outputLag()) % period + period) % period;
    this.nextBeat = null;
    return this.offset;
  }

  outputLag() {
    return (this.ctx?.outputLatency || 0) + (this.ctx?.baseLatency || 0);
  }

  click(when, accent) {
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.frequency.value = accent ? 1600 : 1100;
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(1, when + 0.001);
    env.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
    osc.connect(env).connect(this.gain);
    osc.start(when);
    osc.stop(when + 0.06);
  }

  schedule() {
    const a = this.audio;
    if (!this.on || !this.bpm || a.paused || a.seeking || !this.ctx) return;
    const rate = a.playbackRate || 1;
    const period = 60 / this.bpm;
    const now = a.currentTime;
    const ahead = 0.12 * rate; // планируем на 120 мс вперёд
    const first = Math.ceil((now - this.offset) / period - 1e-6);
    if (this.nextBeat === null || this.nextBeat < first) this.nextBeat = first;
    for (;;) {
      const t = this.offset + this.nextBeat * period;
      if (t > now + ahead) break;
      if (t >= now - 0.01 && t <= a.duration) {
        const when = this.ctx.currentTime + (t - now) / rate;
        this.click(Math.max(when, this.ctx.currentTime), false);
        const n = this.nextBeat;
        if (this.onBeat) setTimeout(() => this.onBeat(n), Math.max(0, (when - this.ctx.currentTime) * 1000));
      }
      this.nextBeat++;
    }
  }
}
