export function parseRoute(hash) {
  const route = hash.replace(/^#\/?/, '');
  const archive = route.match(/^t\/([\w-]{8,})\/archive$/);
  if (archive) return { mode: 't', key: archive[1], folder: null, song: null, archive: true };
  const match = route.match(/^([ts])\/([\w-]{8,})(?:\/s\/([^/]+))?(?:\/song\/([^/]+))?$/);
  if (!match || (match[1] === 's' && match[3])) return null;
  try {
    return {mode: match[1], key: match[2], folder: match[3] ? decodeURIComponent(match[3]) : null,
      song: match[4] ? decodeURIComponent(match[4]) : null};
  } catch { return null; }
}

export function studentPath(role, key, folder) {
  return role === 'teacher' ? `#/t/${key}/s/${encodeURIComponent(folder)}` : `#/s/${key}`;
}

export function songPath(role, key, folder, song) {
  return `${studentPath(role, key, folder)}/song/${encodeURIComponent(song)}`;
}
