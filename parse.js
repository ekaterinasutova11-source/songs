// Разбор имени файла вида «Название + (вариант).mp3» на песню и вариант.

export const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|oga|flac|opus|webm)$/i;
export const LYRICS_EXT = /\.txt$/i;

// Ищем последний знак «+» или «-», стоящий вне скобок и отделённый от слов
// (после него — конец строки, пробел или скобка). Так «Aerials + (-3)»
// даёт знак «+», а дефисы внутри слов не трогаем.
function findSign(s) {
  let depth = 0, found = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && (c === '+' || c === '-' || c === '−' || c === '–')) {
      const next = s[i + 1];
      if (next === undefined || next === ' ' || next === '(') found = i;
    }
  }
  return found;
}

function cleanLabel(s) {
  return s.trim().replace(/^\((.*)\)$/, '$1').trim();
}

// Ключ для группировки: без регистра, ё = е, без диакритики и лишних пробелов.
export function songKey(title) {
  return title
    .toLowerCase()
    .replace(/ё/g, 'е')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’'`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseFileName(fileName) {
  const base = fileName.replace(/\.[^.]+$/, '').trim();
  const i = findSign(base);
  if (i >= 0) {
    const title = base.slice(0, i).trim();
    const kind = base[i] === '+' ? 'plus' : 'minus';
    return { title: title || base, kind, label: cleanLabel(base.slice(i + 1)) };
  }
  // Без знака: «Название (оригинал)» или просто «Название» — это исходная запись.
  const m = base.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  if (m && m[1]) return { title: m[1].trim(), kind: 'orig', label: m[2].trim() };
  return { title: base, kind: 'orig', label: '' };
}

// Имя нового файла по названию песни, типу и пометке: «Спички - (медленный).mp3».
export function buildFileName(title, kind, label, ext) {
  label = label.trim();
  if (kind === 'orig') return `${title} (${label || 'оригинал'})${ext}`;
  return `${title} ${kind === 'plus' ? '+' : '-'}${label ? ` (${label})` : ''}${ext}`;
}

// То же имя файла, но с другим названием песни (пометки и расширение сохраняются).
export function retitleFileName(fileName, newTitle) {
  if (LYRICS_EXT.test(fileName)) return `${newTitle}.txt`;
  const { title } = parseFileName(fileName);
  return newTitle + fileName.slice(fileName.indexOf(title) + title.length);
}

const KIND_ORDER ={ plus: 0, minus: 1, orig: 2 };
const KIND_NAME = { plus: 'Плюс', minus: 'Минус', orig: 'Оригинал' };

export function variantName(v) {
  const kind = KIND_NAME[v.kind];
  if (!v.label) return kind;
  if (v.kind === 'orig' && songKey(v.label) === 'оригинал') return kind;
  return `${kind} · ${v.label}`;
}

function capitals(s) {
  return (s.match(/\p{Lu}/gu) || []).length;
}

// items — файлы одной папки: [{name, path, modified, size}]
export function groupSongs(items) {
  const songs = new Map();
  const lyrics = new Map();
  for (const it of items) {
    if (LYRICS_EXT.test(it.name)) {
      const title = it.name.replace(LYRICS_EXT, '').trim();
      lyrics.set(songKey(title), it);
      continue;
    }
    if (!AUDIO_EXT.test(it.name)) continue;
    const p = parseFileName(it.name);
    const key = songKey(p.title);
    if (!songs.has(key)) songs.set(key, { key, title: p.title, variants: [], modified: '' });
    const song = songs.get(key);
    // Из нескольких написаний названия берём то, где больше заглавных букв.
    if (capitals(p.title) > capitals(song.title)) song.title = p.title;
    song.variants.push({ ...p, file: it });
    if (it.modified > song.modified) song.modified = it.modified;
  }
  for (const song of songs.values()) {
    song.lyrics = lyrics.get(song.key) || null;
    song.variants.sort((a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      (a.label ? 1 : 0) - (b.label ? 1 : 0) ||
      a.label.localeCompare(b.label, 'ru'));
  }
  return [...songs.values()];
}
