import fs from 'node:fs';
import { groupSongs, retitleFileName, songKey } from '../parse.js';
import { HttpError, existingName, cleanName } from './local-store.mjs';

export function renameSong(store, folder, body) {
  const data = store.folderData(folder.id);
  const song = groupSongs(data.files).find(song => song.key === body.song);
  if (!song) throw new HttpError(404, 'Песня не найдена');
  const title = cleanName(body.name), key = songKey(title);
  if (['__proto__','constructor','prototype'].includes(key)) throw new HttpError(400, 'Выберите другое название песни');
  if (data.meta[key] && key !== song.key || groupSongs(data.files).some(s => s.key === key && s.key !== song.key)) throw new HttpError(409, 'Песня с таким названием уже есть');
  const names = [...song.variants.map(v => v.file.name), ...(song.lyrics ? [song.lyrics.name] : [])];
  const changes = names.map(name => [name, existingName(retitleFileName(name, title))]);
  for (const [before, after] of changes) if (before !== after && data.files.some(f => f.name === after)) throw new HttpError(409, 'Файл с таким названием уже есть');
  for (const [before, after] of changes) {
    if (before === after) continue;
    store.db.prepare('UPDATE files SET name=? WHERE folder=? AND name=?').run(after, folder.id, before);
  }
  const meta = store.meta(folder.id); meta.songs ??= {};
  if (meta.songs[song.key]) {
    const entry = meta.songs[song.key];
    if (entry.tempo) for (const [before, after] of changes) {
      if (before !== after && entry.tempo[before]) { entry.tempo[after] = entry.tempo[before]; delete entry.tempo[before]; }
    }
    if (entry.timings) {
      entry.timings.track = changes.find(([name]) => name === entry.timings.track)?.[1] ?? entry.timings.track;
      entry.timings.lyrics = changes.find(([name]) => name === entry.timings.lyrics)?.[1] ?? entry.timings.lyrics;
    }
    delete meta.songs[song.key]; meta.songs[key] = entry;
    store.saveMeta(folder.id, meta);
  }
  store.audit('song-rename', {folder: folder.id, from: song.key, to: key});
}

export function saveLyrics(store, folder, body) {
  const name = existingName(body.name);
  if (!/\.txt$/i.test(name) || typeof body.text !== 'string' || Buffer.byteLength(body.text) > 1048576) throw new HttpError(400, 'Некорректный текст песни');
  const data = store.folderData(folder.id);
  const current = data.files.find(file => file.name === name);
  const title = name.replace(/\.txt$/i, '').trim();
  const songs = groupSongs([...data.files, {name, size: 0, modified: ''}]);
  const song = songs.find(song => song.lyrics?.name === name);
  // A pupil may add lyrics for an existing audio song, not invent arbitrary files.
  if (!current && !song?.variants.length) throw new HttpError(400, 'Сначала добавьте песню и аудиодорожку');
  if (!title) throw new HttpError(400, 'Введите название песни');
  if (body.expectedModified !== undefined && (current?.modified ?? null) !== body.expectedModified) throw new HttpError(409, 'Текст уже изменился. Обновите песню перед сохранением');
  store.saveFile(folder.id, name, store.putBytes(Buffer.from(body.text)));
}

export function saveTimings(store, folder, body) {
  const data = store.folderData(folder.id);
  const song = groupSongs(data.files).find(song => song.key === body.song);
  if (!song) throw new HttpError(404, 'Песня не найдена');
  const meta = store.meta(folder.id);
  meta.songs ??= {};
  const entry = meta.songs[body.song] || {};
  if (body.timings === null) {
    delete entry.timings;
  } else {
    const value = body.timings;
    if (!value || value.version !== 1 || !song.lyrics || !Array.isArray(value.lines) || value.lines.length > 4000) throw new HttpError(400, 'Некорректные таймкоды');
    const track = song.variants.find(variant => variant.kind === 'minus' && variant.file.name === value.track)?.file;
    if (!track || track.size !== value.trackSize || track.modified !== value.trackModified ||
        song.lyrics.name !== value.lyrics || song.lyrics.modified !== value.lyricsModified) throw new HttpError(409, 'Текст или минусовка изменились. Обновите привязку таймкодов');
    const file = store.file(folder.id, song.lyrics.name);
    const text = fs.readFileSync(store.blobPath(file.blob), 'utf8').replace(/^\ufeff/, '').split(/\r?\n/);
    const seen = new Set();
    const lines = value.lines.map(line => {
      if (!Number.isInteger(line.line) || line.line < 0 || line.line >= text.length || seen.has(line.line) ||
          typeof line.seconds !== 'number' || !Number.isFinite(line.seconds) || line.seconds < 0 || line.seconds > 86400 ||
          typeof line.text !== 'string' || line.text !== text[line.line]) throw new HttpError(400, 'Проверьте строку и время таймкода');
      seen.add(line.line);
      return {line: line.line, seconds: Math.round(line.seconds * 1000) / 1000, text: line.text};
    }).sort((a, b) => a.line - b.line);
    entry.timings = {version: 1, track: track.name, trackSize: track.size, trackModified: track.modified,
      lyrics: song.lyrics.name, lyricsModified: song.lyrics.modified, lines};
  }
  meta.songs[body.song] = entry;
  store.saveMeta(folder.id, meta);
}
