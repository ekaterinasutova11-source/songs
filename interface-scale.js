export const SCALE_KEY = 'songs:interface-scale';

export function normalizedScale(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || value == null || String(value).trim() === '') return 100;
  return Math.min(150, Math.max(85, Math.round(number)));
}

export function readScale(storage) {
  try { return normalizedScale(storage.getItem(SCALE_KEY)); }
  catch { return 100; }
}

export function applyScale(root, storage, value) {
  const scale = normalizedScale(value);
  root.style.setProperty('--interface-scale', String(scale / 100));
  root.dataset.interfaceScale = String(scale);
  try { storage.setItem(SCALE_KEY, String(scale)); } catch { /* Private mode still scales this page. */ }
  return scale;
}
