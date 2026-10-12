// Keep music on the browser's native media path, independent of Web Audio.
export function playbackSession(nav = navigator) {
  try { if (nav.audioSession) nav.audioSession.type = 'playback'; } catch {}
}

// The first play call belongs to the actual tap, before any cloud request.
// A short silent WAV primes this same media element; strict browsers can still
// require a second tap, which the player handles without reporting a failure.
export function primeAudio(audio) {
  const wav = new Uint8Array(44 + 400);
  const view = new DataView(wav.buffer);
  const text = (offset, value) => [...value].forEach((c, i) => {wav[offset + i] = c.charCodeAt(0);});
  text(0, 'RIFF'); view.setUint32(4, wav.length - 8, true); text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true); view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true); view.setUint16(34, 8, true);
  text(36, 'data'); view.setUint32(40, 400, true); wav.fill(128, 44);
  const source = 'data:audio/wav;base64,' + btoa(String.fromCharCode(...wav));
  audio.src = source;
  try { Promise.resolve(audio.play()).then(() => {if (audio.src === source) audio.pause();}).catch(() => {}); } catch {}
}

export function attachMediaControls(audio, {play, stop, nav = navigator} = {}) {
  playbackSession(nav);
  const session = nav.mediaSession;
  if (!session) return () => {};
  const seek = position => {
    if (Number.isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(audio.duration, position));
  };
  const actions = {play, pause: () => audio.pause(), stop,
    seekbackward: details => seek(audio.currentTime - (details.seekOffset || 5)),
    seekforward: details => seek(audio.currentTime + (details.seekOffset || 5)),
    seekto: details => seek(details.seekTime)};
  for (const [name, handler] of Object.entries(actions)) {
    if (handler) try {session.setActionHandler(name, handler);} catch {}
  }
  const update = () => {
    try {
      session.playbackState = audio.ended ? 'none' : audio.paused ? 'paused' : 'playing';
      if (Number.isFinite(audio.duration) && audio.duration > 0) session.setPositionState?.({
        duration: audio.duration, playbackRate: audio.playbackRate || 1,
        position: Math.max(0, Math.min(audio.duration, audio.currentTime || 0))});
    } catch {}
  };
  for (const name of ['play', 'pause', 'ended', 'loadedmetadata', 'seeked', 'ratechange', 'timeupdate'])
    audio.addEventListener(name, update);
  return update;
}
