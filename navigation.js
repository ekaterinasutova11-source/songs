export function parseRoute(hash) {
  const route = hash.replace(/^#\/?/, '');
  const archive = route.match(/^t\/([\w-]{8,})\/archive$/);
  if (archive) return { mode: 't', key: archive[1], folder: null, song: null, archive: true };
  const space = route.match(/^s\/([\w-]{8,})\/space\/([^/]+)(?:\/song\/([^/]+))?$/);
  if (space) {
    try {
      return {mode: 's', key: space[1], folder: decodeURIComponent(space[2]),
        song: space[3] ? decodeURIComponent(space[3]) : null};
    } catch { return null; }
  }
  const match = route.match(/^([ts])\/([\w-]{8,})(?:\/s\/([^/]+))?(?:\/song\/([^/]+))?$/);
  if (!match || (match[1] === 's' && match[3])) return null;
  try {
    return {mode: match[1], key: match[2], folder: match[3] ? decodeURIComponent(match[3]) : null,
      song: match[4] ? decodeURIComponent(match[4]) : null};
  } catch { return null; }
}

export function studentPath(role, key, folder, ownId = null) {
  if (role === 'teacher') return `#/t/${key}/s/${encodeURIComponent(folder)}`;
  return ownId && folder && folder !== ownId ? `#/s/${key}/space/${encodeURIComponent(folder)}` : `#/s/${key}`;
}

export function songPath(role, key, folder, song, ownId = null) {
  return `${studentPath(role, key, folder, ownId)}/song/${encodeURIComponent(song)}`;
}

// Routing can only choose a space already returned by the authorized library.
export function selectStudentSpace(spaces, ownId, folder = null) {
  return spaces.find(space => space.id === (folder || ownId)) || null;
}

export function canEditSpace(role, ownId, space) {
  return role === 'teacher' || (role === 'student' && space.id === ownId && (!space.kind || space.kind === 'individual'));
}
