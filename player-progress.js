// Keep the range in sync even if a touch gesture is cancelled or the source changes.
export function attachProgress(audio, {seek, current, duration, format, onUpdate = () => {}, canSeek = () => true, win = window}) {
  let dragging = false;
  const ready = () => canSeek() && Number.isFinite(audio.duration) && audio.duration > 0 && audio.readyState > 0;
  function sync() {
    seek.disabled = !ready();
    duration.textContent = format(ready() ? audio.duration : 0);
    if (dragging) return;
    const time = ready() ? Math.max(0, Math.min(audio.duration, audio.currentTime || 0)) : 0;
    seek.value = ready() ? Math.round(time / audio.duration * 1000) : 0;
    seek.style.setProperty('--p', `${Number(seek.value) / 10}%`);
    current.textContent = format(time);
    onUpdate();
  }
  function seekTo(time) {
    if (!ready() || !Number.isFinite(time)) { reset(); return false; }
    try { audio.currentTime = Math.max(0, Math.min(audio.duration, time)); return true; }
    catch { return false; }
    finally { dragging = false; sync(); }
  }
  function reset() { dragging = false; sync(); }
  function commit() {
    if (dragging) seekTo(Number(seek.value) / 1000 * audio.duration);
    else sync();
  }
  seek.addEventListener('input', () => {
    if (!ready()) return reset();
    dragging = true;
    current.textContent = format(Number(seek.value) / 1000 * audio.duration);
    seek.style.setProperty('--p', `${Number(seek.value) / 10}%`);
  });
  for (const name of ['change', 'pointerup', 'blur']) seek.addEventListener(name, commit);
  for (const name of ['pointercancel', 'touchcancel']) seek.addEventListener(name, reset);
  win.addEventListener('blur', reset);
  for (const name of ['loadedmetadata', 'durationchange', 'timeupdate', 'seeked', 'ended']) audio.addEventListener(name, sync);
  audio.addEventListener('emptied', reset);
  sync();
  return {reset, sync, seekTo};
}
