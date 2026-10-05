// Огибающая реального звука. Все каналы учитываются независимо, без фазового вычитания.
export function audioPeaks(channels, bins = 2048) {
  const length = channels[0]?.length || 0;
  const count = Math.min(bins, length);
  const peaks = new Float32Array(count);
  for (let b = 0; b < count; b++) {
    const from = Math.floor(b * length / count), to = Math.floor((b + 1) * length / count);
    let max = 0;
    for (const channel of channels) for (let i = from; i < to; i++) max = Math.max(max, Math.abs(channel[i] || 0));
    peaks[b] = max;
  }
  return peaks;
}

export async function loadWaveform(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Аудио недоступно (${response.status})`);
  const bytes = await response.arrayBuffer();
  signal?.throwIfAborted();
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  // Для визуальной огибающей достаточно 12 кГц; не держим полную запись в 48 кГц.
  const context = new Ctx(1, 1, 12000);
  const buffer = await context.decodeAudioData(bytes);
  signal?.throwIfAborted();
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const peaks = audioPeaks(channels);
  signal?.throwIfAborted();
  return peaks;
}

export function drawWaveform(canvas, peaks, progress = 0) {
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (!width || !height) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  if (!peaks?.length) return;
  const style = getComputedStyle(canvas);
  const unplayed = style.getPropertyValue('--wave-rest').trim();
  const played = style.getPropertyValue('--accent').trim();
  const bars = Math.max(1, Math.floor(width / 3.5));
  // Линейная общая шкала сохраняет разницу между тихими и громкими фрагментами.
  let max = 0;
  for (const peak of peaks) max = Math.max(max, peak);
  for (let b = 0; b < bars; b++) {
    let peak = 0;
    const from = Math.floor(b * peaks.length / bars), to = Math.max(from + 1, Math.floor((b + 1) * peaks.length / bars));
    for (let i = from; i < to; i++) peak = Math.max(peak, peaks[i] || 0);
    const amplitude = max ? peak / max : 0;
    const barHeight = Math.max(1, amplitude * (height - 6));
    const x = (b + 0.5) * width / bars;
    ctx.fillStyle = x / width <= progress ? played : unplayed;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x - 0.65, (height - barHeight) / 2, 1.3, barHeight, 0.65);
    else ctx.rect(x - 0.65, (height - barHeight) / 2, 1.3, barHeight);
    ctx.fill();
  }
}
