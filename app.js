import { call, setKey, fileUrl, fileText, uploadFile, reserveFileUrl, storageState } from './api.js?v=selectel1';
import { groupSongs, variantName, songKey, buildFileName, retitleFileName, parseFileName, AUDIO_EXT } from './parse.js';
import { NEW_DAYS, NEW_SINCE } from './config.js?v=selectel1';
import { renderLyrics, renderedLyricLines, validateTimings, parseTimecode, formatTimecode, editorToMarkup, COLORS, normalizeColor } from './lyrics.js?v=practice1';
import { Metronome, StandaloneMetronome, DRUM_PATTERNS, fitTaps } from './metronome.js?v=practice1';
import { detectTempo, TEMPO_VERSION } from './tempo.js?v=metro3';
import { loadWaveform, drawWaveform } from './waveform.js?v=garden1';
import { attachMediaControls, playbackSession, primeAudio } from './media.js?v=mobile1';
import { parseRoute, studentPath, songPath, selectStudentSpace, canEditSpace } from './navigation.js?v=spaces1';
import { readScale, applyScale } from './interface-scale.js?v=spaces1';
import { attachProgress } from './player-progress.js?v=songpages1';

const main = document.getElementById('main');
let role = null;         // 'teacher' | 'student'
let library = null;      // [{id, name, key?, songs}]
let libraryKey = null;   // для какого ключа загружена библиотека
let openEditor = null;   // песня, у которой открыт редактор (folder + key)
let teacherArchive = false;
let ownId = null;

// ---------- Маленький помощник для создания элементов ----------
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(c));
  }
  return el;
}

const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  const w = m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many;
  return `${n} ${w}`;
};

const isNew = iso => iso && iso >= NEW_SINCE && (Date.now() - new Date(iso)) < NEW_DAYS * 864e5;
const extOf = name => (name.match(/\.[^.]+$/) || ['.mp3'])[0].toLowerCase();
const canEditLyrics = student => role === 'teacher' || (role === 'student' && library?.some(space => space.id === student.id));

async function downloadVariant(student, variant, button) {
  if (button.disabled) return;
  button.disabled = true;
  try {
    const url = await fileUrl(student.id, variant.file.name);
    const response = await fetch(url);
    if (!response.ok) throw new Error('Не удалось скачать запись. Обновите страницу и попробуйте ещё раз.');
    const objectUrl = URL.createObjectURL(await response.blob());
    const link = h('a', {href: objectUrl, download: variant.file.name.replace(/[\\/:*?"<>|]/g, '_'), hidden: true});
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  } catch (error) { toast(error.message || 'Запись не скачалась.', 'error'); }
  finally { button.disabled = false; }
}

function localGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localSet(k, v) { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } }
function beatMaskControls(metro, storageKey) {
  try { metro.setBeatMask(JSON.parse(localGet(storageKey))); } catch { metro.setBeatMask([true, true, true, true]); }
  const buttons = h('div', {class: 'beat-buttons', role: 'group', 'aria-label': 'Звучащие доли'});
  const count = h('select', {class: 'beat-count', 'aria-label': 'Долей в цикле', onchange: () => {
    metro.setBeatMask(Array.from({length: Number(count.value)}, (_, index) => metro.beatMask[index] ?? true));
    localSet(storageKey, JSON.stringify(metro.beatMask)); draw();
  }}, Array.from({length: 12}, (_, index) => h('option', {value: index + 1}, String(index + 1))));
  function draw() {
    count.value = String(metro.beatMask.length);
    buttons.replaceChildren(...metro.beatMask.map((audible, index) => h('button', {
      type: 'button', class: 'beat-toggle', 'aria-label': `Доля ${index + 1}: ${audible ? 'звук включён' : 'тишина'}`,
      'aria-pressed': String(audible), onclick: () => {
        const mask = [...metro.beatMask]; mask[index] = !mask[index]; metro.setBeatMask(mask);
        localSet(storageKey, JSON.stringify(mask)); draw();
      },
    }, String(index + 1))));
  }
  draw();
  return {el: h('div', {class: 'beat-mask'}, h('label', {}, 'Доли ', count), buttons),
    pulse(slot) { buttons.querySelectorAll('button').forEach((button, index) => button.classList.toggle('beat-current', index === slot)); }};
}
// Accessing localStorage itself may be forbidden by the browser.
let scaleStorage;
try { scaleStorage = localStorage; } catch { scaleStorage = null; }
const scaleSelect = document.querySelector('.interface-scale');
if (scaleSelect) {
  const value = applyScale(document.documentElement, scaleStorage, readScale(scaleStorage));
  scaleSelect.value = String(value);
  scaleSelect.addEventListener('change', () => {
    scaleSelect.value = String(applyScale(document.documentElement, scaleStorage, scaleSelect.value));
    window.dispatchEvent(new Event('resize'));
  });
}
const lyricFonts = {modern: 'Manrope · современный', garden: 'Cormorant · изящный', book: 'Georgia · книжный', clear: 'Arial · чёткий', spacious: 'Verdana · просторный', times: 'Times · классический', mono: 'Моноширинный', rounded: 'Округлый системный'};
const selectedLyricFont = () => Object.hasOwn(lyricFonts, localGet('songs:lyrics-font')) ? localGet('songs:lyrics-font') : 'modern';
document.documentElement.dataset.lyricsFont = selectedLyricFont();
document.addEventListener('change', event => {
  if (!event.target.matches('.lyrics-font') || !Object.hasOwn(lyricFonts, event.target.value)) return;
  const font = event.target.value;
  document.documentElement.dataset.lyricsFont = font; localSet('songs:lyrics-font', font);
  document.querySelectorAll('.lyrics-font').forEach(select => {select.value = font;});
});

// ---------- Уведомления ----------
const toastBox = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
document.body.append(toastBox);
const reserveNotice = h('aside', {class: 'reserve-notice', role: 'status', hidden: true});
document.body.prepend(reserveNotice);
function toast(text, kind = '') {
  const t = h('div', { class: `toast ${kind}` }, text);
  toastBox.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 6000 : 3000);
}

// Выполнить изменение, показать ошибку, перечитать библиотеку и перерисовать.
async function mutate(fn, okText) {
  try {
    document.body.classList.add('saving');
    await fn();
    if (okText) toast(okText);
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    document.body.classList.remove('saving');
  }
  const y = scrollY;
  await route(true, true);
  scrollTo(0, y);
}

// ---------- Загрузка ----------
// Импульс, заметки, перевод и темп лежат в отдельном файле папки — приклеиваем их к песням.
function withMeta(songs, meta = {}) {
  for (const song of songs) song.meta = meta[song.key] || {};
  return songs;
}

// Запись этих данных — по одной за раз, чтобы правки не затёрли друг друга.
let metaQueue = Promise.resolve();
let libraryRequest = 0, routeRequest = 0;
function saveMeta(folder, song, extra) {
  const job = metaQueue.then(() => call('saveMeta', { folder, song, ...extra }));
  metaQueue = job.catch(() => {});
  return job;
}
async function ensureLibrary(key, force) {
  const request = ++libraryRequest;
  if (library && libraryKey === key && !force) return;
  if (libraryKey && libraryKey !== key) player.stop();
  setKey(key);
  const data = await call('library', {includeSpaces: true});
  if (request !== libraryRequest) return;
  reserveNotice.hidden = !data.reserve && !data.students.some(s => s.metadataUnavailable);
  if (data.reserve) {
    const date = data.reserve.capturedAt ? new Date(data.reserve.capturedAt).toLocaleDateString('ru-RU') : '';
    reserveNotice.textContent = `Открыта резервная копия${date ? ' от ' + date : ''}. Можно слушать песни и заниматься. Изменения временно недоступны.`;
    if (data.students.some(s => s.metadataUnavailable)) reserveNotice.textContent += ' Прежние переводы, заметки и настройки одной из страниц ещё предстоит восстановить.';
  } else if (data.students.some(s => s.metadataUnavailable)) {
    reserveNotice.textContent = 'Песни доступны. Яндекс временно не отдал переводы и заметки одной из страниц. Обновите страницу позже; прежние данные сохранены на диске.';
  }
  role = data.role;
  ownId = data.ownId || (role === 'student' ? data.students[0]?.id : null);
  libraryKey = key;
  library = data.students
    .map(d => ({ id: d.id, name: d.name, key: d.key, kind: d.kind || 'individual', members: d.members || [], archivedAt: d.archivedAt || null, songs: withMeta(groupSongs(d.files), d.meta) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  player.restrictTo(library);
}

function showState(...children) {
  main.replaceChildren(h('div', { class: 'state' }, ...children));
}

// ---------- Маршруты ----------
// #/t/<ключ>               — преподаватель, все ученики
// #/t/<ключ>/s/<папка>     — преподаватель на страничке ученика
// #/s/<ключ>               — ученик
async function route(force = false, quiet = false) {
  const request = ++routeRequest;
  const hash = location.hash.replace(/^#\/?/, '');
  const m = parseRoute(location.hash);
  if (!m) { reserveNotice.hidden = true; standalone.setVisible(false); return hash ? renderOldLink() : renderLanding(); }
  const {mode, key, folder, song} = m;
  if (libraryKey !== key) standalone.setVisible(false);
  if (!quiet || !library) showState(h('div', { class: 'spinner' }), 'Загружаю песни…');
  try {
    await ensureLibrary(key, force);
    if (request !== routeRequest) return;
  } catch (e) {
    if (request !== routeRequest) return;
    if (e.status === 403) { standalone.setVisible(false); player.stop(); }
    return showState(
      h('p', {}, e.status === 403 ? 'Эта ссылка не работает.' : 'Не получилось загрузить песни.'),
      h('p', { class: 'muted' }, e.message),
      e.status === 403 ? null : h('button', { class: 'btn', onclick: () => route(true) }, 'Попробовать снова'));
  }
  standalone.setVisible(true);
  if (role === 'student' || mode === 's') {
    const space = selectStudentSpace(library, ownId || library[0]?.id, folder);
    if (!space) {
      if (!force) return route(true, quiet);
      return showState(h('p', {}, 'Это пространство недоступно по вашей личной ссылке.'),
        h('a', {class: 'btn', href: `#/s/${key}`}, 'К моим песням'));
    }
    return song ? renderSong(space, song) : renderStudent(space);
  }
  if (folder) {
    const s = library.find(x => x.id === folder);
    if (s) return song ? renderSong(s, song) : renderStudent(s);
    if (!force) return route(true, quiet);   // может, ученика только что добавили
  }
  teacherArchive = !!m.archive;
  renderTeacher(key);
}

window.addEventListener('hashchange', () => { openEditor = null; route(); window.scrollTo(0, 0); });

function renderLanding() {
  document.title = 'Песни учеников';
  main.replaceChildren(h('div', { class: 'state landing' },
    h('div', { class: 'landing-mark', 'aria-hidden': 'true' }, '♪'),
    h('h1', {}, 'Песни учеников'),
    h('p', { class: 'muted' }, 'Откройте свою личную ссылку, которую прислал преподаватель.')));
}

function renderOldLink() {
  document.title = 'Песни учеников';
  showState(h('p', {}, 'Эта ссылка устарела.'),
    h('p', { class: 'muted' }, 'Сайт обновился — попросите у преподавателя новую личную ссылку.'));
}

// ---------- Страница преподавателя ----------
const studentLink = s => `${location.origin}${location.pathname}#/s/${s.key}`;

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const old = btn.textContent;
    btn.textContent = 'Скопировано ✓';
    setTimeout(() => { btn.textContent = old; }, 1800);
  } catch {
    prompt('Скопируйте ссылку:', text);
  }
}

function renderTeacher(key) {
  document.title = teacherArchive ? 'Архив учеников — Песни' : 'Все ученики — Песни';
  const active = library.filter(s => !s.archivedAt), archived = library.filter(s => s.archivedAt);
  const visible = teacherArchive ? archived : active;
  const results = h('div', { class: 'results' });
  const grid = h('div', { class: 'students' }, visible.length ? visible.map(s => studentCard(s, key)) :
    h('p', { class: 'muted' }, teacherArchive ? 'В архиве пока никого нет.' : 'Здесь пока нет учеников.'));

  const search = h('input', {
    type: 'search', class: 'search', placeholder: teacherArchive ? 'Найти песню в архиве…' : 'Найти песню у всех учеников…',
    oninput: () => {
      const q = songKey(search.value);
      grid.hidden = !!q;
      if (!q) return results.replaceChildren();
      const found = [];
      for (const s of visible) for (const song of s.songs)
        if (song.key.includes(q)) found.push({ s, song });
      results.replaceChildren(found.length
        ? h('div', { class: 'songs song-index' }, found.map(({ s, song }) => songListItem(song, s, true)))
        : h('p', { class: 'muted' }, 'Ничего не нашлось.'));
    },
  });

  const addStudent = () => createStudentDialog();

  const total = visible.reduce((n, s) => n + s.songs.length, 0);
  main.replaceChildren(
    h('header', { class: 'page-head' },
      h('div', {},
        h('p', { class: 'eyebrow' }, 'Страница преподавателя'),
        h('h1', {}, teacherArchive ? 'Архив учеников' : 'Мои ученики'),
        h('p', { class: 'page-phrase' }, 'Дать голосу свободу.'),
        h('p', { class: 'muted' }, `${plural(visible.length, 'страничка', 'странички', 'страничек')} · ${plural(total, 'песня', 'песни', 'песен')}`)),
      h('div', { class: 'head-actions' },
        h('button', { class: 'btn primary', onclick: addStudent }, '+ Ученик'),
        h('button', { class: 'btn ghost', onclick: () => route(true) }, 'Обновить'))),
    h('nav', { class: 'archive-tabs', 'aria-label': 'Ученики и архив' },
      h('button', { class: 'btn ghost', 'aria-pressed': String(!teacherArchive), onclick: () => { location.hash = `#/t/${key}`; } }, `Ученики (${active.length})`),
      h('button', { class: 'btn ghost', 'aria-pressed': String(teacherArchive), onclick: () => { location.hash = `#/t/${key}/archive`; } }, `Архив (${archived.length})`)),
    ...(teacherArchive ? [h('p', { class: 'archive-notice' }, 'Доступ учеников закрыт. Все песни, тексты и заметки сохранены. После восстановления прежняя ссылка снова заработает.')] : []),
    search, results, grid,
    h('p', { class: 'muted hint' }, 'Не показывайте эту страницу ученикам: её адрес открывает доступ ко всем песням.'));
}

function createStudentDialog() {
  if (document.querySelector('.create-student-dialog')) return;
  const name = h('input', {class: 'field', name: 'student-name', required: true, maxlength: 200,
    autocomplete: 'off', autofocus: true, 'aria-label': 'Имя ученика'});
  const status = h('p', {class: 'dialog-status', role: 'status', 'aria-live': 'polite'});
  const cancel = h('button', {class: 'btn ghost', type: 'button', onclick: () => dialog.close()}, 'Отмена');
  const submit = h('button', {class: 'btn primary', type: 'submit'}, 'Добавить ученика');
  let pending = false;
  const form = h('form', {onsubmit: async event => {
    event.preventDefault();
    if (pending) return;
    const value = name.value.trim();
    if (!value) { status.textContent = 'Напишите имя ученика.'; name.focus(); return; }
    pending = true; submit.disabled = true; cancel.disabled = true; name.disabled = true;
    status.textContent = 'Добавляю ученика…';
    try {
      await call('createStudent', {name: value});
      dialog.close();
      toast(`Добавлен: ${value}`);
      await route(true, true);
    } catch (error) { status.textContent = error.message || 'Не удалось добавить ученика. Попробуйте ещё раз.'; }
    finally { pending = false; submit.disabled = false; cancel.disabled = false; name.disabled = false; }
  }}, h('h2', {id: 'create-student-title'}, 'Новый ученик'),
  h('label', {class: 'dialog-field'}, 'Имя ученика', name), status,
  h('div', {class: 'student-actions'}, cancel, submit));
  const dialog = h('dialog', {class: 'archive-dialog create-student-dialog', 'aria-labelledby': 'create-student-title'}, form);
  dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
  dialog.addEventListener('close', () => dialog.remove(), {once: true});
  document.body.append(dialog); dialog.showModal();
}

function archiveStudent(student) {
  const dialog = h('dialog', { class: 'archive-dialog', 'aria-labelledby': 'archive-dialog-title' },
    h('h2', { id: 'archive-dialog-title' }, 'Отправить ученика в архив?'),
    h('p', {}, `Доступ для «${student.name}» закроется. Все песни, тексты и заметки сохранятся. Ученика можно будет вернуть с прежней ссылкой.`),
    h('div', { class: 'student-actions' },
      h('button', { class: 'btn ghost', autofocus: true, onclick: () => dialog.close() }, 'Отмена'),
      h('button', { class: 'btn primary', onclick: () => {
        dialog.close();
        mutate(async () => {
          await call('archiveStudent', { folder: student.id });
          teacherArchive = false;
          location.hash = `#/t/${libraryKey}`;
        }, 'Ученик в архиве. Материалы сохранены');
      } }, 'Отправить в архив')));
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog); dialog.showModal();
}

function restoreStudent(student) {
  return mutate(() => call('restoreStudent', { folder: student.id }), 'Ученик восстановлен. Прежняя ссылка снова работает');
}

function studentCard(s, key) {
  const copyBtn = h('button', { class: 'btn small', onclick: () => copyText(studentLink(s), copyBtn) }, 'Скопировать ссылку');
  const fresh = s.songs.filter(x => isNew(x.modified)).length;
  const href = `#/t/${key}/s/${encodeURIComponent(s.id)}`;
  return h('article', { class: 'student' },
    h('div', { class: 'student-mark', 'aria-hidden': 'true' }, s.name.split(/\s+/).filter(x => /^\p{L}/u.test(x)).slice(0, 2).map(x => x[0]).join('')),
    h('a', { class: 'student-name', href }, s.name),
    h('p', { class: 'muted' }, plural(s.songs.length, 'песня', 'песни', 'песен'),
      studentArchiveLabel(s),
      fresh && !s.archivedAt ? h('span', { class: 'badge' }, `новых: ${fresh}`) : null),
    h('div', { class: 'student-actions' },
      h('a', { class: 'btn small primary', href }, 'Открыть'), s.archivedAt ? null : copyBtn,
      h('button', { class: 'btn small', onclick: () => s.archivedAt ? restoreStudent(s) : archiveStudent(s) }, s.archivedAt ? 'Восстановить' : 'В архив')));
}

const studentArchiveLabel = s => s.archivedAt ? h('span', { class: 'badge' }, 'В архиве · доступ закрыт') : null;

const spaceKind = space => ({duet: 'Дуэт', ensemble: 'Ансамбль'}[space.kind] || 'Личные песни');

function spaceSwitcher(current) {
  if (role !== 'student') return null;
  return h('nav', {class: 'space-switcher', 'aria-label': 'Мои пространства'},
    h('p', {class: 'eyebrow'}, 'Мои пространства'),
    h('div', {class: 'space-links'}, library.map(space => h('a', {
      class: 'btn small', href: studentPath(role, libraryKey, space.id, ownId),
      'aria-current': space.id === current.id ? 'page' : null,
    }, space.id === ownId && space.kind === 'individual' ? 'Мои песни' : space.name,
    h('span', {class: 'space-kind'}, spaceKind(space))))));
}

function manageMembers(space) {
  const checks = library.filter(s => s.kind === 'individual' && s.id !== space.id).map(student => {
    const input = h('input', {type: 'checkbox', value: student.id, checked: space.members.includes(student.id)});
    return {input, label: h('label', {class: 'space-member'}, input, student.name,
      student.archivedAt ? h('span', {class: 'muted small'}, 'в архиве') : null)};
  });
  const status = h('p', {class: 'muted', role: 'status'});
  const save = h('button', {class: 'btn primary', onclick: async () => {
    save.disabled = true;
    try {
      await call('setSpaceMembers', {folder: space.id, kind: space.kind,
        members: checks.filter(x => x.input.checked).map(x => x.input.value)});
      dialog.close();
      toast('Участники сохранены. Доступ — по их личным ссылкам');
      await route(true, true);
    } catch (error) { status.textContent = error.message; }
    finally { save.disabled = false; }
  }}, 'Сохранить');
  const dialog = h('dialog', {class: 'archive-dialog members-dialog', 'aria-labelledby': 'members-title'},
    h('h2', {id: 'members-title'}, `Участники: ${space.name}`),
    h('p', {}, 'Отметьте учеников, которым доступно это общее пространство. Их личные песни остаются доступны только им. Участники могут слушать и читать общие материалы.'),
    h('div', {class: 'space-members'}, checks.length ? checks.map(x => x.label) : h('p', {class: 'muted'}, 'Сначала добавьте личные страницы учеников.')),
    status,
    h('div', {class: 'student-actions'}, h('button', {class: 'btn ghost', autofocus: true, onclick: () => dialog.close()}, 'Отмена'), save));
  dialog.addEventListener('close', () => dialog.remove(), {once: true});
  document.body.append(dialog); dialog.showModal();
}

// ---------- Страница ученика ----------
let sortMode = localGet('sort') || 'name';

function renderStudent(student) {
  document.title = `${student.name} — Песни`;
  const isTeacher = role === 'teacher';
  const editable = canEditSpace(role, ownId, student);
  const list = h('div', { class: 'songs song-index', 'aria-label': 'Список песен' });
  const addBox = h('div', { class: 'add-song', hidden: true });

  const draw = () => {
    const q = songKey(search.value);
    let songs = student.songs.filter(s => !q || s.key.includes(q));
    songs = [...songs].sort(sortMode === 'new'
      ? (a, b) => b.modified.localeCompare(a.modified)
      : (a, b) => a.title.localeCompare(b.title, 'ru'));
    list.replaceChildren(...(songs.length
      ? songs.map(s => songListItem(s, student))
      : [h('p', { class: 'muted' }, q ? 'Ничего не нашлось.' : 'Здесь пока нет песен.')]));
  };

  const search = h('input', { type: 'search', class: 'search', placeholder: 'Поиск по песням…', oninput: draw });
  const sort = h('select', {
    class: 'sort', 'aria-label': 'Сортировка',
    onchange: () => { sortMode = sort.value; localSet('sort', sortMode); draw(); },
  },
    h('option', { value: 'name', selected: sortMode === 'name' }, 'По алфавиту'),
    h('option', { value: 'new', selected: sortMode === 'new' }, 'Сначала новые'));

  const addBtn = h('button', {
    class: 'btn primary', onclick: () => {
      addBox.hidden = !addBox.hidden;
      if (!addBox.hidden) { addBox.replaceChildren(addSongForm(student, () => { addBox.hidden = true; })); addBox.querySelector('input')?.focus(); }
    },
  }, '+ Песня');

  const teacherTools = isTeacher && h('div', { class: 'teacher-tools' },
    h('a', { class: 'btn ghost small', href: `#/t/${libraryKey}${student.archivedAt ? '/archive' : ''}` }, student.archivedAt ? '← Архив учеников' : '← Все ученики'),
    student.archivedAt && h('button', { class: 'btn small primary', onclick: () => restoreStudent(student) }, 'Восстановить ученика'),
    student.kind !== 'individual' && h('button', {class: 'btn small', onclick: () => manageMembers(student)}, 'Участники'),
    (() => {
      const b = h('button', { class: 'btn small', onclick: () => copyText(studentLink(student), b) }, /ансамбль/i.test(student.name) ? 'Скопировать ссылку ансамбля' : 'Скопировать ссылку ученика');
      return b;
    })(),
    h('details', { class: 'more' },
      h('summary', { class: 'btn ghost small' }, 'Ещё…'),
      h('div', { class: 'more-menu' },
        h('button', {
          class: 'btn small', onclick: () => {
            const name = prompt('Новое имя:', student.name);
            if (name?.trim() && name.trim() !== student.name)
              mutate(() => call('renameStudent', { folder: student.id, newName: name }), 'Переименовано');
          },
        }, 'Переименовать'),
        h('button', {
          class: 'btn small', onclick: () => {
            if (confirm(`Сделать новую ссылку для «${student.name}»? Старая ссылка перестанет работать.`))
              mutate(() => call('resetLink', { folder: student.id }), 'Новая ссылка готова — скопируйте её');
          },
        }, 'Новая ссылка (старая перестанет работать)'),
        !student.archivedAt && h('button', { class: 'btn small', onclick: () => archiveStudent(student) }, 'Отправить в архив'))));

  main.replaceChildren(...[
    spaceSwitcher(student),
    teacherTools,
    isTeacher && student.archivedAt && h('p', { class: 'archive-notice' }, 'Ученик в архиве. Его доступ закрыт, все материалы сохранены.'),
    student.kind !== 'individual' && h('p', {class: 'muted ensemble-hint'}, isTeacher
      ? 'Общие песни доступны участникам через их личные ссылки. Состав можно изменить в «Участники».'
      : 'Общие материалы для занятий. Изменения вносит преподаватель.'),
    h('header', { class: 'page-head' },
      h('div', {},
        h('p', { class: 'eyebrow' }, isTeacher ? 'Репертуар ученика' : 'Моя музыка'),
        h('h1', {}, student.name),
        h('p', { class: 'page-phrase' }, 'Можно звучать по-своему.'),
        h('p', { class: 'muted' }, plural(student.songs.length, 'песня', 'песни', 'песен'))),
      editable && h('div', { class: 'head-actions' }, addBtn)),
    addBox,
    h('div', { class: 'toolbar' }, search, sort),
    list,
  ].filter(Boolean));
  draw();
}

// ---------- Карточка песни ----------
function songListItem(song, student, owner = false) {
  const href = songPath(role, libraryKey, student.id, song.key, ownId);
  return h('a', {class: 'song song-index-item', href, 'aria-label': `Открыть песню: ${song.title}`, 'data-song-id': `${student.id}|${song.key}`},
    h('div', {class: 'song-index-content'},
      h('span', {class: 'song-index-title'}, song.title),
      h('p', {class: 'muted'}, owner ? `${student.name} · ` : '',
        `${plural(song.variants.length, 'аудиозапись', 'аудиозаписи', 'аудиозаписей')}${song.lyrics ? ' · текст' : ''}`)),
    isNew(song.modified) ? h('span', {class: 'badge'}, 'новое') : null,
    h('span', {class: 'btn small song-index-open', 'aria-hidden': 'true'}, 'Открыть ›'));
}

function renderSong(student, key) {
  const song = student.songs.find(s => s.key === key);
  const back = h('a', {class: 'btn ghost small', href: studentPath(role, libraryKey, student.id, ownId)}, '← Список песен');
  if (!song) return showState(h('p', {}, 'Песня переименована или больше недоступна.'), back);
  document.title = `${song.title} — ${student.name}`;
  main.replaceChildren(...[spaceSwitcher(student), h('nav', {class: 'teacher-tools', 'aria-label': 'Навигация песни'}, back),
    h('p', {class: 'eyebrow'}, student.name), songCard(song, student, {heading: 'h1'})].filter(Boolean));
}

function songReading(song, student) {
  const panel = h('section', { class: 'reading', hidden: true, 'aria-label': `Слова песни ${song.title}` });
  panel.append(h('label', {class: 'reading-appearance'}, 'Шрифт текста',
    h('select', {class: 'lyrics-font', 'aria-label': `Шрифт текста: ${song.title}`, value: selectedLyricFont()},
      Object.entries(lyricFonts).map(([value, name]) => h('option', {value, selected: value === selectedLyricFont()}, name)))));
  const controls = h('div', { class: 'reading-modes', role: 'group', 'aria-label': `Текст и перевод: ${song.title}` });
  let mode = 'closed';
  const panes = {};
  const addPane = (id, label, load) => {
    const body = h('div', { class: 'lyrics-text' });
    const box = h('div', { class: 'lyrics', hidden: true }, h('h3', { class: 'pane-title' }, label), body);
    let job = null;
    panes[id] = { box, async load() {
      if (!job) {
        body.textContent = 'Загружаю текст…';
        job = Promise.resolve().then(load).then(text => {
          text = text.replace(/^\uFEFF/, '');
          if (id !== 'original') { body.innerHTML = renderLyrics(text); return; }
          const timings = validateTimings(song.meta.timings, song, text);
          if (!timings.valid) {
            body.innerHTML = renderLyrics(text);
            if (timings.reason) box.append(h('p', {class: 'timing-warning muted small'}, timings.reason));
            return;
          }
          const bindings = new Map(timings.lines.map(line => [line.line, line.seconds]));
          body.replaceChildren(...renderedLyricLines(text).map((html, line) => {
            const seconds = bindings.get(line);
            const el = seconds == null ? h('span', {class: 'lyric-line'}) : h('button', {
              type: 'button', class: 'lyric-line lyric-timed', 'data-time':formatTimecode(seconds), title: `Перейти к ${formatTimecode(seconds)}`,
              onclick: () => player.seekVariant(song, timings.track, student, seconds),
            });
            el.innerHTML = html || '<br>'; return el;
          }));
        })
          .catch(e => { job = null; body.replaceChildren(h('p', {}, 'Не удалось загрузить текст.'), h('button', { class: 'btn small', onclick: () => panes[id].load() }, 'Повторить')); });
      }
      await job;
    } };
    panel.append(box);
  };
  if (song.lyrics) addPane('original', song.meta.translation ? 'Оригинал' : 'Текст песни', () => fileText(student.id, song.lyrics.name));
  if (song.meta.translation) addPane('translation', 'Перевод', () => song.meta.translation);
  const set = next => {
    mode = next; panel.hidden = next === 'closed'; panel.classList.toggle('two', next === 'both');
    for (const [id, pane] of Object.entries(panes)) {
      const visible = next === id || next === 'both'; pane.box.hidden = !visible;
      if (visible) pane.load();
    }
    controls.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === next)));
  };
  const button = (id, label) => h('button', { class: 'reading-mode', 'data-mode': id, 'aria-pressed': 'false', onclick: () => set(mode === id ? 'closed' : id) }, label);
  if (panes.original) controls.append(button('original', panes.translation ? 'Оригинал' : 'Текст песни'));
  if (panes.translation) controls.append(button('translation', 'Перевод'));
  if (panes.original && panes.translation) controls.append(button('both', 'Рядом'));
  if (song.lyrics && canEditLyrics(student) && song.variants.some(v => v.kind === 'minus')) {
    controls.append(h('button', {class: 'reading-mode', onclick: () => timingDialog(song, student)}, 'Таймкоды'));
  }
  panel.append(h('button', { class: 'link-btn collapse', onclick: () => set('closed') }, 'Свернуть текст'));
  return { panel, controls, close: () => set('closed') };
}

async function timingDialog(song, student) {
  if (document.querySelector('.timing-dialog')) return;
  let text;
  try { text = (await fileText(student.id, song.lyrics.name)).replace(/^\uFEFF/, ''); }
  catch (error) { return toast(error.message, 'error'); }
  const tracks = song.variants.filter(v => v.kind === 'minus');
  const old = validateTimings(song.meta.timings, song, text);
  const trackSelect = h('select', {class: 'field', 'aria-label': 'Минус для таймкодов'}, tracks.map(v => h('option', {value: v.file.name}, variantName(v))));
  trackSelect.value = old.track?.file.name || tracks[0].file.name;
  const fields = text.split(/\r?\n/).map((line, index) => {
    if (!line.trim()) return null;
    const saved = old.lines.find(item => item.line === index);
    const input = h('input', {class: 'field timing-input', value: saved ? formatTimecode(saved.seconds) : '',
      placeholder: '0:00', 'aria-label': `Время строки ${index + 1}`, inputmode: 'text'});
    const preview = h('span', {class: 'timing-preview'}); preview.innerHTML = renderLyrics(line);
    return {line: index, text: line, input, row: h('div', {class: 'timing-row'}, preview, input,
      h('button', {class: 'btn small', onclick: () => {
        const seconds = player.positionFor(student, song, trackSelect.value);
        if (seconds == null) return toast('Сначала включите выбранный минус');
        input.value = formatTimecode(seconds);
      }}, 'Сейчас'))};
  }).filter(Boolean);
  trackSelect.addEventListener('change', () => { fields.forEach(field => {field.input.value = '';}); });
  const status = h('p', {class: 'muted small', role: 'status'});
  let pending = false;
  const save = h('button', {class: 'btn primary', onclick: async () => {
    if (pending) return;
    const lines = [];
    for (const field of fields) {
      if (!field.input.value.trim()) continue;
      const seconds = parseTimecode(field.input.value);
      if (seconds == null) { status.textContent = 'Укажите время как 1:23 или 1:23.450.'; field.input.focus(); return; }
      lines.push({line: field.line, text: field.text, seconds});
    }
    const track = tracks.find(v => v.file.name === trackSelect.value);
    pending = true; save.disabled = true; status.textContent = 'Сохраняю…';
    try {
      await call('saveTimings', {folder: student.id, song: song.key, timings: lines.length ? {
        version: 1, track: track.file.name, trackSize: track.file.size, trackModified: track.file.modified,
        lyrics: song.lyrics.name, lyricsModified: song.lyrics.modified, lines,
      } : null});
      dialog.close(); await route(true, true); toast('Таймкоды сохранены');
    } catch (error) { status.textContent = error.status === 409 ? 'Материалы изменились. Обновите страницу и настройте таймкоды заново.' : error.message; }
    finally { pending = false; save.disabled = false; }
  }}, 'Сохранить таймкоды');
  const dialog = h('dialog', {class: 'archive-dialog timing-dialog'}, h('h2', {}, 'Таймкоды строк'),
    h('p', {class: 'muted small'}, 'Выберите минус. Укажите время нужных строк или нажмите «Сейчас» во время прослушивания. Пустые поля останутся без привязки.'),
    trackSelect, h('button', {class: 'btn small', onclick: () => player.play(song, tracks.find(v => v.file.name === trackSelect.value), student)}, 'Слушать минус'),
    old.reason && h('p', {class: 'timing-warning'}, old.reason), h('div', {class: 'timing-fields'}, fields.map(field => field.row)), status,
    h('div', {class: 'student-actions'}, h('button', {class: 'btn ghost', onclick: () => {if (!pending) dialog.close();}}, 'Закрыть'), save));
  dialog.addEventListener('cancel', event => {if (pending) event.preventDefault();});
  dialog.addEventListener('close', () => dialog.remove(), {once:true});
  document.body.append(dialog); dialog.showModal();
}

function variantHelp(v) {
  const slow = /медлен/i.test(v.label);
  return v.kind === 'minus' ? (slow ? 'Поёшь и разбираешь детали' : 'Поёшь самостоятельно')
    : v.kind === 'plus' ? (slow ? 'С вокалом · разбираешь детали' : 'С вокалом') : 'Слушаешь оригинал';
}

// «Импульс»: ученик вписывает 1–2 слова; преподаватель видит их у песни.
function impulseBlock(song, student) {
  const value = song.meta.impulse || '';
  if (role !== 'student' || !canEditSpace(role, ownId, student)) {
    return h('div', { class: 'impulse' + (value ? '' : ' empty') },
      h('span', { class: 'impulse-label' }, 'Импульс'),
      h('span', { class: 'impulse-word' }, value || 'ученик ещё не вписал'));
  }
  const input = h('input', { class: 'field impulse-input', value, maxlength: 40, placeholder: '1–2 слова', 'aria-label': 'Импульс' });
  const save = async () => {
    const v = input.value.replace(/\s+/g, ' ').trim();
    if (v.split(' ').filter(Boolean).length > 2) return toast('Импульс — не больше двух слов', 'error');
    if (!v) return toast('Впишите одно-два слова', 'error');
    await mutate(() => saveMeta(student.id, song.key, { patch: { impulse: v } }), 'Импульс сохранён');
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
  if (value) {
    // Уже вписан: показываем слово, по нажатию можно поменять.
    const box = h('div', { class: 'impulse' },
      h('span', { class: 'impulse-label' }, 'Импульс'),
      h('button', { class: 'impulse-word as-btn', title: 'Изменить импульс', onclick: () => box.replaceWith(editBox) }, value));
    const editBox = h('div', { class: 'impulse editing' },
      h('span', { class: 'impulse-label' }, 'Импульс'), input,
      h('button', { class: 'btn small primary', onclick: save }, 'Сохранить'));
    return box;
  }
  return h('div', { class: 'impulse required' },
    h('span', { class: 'impulse-label' }, 'Импульс'), input,
    h('button', { class: 'btn small primary', onclick: save }, 'Сохранить'),
    h('p', { class: 'small impulse-hint' }, 'Обязательно: одно-два слова — с каким ощущением ты поёшь эту песню.'));
}

function songCard(song, student, { owner = false, heading = 'h2' } = {}) {
  const editorKey = `${student.id}|${song.key}`;

  const reader = songReading(song, student);
  const reading = reader.panel;

  // Редактор: пока он открыт, окна для чтения и ссылки скрыты.
  const editBox = h('div', { class: 'editor', hidden: true });
  const links = h('div', { class: 'song-links' }, reader.controls,
    canEditLyrics(student) && h('button', { class: 'link-btn', onclick: () => setEditing(true) }, canEditSpace(role, ownId, student) ? 'Изменить' : 'Изменить текст'));
  function setEditing(on) {
    if (on && !canEditLyrics(student)) return;
    openEditor = on ? editorKey : null;
    editBox.hidden = !on;
    links.hidden = on;
    if (on) {
      reader.close();
      editBox.replaceChildren(canEditSpace(role, ownId, student)
        ? songEditor(song, student, { onClose: () => setEditing(false) })
        : sharedLyricsEditor(song, student, () => setEditing(false)));
    } else {
      editBox.replaceChildren();
    }
  }

  const card = h('article', { class: 'song' + (role === 'student' && canEditSpace(role, ownId, student) && !song.meta.impulse ? ' needs-impulse' : ''), 'data-song-id': `${student.id}|${song.key}` },
    h('div', { class: 'song-head' },
      h(heading, {}, song.title),
      isNew(song.modified) ? h('span', { class: 'badge' }, 'новое') : null,
      owner ? h('span', { class: 'owner' }, student.name) : null),
    impulseBlock(song, student),
    song.variants.length
      ? h('div', { class: 'variants' }, song.variants.map(v => {
        const download = h('button', {class: 'variant-download btn small', title: `Скачать ${variantName(v)}`, 'aria-label': `Скачать ${variantName(v)}`,
          onclick: () => downloadVariant(student, v, download)}, '↓ Скачать');
        return h('div', {class: 'variant-slot'}, h('button', {
          class: `chip ${v.kind}`, 'data-id': `${student.id}|${v.file.name}`,
          onclick: () => player.play(song, v, student),
        }, h('span', { class: 'variant-label' }, variantName(v)), h('span', { class: 'variant-help' }, variantHelp(v))), download);
      }))
      : h('p', { class: 'muted' }, canEditSpace(role, ownId, student) ? 'Нет аудио — добавьте вариант в «Изменить».' : 'Преподаватель ещё не добавил аудиозапись.'),
    h('div', { class: 'song-wave', hidden: true }, h('canvas', { class: 'waveform-canvas', role: 'img', 'aria-label': `Волновая форма: ${song.title}` })),
    song.meta.notes ? h('div', { class: 'notes' }, h('div', { class: 'pane-title' }, 'Заметки'), song.meta.notes) : null,
    links, reading, editBox);
  if (openEditor === editorKey) setEditing(true);
  return card;
}

function sharedLyricsEditor(song, student, onClose) {
  const editor = lyricsEditorBox();
  let original = '', ready = !song.lyrics, pending = false;
  const status = h('p', {role: 'status', class: 'muted small'});
  if (song.lyrics) {
    editor.setLoading(true);
    fileText(student.id, song.lyrics.name).then(value => {
      editor.setValue(value); original = editor.getValue(); ready = true;
    }).catch(error => { status.textContent = error.message; }).finally(() => editor.setLoading(false));
  }
  const dirty = () => ready && editor.getValue() !== original;
  dirtyEditors.add(dirty);
  const close = () => { dirtyEditors.delete(dirty); onClose(); };
  const save = h('button', {class: 'btn primary', onclick: async () => {
    if (!ready || pending) return;
    pending = true; save.disabled = true; status.textContent = 'Сохраняю текст…';
    try {
      await call('saveLyrics', {folder: student.id, name: song.lyrics?.name || `${song.title}.txt`,
        text: editor.getValue(), ...(song.lyrics ? {expectedModified: song.lyrics.modified} : {})});
      close(); await route(true, true); toast('Текст сохранён');
    } catch (error) { status.textContent = error.status === 409 ? 'Текст уже изменён на другом устройстве. Скопируйте свои правки и обновите страницу.' : error.message; }
    finally { pending = false; save.disabled = false; }
  }}, 'Сохранить текст');
  return h('div', {class: 'editor-inner'}, h('h3', {}, 'Текст общей песни'), editor.el, status,
    h('div', {class: 'editor-footer'}, h('button', {class: 'btn ghost', onclick: () => {
      if (pending) return;
      if (dirty() && !confirm('Закрыть без сохранения?')) return;
      close();
    }}, 'Отмена'), save));
}

// Все файлы песни (аудио + текст) — для копирования и удаления.
const songFiles = song => [...song.variants.map(v => v.file.name), ...(song.lyrics ? [song.lyrics.name] : [])];

// Открытые редакторы с несохранёнными правками — предупреждаем перед уходом со страницы.
const dirtyEditors = new Set();
window.addEventListener('beforeunload', e => {
  if ([...dirtyEditors].some(f => f())) { e.preventDefault(); e.returnValue = ''; }
});

const brandHome = document.querySelector('.studio-brand');
brandHome?.addEventListener('click', event => {
  event.preventDefault();
  const goHome = () => {
    dirtyEditors.clear(); openEditor = null;
    const destination = libraryKey ? `#/${role === 'teacher' ? 't' : 's'}/${libraryKey}` : '#';
    // Only navigation changes; the shared audio element keeps playing.
    if (location.hash === destination) { route(false, true); window.scrollTo(0, 0); }
    else location.hash = destination;
  };
  if (![...dirtyEditors].some(isDirty => isDirty())) return goHome();
  if (document.querySelector('.leave-editor-dialog')) return;
  const dialog = h('dialog', {class: 'archive-dialog leave-editor-dialog', 'aria-labelledby': 'leave-editor-title'},
    h('h2', {id: 'leave-editor-title'}, 'Выйти без сохранения?'),
    h('p', {}, 'В редакторе есть несохранённые изменения. Сначала сохраните их или подтвердите выход на главную.'),
    h('div', {class: 'student-actions'},
      h('button', {class: 'btn ghost', autofocus: true, onclick: () => dialog.close()}, 'Продолжить редактирование'),
      h('button', {class: 'btn primary', onclick: () => { dialog.close(); goHome(); }}, 'Выйти без сохранения')));
  dialog.addEventListener('close', () => dialog.remove(), {once: true});
  document.body.append(dialog); dialog.showModal();
});

const kindSelect = value => h('select', { class: 'field kind', 'aria-label': 'Тип' },
  h('option', { value: 'minus', selected: value === 'minus' }, 'Минус'),
  h('option', { value: 'plus', selected: value === 'plus' }, 'Плюс'),
  h('option', { value: 'orig', selected: value === 'orig' }, 'Оригинал'));

// Редактор текста с оформлением: жирный, курсив, подчёркнутый, маркер, цвета.
function lyricsEditorBox(placeholder = 'Вставьте сюда текст песни…') {
  const area = h('div', {
    class: 'field lyrics-edit', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true',
    'aria-label': placeholder, 'data-placeholder': placeholder,
  });
  // Вставляем только чистый текст — чтобы не тащить шрифты и размеры из Word и сайтов.
  area.addEventListener('paste', e => {
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
  });

  // На телефоне нажатие на кнопку может сбросить выделение — запоминаем его заранее.
  let savedRange = null;
  document.addEventListener('selectionchange', () => {
    const sel = getSelection();
    if (sel.rangeCount && area.contains(sel.getRangeAt(0).commonAncestorContainer)) savedRange = sel.getRangeAt(0).cloneRange();
  });
  const cmd = (name, value) => {
    area.focus();
    if (savedRange && area.contains(savedRange.commonAncestorContainer)) {
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
    }
    document.execCommand('styleWithCSS', false, name === 'hiliteColor');
    document.execCommand(name, false, value);
  };
  // mousedown + preventDefault — чтобы кнопка не снимала выделение с текста.
  const tool = (label, title, action, cls = '') => h('button', {
    type: 'button', class: `tool ${cls}`, title, 'aria-label': title,
    onpointerdown: e => e.preventDefault(),
    onmousedown: e => e.preventDefault(),
    onclick: e => { e.preventDefault(); action(); },
  }, label);

  const colorTools = (title, command, palette, initial) => {
    const picker = h('input', {type: 'color', value: initial, class: 'format-color-picker', 'aria-label': `${title}: выбрать цвет`,
      onchange: () => { value.value = picker.value; cmd(command, picker.value); }});
    const value = h('input', {type: 'text', class: 'format-color-value', value: initial,
      placeholder: '#1a2b3c или rgb(26,43,60)', 'aria-label': `${title}: HEX или RGB`, spellcheck: 'false'});
    const apply = () => {
      const hex = normalizeColor(value.value);
      if (!hex) { toast('Цвет: #1a2b3c или rgb(26, 43, 60). Числа RGB — от 0 до 255.', 'error'); return; }
      picker.value = hex; value.value = hex; cmd(command, hex);
    };
    value.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); apply(); } });
    const popup = h('details', {class: 'format-color-popup'},
      h('summary', {class: 'tool', title, 'aria-label': title, onpointerdown: () => {
        const selection = getSelection();
        if (selection.rangeCount && area.contains(selection.getRangeAt(0).commonAncestorContainer)) savedRange = selection.getRangeAt(0).cloneRange();
      }}, h('span', {class: 'palette-icon', 'aria-hidden': 'true'}, command === 'foreColor' ? '✎' : '▰'), title),
      h('fieldset', {class: 'format-color-group'}, h('legend', {}, title),
      h('div', {class: 'format-color-presets'}, palette.map(color => tool(
        h('span', {class: 'format-swatch', style: `background-color:${color.hex}`}), `${title}: ${color.name}`,
        () => { picker.value = color.hex; value.value = color.hex; cmd(command, color.hex); }))),
      h('div', {class: 'format-color-custom'}, picker, value, tool('Применить', `Применить ${title.toLowerCase()}`, apply)),
      command === 'hiliteColor' ? tool('Без маркера', 'Убрать только цвет маркера', () => cmd(command, 'transparent'))
        : tool('Обычный цвет', 'Вернуть обычный цвет букв', () => cmd(command, getComputedStyle(area).color))));
    popup.addEventListener('toggle', () => {
      if (popup.open) popup.parentElement?.querySelectorAll('.format-color-popup').forEach(other => { if (other !== popup) other.open = false; });
    });
    return popup;
  };
  const toolbar = h('div', { class: 'toolbar-fmt' },
    h('div', {class: 'format-main'},
      tool(h('b', {}, 'Жирный'), 'Жирный (Ctrl+B)', () => cmd('bold')),
      tool(h('i', {}, 'Курсив'), 'Курсив (Ctrl+I)', () => cmd('italic')),
      tool(h('u', {}, 'Подчеркнуть'), 'Подчёркнутый (Ctrl+U)', () => cmd('underline')),
      tool('Убрать оформление', 'Убрать оформление', () => { cmd('removeFormat'); cmd('hiliteColor', 'transparent'); })),
    colorTools('Цвет букв', 'foreColor', [...Object.values(COLORS),
      {name: 'Оранжевый', hex: '#d84315'}, {name: 'Бирюзовый', hex: '#00796b'},
      {name: 'Розовый', hex: '#ad1457'}, {name: 'Индиго', hex: '#3949ab'},
      {name: 'Коричневый', hex: '#795548'}, {name: 'Серый', hex: '#616161'},
    ], '#7b1fa2'),
    colorTools('Цвет маркера', 'hiliteColor', [
      {name: 'Жёлтый', hex: '#fff176'}, {name: 'Зелёный', hex: '#a5d6a7'},
      {name: 'Голубой', hex: '#90caf9'}, {name: 'Розовый', hex: '#f8bbd0'},
      {name: 'Сиреневый', hex: '#ce93d8'}, {name: 'Персиковый', hex: '#ffcc80'},
      {name: 'Мятный', hex: '#80cbc4'}, {name: 'Лимонный', hex: '#e6ee9c'},
    ], '#fff176'));

  const el = h('div', { class: 'lyrics-editor' }, toolbar, area);
  return {
    el,
    setValue: markup => { area.innerHTML = renderLyrics(markup, { forEditor: true }); },
    getValue: () => editorToMarkup(area),
    setLoading: on => {
      area.contentEditable = on ? 'false' : 'true';
      area.classList.toggle('loading', on);
      if (on) area.textContent = 'Загружаю…';
    },
  };
}

// Редактор песни. Все правки — черновик, пока не нажата «Сохранить всё».
function songEditor(song, student, { onClose, isNew = false }) {
  const isTeacher = role === 'teacher';
  const folder = student.id;

  // Название
  const titleInput = h('input', { class: 'field', value: song.title, placeholder: 'Название песни', 'aria-label': 'Название песни' });

  // Текст
  const lyricsEditor = lyricsEditorBox();
  let lyricsOriginal = '';
  let lyricsReady = !song.lyrics;
  if (song.lyrics) {
    lyricsEditor.setLoading(true);
    fileText(folder, song.lyrics.name)
      .then(t => { lyricsEditor.setValue(t); lyricsOriginal = lyricsEditor.getValue(); lyricsReady = true; })
      .catch(e => toast(e.message, 'error'))
      .finally(() => lyricsEditor.setLoading(false));
  }
  const lyricsChanged = () => lyricsReady && lyricsEditor.getValue() !== lyricsOriginal;

  // Перевод (с таким же оформлением, как текст) и заметки.
  const meta = song.meta || {};
  const translationEditor = lyricsEditorBox('Вставьте сюда перевод…');
  translationEditor.setValue(meta.translation || '');
  const translationOriginal = translationEditor.getValue();
  const notesInput = h('textarea', { class: 'field notes-edit', rows: 3, maxlength: 5000, placeholder: 'Подсказки, над чем работать, дыхание, акценты…' });
  notesInput.value = meta.notes || '';
  const metaPatch = () => {
    const p = {};
    if (translationEditor.getValue() !== translationOriginal) p.translation = translationEditor.getValue();
    if (notesInput.value.trim() !== (meta.notes || '')) p.notes = notesInput.value.trim();
    return p;
  };

  // Уже загруженные варианты: тип, пометка, «удалить».
  const rows = song.variants.map(v => {
    const kind = kindSelect(v.kind);
    const label = h('input', { class: 'field', value: v.label, placeholder: 'Пометка', 'aria-label': 'Пометка' });
    const row = { v, kind, label, removed: false };
    const delBtn = h('button', {
      class: 'btn small ghost danger', type: 'button', onclick: () => {
        row.removed = !row.removed;
        li.classList.toggle('removed', row.removed);
        delBtn.textContent = row.removed ? 'Вернуть' : 'Удалить';
        kind.disabled = label.disabled = row.removed;
      },
    }, 'Удалить');
    const li = h('li', { class: 'variant-row' },
      h('span', { class: `dot ${v.kind}` }), kind, label,
      h('span', { class: 'muted small file-name', title: v.file.name }, v.file.name), delBtn);
    row.li = li;
    return row;
  });
  const rowChanged = r => r.removed || r.kind.value !== r.v.kind || r.label.value.trim() !== r.v.label;

  // Новые файлы: добавляются в список и загружаются при сохранении.
  const pending = [];
  const pendingList = h('ul', { class: 'variant-list' });
  const picker = h('input', {
    type: 'file', multiple: true, accept: 'audio/*,.mp3,.wav,.m4a,.ogg,.flac', hidden: true,
    onchange: () => {
      for (const f of picker.files) {
        if (!AUDIO_EXT.test(f.name)) { toast(`«${f.name}» — не аудиофайл`, 'error'); continue; }
        // Если файл уже назван «Песня + (пометка).mp3», подставим тип и пометку сами.
        const p = parseFileName(f.name);
        const guessed = p.kind !== 'orig';
        const item = { file: f, kind: kindSelect(guessed ? p.kind : 'minus'), label: h('input', { class: 'field', value: guessed ? p.label : '', placeholder: 'Пометка: медленный, ниже…', 'aria-label': 'Пометка' }) };
        item.bar = h('div', { class: 'progress-bar' });
        item.li = h('li', { class: 'variant-row new' },
          h('span', { class: 'dot new' }), item.kind, item.label,
          h('span', { class: 'muted small file-name', title: f.name }, f.name),
          h('button', {
            class: 'btn small ghost', type: 'button', 'aria-label': 'Убрать', onclick: () => {
              pending.splice(pending.indexOf(item), 1);
              item.li.remove();
            },
          }, '✕'),
          h('div', { class: 'progress row-progress' }, item.bar));
        pending.push(item);
        pendingList.append(item.li);
      }
      picker.value = '';
    },
  });

  const isDirty = () => titleInput.value.trim() !== song.title || lyricsChanged() || rows.some(rowChanged) || pending.length > 0 || Object.keys(metaPatch()).length > 0;
  dirtyEditors.add(isDirty);
  const close = () => { dirtyEditors.delete(isDirty); onClose(); };

  const status = h('span', { class: 'muted small save-status' });
  const saveBtn = h('button', { class: 'btn primary', type: 'button', onclick: saveAll }, 'Сохранить всё');
  const cancelBtn = h('button', {
    class: 'btn ghost', type: 'button', onclick: () => {
      if (isDirty() && !confirm('Закрыть без сохранения? Правки пропадут.')) return;
      close();
    },
  }, 'Отмена');

  async function saveAll() {
    const newTitle = titleInput.value.trim();
    if (!newTitle) { toast('Напишите название песни', 'error'); return titleInput.focus(); }
    if (!lyricsReady && song.lyrics) return toast('Подождите, текст ещё загружается', 'error');
    if (isNew && !pending.length && !lyricsEditor.getValue().trim()) return toast('Добавьте аудиофайл или текст песни', 'error');
    const newKey = songKey(newTitle);
    if (newKey !== song.key && student.songs.some(s => s.key === newKey))
      return toast('Песня с таким названием уже есть', 'error');
    if (!isDirty()) return close();

    const titleChanged = newTitle !== song.title;
    saveBtn.disabled = cancelBtn.disabled = true;
    const step = text => { status.textContent = text; };
    let failed = false;
    const renamedFiles = {};
    try {
      // 1. Удалить отмеченные варианты.
      for (const r of rows.filter(r => r.removed)) {
        step(`Удаляю «${variantName(r.v)}»…`);
        await call('delete', { folder, name: r.v.file.name });
      }
      // 2. Переименовать оставшиеся (новое название, тип или пометка).
      for (const r of rows.filter(r => !r.removed)) {
        const kindOrLabel = r.kind.value !== r.v.kind || r.label.value.trim() !== r.v.label;
        const newName = kindOrLabel
          ? buildFileName(newTitle, r.kind.value, r.label.value, extOf(r.v.file.name))
          : titleChanged ? retitleFileName(r.v.file.name, newTitle) : r.v.file.name;
        if (newName !== r.v.file.name) {
          step(`Переименовываю «${variantName(r.v)}»…`);
          await call('rename', { folder, name: r.v.file.name, newName });
          renamedFiles[r.v.file.name] = newName;
        }
      }
      // 3. Текст песни.
      const lyricsName = `${newTitle}.txt`;
      const text = lyricsEditor.getValue();
      const oldName = song.lyrics?.name;
      if (lyricsChanged() || (oldName && oldName !== lyricsName)) {
        step('Сохраняю текст…');
        if (!text.trim() && oldName) {
          await call('delete', { folder, name: oldName });
        } else if (text.trim()) {
          await call('saveText', { folder, name: lyricsName, text });
          if (oldName && oldName !== lyricsName) await call('delete', { folder, name: oldName });
        }
      }
      // 4. Перевод, заметки; при смене названия — перенести импульс и темп.
      const patch = metaPatch();
      const removedTempo = Object.fromEntries(rows.filter(r => r.removed).map(r => [r.v.file.name, null]));
      if (Object.keys(patch).length || newKey !== song.key || Object.keys(renamedFiles).length || Object.keys(removedTempo).length) {
        step('Сохраняю перевод и заметки…');
        await saveMeta(folder, song.key || newKey, {
          patch: { ...patch, tempo: removedTempo },
          renameTo: newKey, renameFiles: renamedFiles,
        });
      }
      // 5. Загрузить новые файлы.
      for (const [i, p] of pending.entries()) {
        const name = buildFileName(newTitle, p.kind.value, p.label.value, extOf(p.file.name));
        step(`Загружаю файл ${i + 1} из ${pending.length}…`);
        try {
          await uploadFile(folder, name, p.file, x => { p.bar.style.width = `${Math.round(x * 100)}%`; });
        } catch (e) {
          throw new Error(e.status === 409 ? `Вариант «${name}» уже есть — поставьте другую пометку` : e.message);
        }
      }
    } catch (e) {
      failed = true;
      toast(`Не всё сохранилось: ${e.message}`, 'error');
    }
    dirtyEditors.delete(isDirty);
    // При ошибке оставляем редактор открытым (уже с тем, что успело сохраниться).
    openEditor = failed ? `${folder}|${songKey(newTitle)}` : null;
    if (isNew && !failed) onClose();
    if (!failed && parseRoute(location.hash)?.song && songKey(newTitle) !== song.key) {
      history.replaceState(null, '', songPath(role, libraryKey, folder, songKey(newTitle), ownId));
    }
    await mutate(async () => {}, failed ? null : 'Сохранено');
  }

  // Копирование другому ученику и удаление песни — отдельные действия, срабатывают сразу.
  const extra = [];
  if (!isNew && isTeacher) {
    const others = library.filter(s => s.id !== folder);
    const sel = h('select', { class: 'field' }, others.map(s => h('option', { value: s.id }, s.name)));
    extra.push(h('div', { class: 'row' }, h('span', { class: 'small' }, 'Дать эту песню ученику:'), sel,
      h('button', {
        class: 'btn small', type: 'button', onclick: () => {
          const to = others.find(s => s.id === sel.value);
          mutate(() => call('copyTo', { folder, to: sel.value, names: songFiles(song), song: song.key }), `Скопировано: ${to.name}`);
        },
      }, 'Скопировать')));
  }
  if (!isNew) {
    extra.push(h('div', { class: 'row' }, h('button', {
      class: 'btn small danger', type: 'button', onclick: () => {
        if (!confirm(`Удалить песню «${song.title}» целиком (все варианты и текст)? Файлы уйдут в корзину Яндекс Диска.`)) return;
        dirtyEditors.delete(isDirty);
        openEditor = null;
        mutate(async () => {
          for (const name of songFiles(song)) await call('delete', { folder, name });
          await saveMeta(folder, song.key, { remove: true });
        }, 'Песня удалена');
      },
    }, 'Удалить песню целиком')));
  }

  return h('div', { class: `editor-inner${isNew ? ' card' : ''}` },
    isNew ? h('h3', { class: 'editor-title' }, 'Новая песня') : null,
    h('div', { class: 'edit-section' }, h('h3', {}, 'Название'), titleInput),
    h('div', { class: 'edit-section' }, h('h3', {}, 'Текст песни'), lyricsEditor.el),
    h('div', { class: 'edit-section' }, h('h3', {}, 'Перевод'),
      h('p', { class: 'muted small' }, 'Для песен на другом языке. Если перевода нет — оставьте пустым.'),
      translationEditor.el),
    h('div', { class: 'edit-section' }, h('h3', {}, 'Заметки'), notesInput),
    h('div', { class: 'edit-section' },
      h('h3', {}, 'Аудио'),
      rows.length ? h('ul', { class: 'variant-list' }, rows.map(r => r.li)) : null,
      pendingList,
      picker,
      h('button', { class: 'btn small', type: 'button', onclick: () => picker.click() }, '+ Добавить аудиофайл'),
      h('p', { class: 'muted small' }, 'Файлы загрузятся на Диск, когда вы нажмёте «Сохранить всё».')),
    extra.length ? h('div', { class: 'edit-section' }, h('h3', {}, 'Другие действия'), ...extra) : null,
    h('div', { class: 'editor-footer' }, status, cancelBtn, saveBtn));
}

function addSongForm(student, close) {
  const empty = { title: '', key: '', variants: [], lyrics: null };
  const form = songEditor(empty, student, { onClose: close, isNew: true });
  setTimeout(() => form.querySelector('input')?.focus());
  return form;
}

// ---------- Плеер ----------
const player = (() => {
  const audio = new Audio();
  audio.preload = 'auto';
  audio.id = 'song-audio'; audio.setAttribute('playsinline', ''); audio.hidden = true;
  document.body.append(audio);
  playbackSession();
  const bar = document.getElementById('player');
  const $ = sel => bar.querySelector(sel);
  const title = $('.p-title'), sub = $('.p-sub'), playBtn = $('.p-play'),
    seek = $('.p-seek'), cur = $('.p-cur'), dur = $('.p-dur'),
    loopBtn = $('.p-loop'), speed = $('.p-speed'), dl = $('.p-dl'), impulseEl = $('.p-impulse');
  let current = null;
  let token = 0;
  let playbackController = null;
  let wavePeaks = null, waveController = null;
  const waveStatus = $('.waveform-status');
  const progress = () => audio.duration ? audio.currentTime / audio.duration : 0;
  function paintWave() {
    document.querySelectorAll('.waveform-canvas').forEach(canvas => {
      if (canvas.closest('[hidden]')) return;
      drawWaveform(canvas, wavePeaks, progress());
    });
  }
  function cancelWave() {
    waveController?.abort(); waveController = null; wavePeaks = null;
    waveStatus.textContent = ''; paintWave();
  }
  async function prepareWave(cur, requested = false) {
    const cache = `songs:wave:1:${cur.id}:${cur.v.file.modified}:${cur.v.file.size}`;
    try {
      const saved = JSON.parse(localGet(cache));
      if (Array.isArray(saved) && saved.length > 0 && saved.length <= 2048 && saved.every(x => Number.isFinite(x) && x >= 0 && x <= 1)) {
        wavePeaks = Float32Array.from(saved); waveStatus.textContent = ''; markActive(); return;
      }
    } catch {}
    // Native playback starts without an extra full-track download and decode.
    if (!requested) { waveStatus.textContent = 'Показать звуковую волну'; return; }
    if (waveController) return;
    const controller = new AbortController(); waveController = controller;
    waveStatus.textContent = 'Готовим волновую форму…';
    try {
      const peaks = await loadWaveform(cur.url, controller.signal);
      if (controller.signal.aborted || current !== cur) return;
      wavePeaks = peaks; waveStatus.textContent = '';
      localSet(cache, JSON.stringify(Array.from(peaks, x => Math.round(x * 1000) / 1000)));
      markActive();
    } catch (e) {
      if (!controller.signal.aborted && current === cur) waveStatus.textContent = 'Волновая форма недоступна';
    } finally { if (waveController === controller) waveController = null; }
  }

  waveStatus.addEventListener('click', () => { if (current?.url) prepareWave(current, true); });
  const fmt = t => {
    if (!isFinite(t)) return '0:00';
    t = Math.floor(t);
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  };

  const timeline = attachProgress(audio, {seek, current: cur, duration: dur, format: fmt,
    canSeek: () => !!current?.url, onUpdate: paintWave});
  function markActive() {
    document.querySelectorAll('.chip.active').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.song').forEach(card => {
      const selected = !!current && card.dataset.songId === `${current.student.id}|${current.song.key}`;
      card.classList.toggle('selected-song', selected);
      const wave = card.querySelector('.song-wave'); if (wave) wave.hidden = !selected || !wavePeaks;
    });
    if (!current) return;
    document.querySelectorAll('.chip').forEach(c => {
      if (c.dataset.id === current.id) c.classList.add('active');
    });
    paintWave();
  }

  function failed(text) {
    sub.textContent = text;
    playBtn.classList.remove('playing');
    bar.classList.remove('busy');
  }
  async function startAudio() {
    const selected = current, my = token;
    playbackSession();
    try {
      await audio.play();
      if (my !== token || selected !== current) return false;
      if (current?.url) sub.textContent = variantName(current.v) + (current.url.startsWith('blob:') ? ' · резервная копия' : '');
      return true;
    }
    catch (error) {
      if (my !== token || selected !== current || error.name === 'AbortError') return false;
      if (error.name !== 'NotAllowedError') throw error;
      failed('Запись готова. Нажмите ▶, чтобы начать.');
      playBtn.setAttribute('aria-label', 'Играть');
      return false;
    }
  }
  const toggleAudio = () => {
    if (!current?.url) return;
    if (!audio.paused) audio.pause();
    else startAudio().catch(error => failed('Не удалось продолжить запись: ' + error.message));
  };
  attachMediaControls(audio, {
    play: () => {if (current?.url) startAudio().catch(() => failed('Нажмите ▶, чтобы продолжить.'));},
    stop: () => {audio.pause(); audio.currentTime = 0;}
  });

  async function tryReserve() {
    if (!storageState().available || !current || current.url?.startsWith('blob:')) return false;
    if (current.recovery) return current.recovery;
    if (current.reserveTried) return false;
    current.reserveTried = true;
    const my = token, selected = current;
    const position = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    const rate = audio.playbackRate;
    audio.pause(); cancelWave(); cancelTempo();
    bar.classList.add('busy'); sub.textContent = 'Загружаю запись из резервной копии…';
    selected.recovery = (async () => {
      const url = await reserveFileUrl(selected.student.id, selected.v.file.name, {
        signal: playbackController?.signal,
        onProgress: value => { if (my === token) sub.textContent = `Загружаю резервную запись · ${Math.round(value * 100)}%`; }
      });
      if (my !== token || current !== selected) return true;
      selected.url = url; audio.src = url; audio.playbackRate = rate;
      if (position) audio.addEventListener('loadedmetadata', () => {
        if (my === token) audio.currentTime = Math.min(position, audio.duration || position);
      }, {once: true});
      dl.href = url; prepareWave(selected);
      if (metro.on) loadTempo();
      sub.textContent = variantName(selected.v) + ' · резервная копия';
      await startAudio();
      if (my === token) bar.classList.remove('busy');
      return true;
    })();
    return selected.recovery;
  }

  async function play(song, v, student, {seekTo = null} = {}) {
    const id = `${student.id}|${v.file.name}`;
    if (current && current.id === id) {
      if (seekTo != null) {
        current.seekTo = seekTo;
        if (current.url) { timeline.seekTo(seekTo); await startAudio(); }
        return;
      }
      return toggleAudio();
    }
    const my = ++token;
    playbackController?.abort(); playbackController = new AbortController();
    cancelWave();
    cancelTempo();
    cancelTaps();
    audio.pause();
    playbackSession(); primeAudio(audio);
    metro.setGrid(0, 0);
    current = { id, song, v, student, url: null, seekTo };
    dl.removeAttribute('href');
    timeline.reset();
    bar.hidden = false;
    document.body.classList.add('has-player');
    impulseEl.hidden = !song.meta?.impulse;
    impulseEl.textContent = song.meta?.impulse || '';
    title.textContent = song.title;
    sub.textContent = variantName(v);
    seek.value = 0; seek.style.setProperty('--p', '0%'); cur.textContent = '0:00'; dur.textContent = '0:00';
    bar.classList.add('busy');
    markActive();
    try {
      const url = await fileUrl(student.id, v.file.name, {
        signal: playbackController.signal,
        onProgress: value => { if (my === token) sub.textContent = `Загружаю резервную запись · ${Math.round(value * 100)}%`; }
      });
      if (my !== token) return;
      sub.textContent = variantName(v) + (url.startsWith('blob:') ? ' · резервная копия' : '');
      current.url = url;
      prepareWave(current);
      const wasRate = audio.playbackRate;
      audio.src = url;
      audio.playbackRate = wasRate;
      if (current.seekTo != null) audio.addEventListener('loadedmetadata', () => {
        if (my === token && current.seekTo != null) timeline.seekTo(current.seekTo);
      }, {once:true, signal: playbackController.signal});
      if (metro.on) loadTempo();
      dl.href = url;
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({ title: song.title, artist: variantName(v) });
      }
      await startAudio();
    } catch (e) {
      if (my === token && e.name !== 'AbortError') {
        try { if (!(await tryReserve()) && my === token) failed('Не удалось запустить: ' + e.message); }
        catch (error) { if (my === token) failed('Не удалось открыть резерв: ' + error.message); }
      }
    } finally {
      if (my === token) bar.classList.remove('busy');
    }
  }

  // ---------- Метроном ----------
  const metro = new Metronome(audio);
  const metroBtn = $('.p-metro-btn'), metroBox = $('.p-metro');
  const beatControls = beatMaskControls(metro, 'songs:metro:mask:song');
  metroBox.append(beatControls.el);
  const mBpm = metroBox.querySelector('.m-bpm'), mStatus = metroBox.querySelector('.m-status'), mDot = metroBox.querySelector('.m-dot');
  const tapBtn = metroBox.querySelector('[data-act="tapTempo"]');
  const bpmInput = metroBox.querySelector('.m-bpm-input');
  const saveBeatBtn = metroBox.querySelector('[data-act="save"]');
  let tempoToken = 0, analysisController = null;
  function cancelTempo() { tempoToken++; analysisController?.abort(); analysisController = null; }
  const cacheKey = cur => `songs:tempo:${TEMPO_VERSION}:${cur.id}:${cur.v.file.modified}:${cur.v.file.size}`;

  // Доли храним компактно: миллисекунды, каждая следующая — разницей с предыдущей.
  const encodeBeats = beats => beats.map((t, i) => Math.round(t * 1000) - (i ? Math.round(beats[i - 1] * 1000) : 0)).join(',');
  const decodeBeats = str => { let acc = 0; return str.split(',').map(x => (acc += Number(x)) / 1000); };

  const showBpm = (note = '') => {
    saveBeatBtn.hidden = role !== 'teacher';
    if (!metro.bpm) { mBpm.textContent = '♩ = …'; bpmInput.value = ''; mStatus.textContent = note; return; }
    const rate = audio.playbackRate || 1;
    mBpm.textContent = `♩ = ${Math.round(metro.bpm)}`;
    if (document.activeElement !== bpmInput) bpmInput.value = String(Math.round(metro.bpm * 100) / 100);
    mStatus.textContent = note || (rate !== 1 ? `сейчас ${Math.round(metro.bpm * rate)} при ${rate}×` : '');
  };

  // Старые автоматические доли пересчитываем. Ручные настройки сохраняем.
  // Автоанализ хранится с версией в браузере; преподаватель может подтвердить его.
  async function loadTempo(force = false) {
    const cur = current;
    if (!cur?.url) return;
    cancelTempo();
    cancelTaps();
    const my = tempoToken;
    const saved = cur.song.meta?.tempo?.[cur.v.file.name];
    let cached;
    try { cached = JSON.parse(localGet(cacheKey(cur))); } catch {}
    const selected = !force && (cached?.remote === JSON.stringify(saved ?? null) ? cached : saved?.manual ? saved : null);
    if (selected && Number.isFinite(selected.bpm) && selected.bpm > 20 && selected.bpm < 400) {
      const beats = selected.beats ? decodeBeats(selected.beats) : null;
      if (beats?.length && beats.every((b, i) => Number.isFinite(b) && (!i || b > beats[i - 1]))) metro.setBeats(beats, selected.bpm);
      else metro.setGrid(selected.bpm, selected.offset || 0);
      return showBpm(selected.manual ? 'настроено вручную' : selected.uncertain ? 'Проверьте доли — результат неточный' : 'авто · проверьте совпадение');
    }
    metro.setGrid(0, 0);
    showBpm();
    if (!force) return showBpm('Задайте BPM, настучите или нажмите «Авто»');
    analysisController = new AbortController();
    try {
      const t = await detectTempo(cur.url, { signal: analysisController.signal, onProgress: text => { if (my === tempoToken) mStatus.textContent = text; } });
      if (my !== tempoToken || current !== cur) return;
      metro.setBeats(t.beats, t.bpm);
      showBpm(t.uncertain ? 'Проверьте доли — результат неточный' : 'авто · проверьте совпадение');
      rememberTempo(cur, false, t.uncertain);
    } catch (e) {
      if (my === tempoToken) { mBpm.textContent = '♩ = ?'; mStatus.textContent = 'Не получилось определить темп — попробуйте «Настучать»'; }
    }
  }

  function rememberTempo(cur = current, manual = true, uncertain = false) {
    if (!cur || !metro.bpm) return;
    const t = { bpm: Math.round(metro.bpm * 1000) / 1000, offset: Math.round(metro.offset * 1000) / 1000 };
    if (metro.beats) t.beats = encodeBeats(metro.beats);
    if (manual) t.manual = true;
    let saved = Promise.resolve(true);
    if (manual && role === 'teacher') {
      cur.song.meta ||= {};
      cur.song.meta.tempo = { ...cur.song.meta.tempo, [cur.v.file.name]: t };
      saved = saveMeta(cur.student.id, cur.song.key, { patch: { tempo: { [cur.v.file.name]: t } } })
        .then(() => true).catch(e => { toast('Темп не сохранился: ' + e.message, 'error'); return false; });
    }
    localSet(cacheKey(cur), JSON.stringify({ ...t, uncertain, remote: JSON.stringify(cur.song.meta?.tempo?.[cur.v.file.name] ?? null) }));
    return saved;
  }

  metroBtn.addEventListener('click', () => {
    if (metro.on) {
      metro.stop();
      cancelTempo();
      cancelTaps();
    } else {
      standalone.stop();
      metro.start();
      loadTempo();
    }
    metroBtn.setAttribute('aria-pressed', String(metro.on));
    metroBox.hidden = !metro.on;
    bar.classList.toggle('with-metro', metro.on);
  });

  // «Настучать»: нажимайте в такт музыке; после 8 нажатий (или паузы) темп готов.
  let taps = [], tapTimer = null;
  function cancelTaps() {
    clearTimeout(tapTimer); taps = [];
    tapBtn.textContent = 'Настучать'; tapBtn.classList.remove('active');
  }
  function finishTaps() {
    clearTimeout(tapTimer);
    const fit = fitTaps(taps);
    taps = [];
    tapBtn.textContent = 'Настучать';
    tapBtn.classList.remove('active');
    if (!fit) return showBpm('Не получилось — стучите ровно, хотя бы 4 раза');
    metro.setGrid(fit.bpm, fit.offset);
    showBpm('настучано вручную');
    rememberTempo();
  }

  metroBox.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act || !current) return;
    if (act === 'tapTempo') {
      if (audio.paused) return toast('Включите песню и стучите по кнопке в такт');
      if (!taps.length) { cancelTempo(); metro.setGrid(0, 0); }
      taps.push(metro.heardTime());
      tapBtn.classList.add('active');
      tapBtn.textContent = `Ещё… ${taps.length}/8`;
      clearTimeout(tapTimer);
      if (taps.length >= 8) return finishTaps();
      tapTimer = setTimeout(finishTaps, 2500);
      return;
    }
    if (act === 'auto') return loadTempo(true);
    if (!metro.bpm) return;
    cancelTempo();
    if (act === 'half') metro.half();
    if (act === 'double') metro.double();
    if (act === 'earlier') metro.shift(-0.01);
    if (act === 'later') metro.shift(0.01);
    if (act === 'align') {
      if (audio.paused) return toast('Включите песню и нажмите точно в момент доли');
      metro.alignTo(metro.heardTime());
    }
    showBpm();
    const target = current;
    rememberTempo().then(ok => {
      if (act === 'save' && current === target) showBpm(ok ? 'доли сохранены' : 'сохранено только в этом браузере');
    });
  });
  bpmInput.addEventListener('change', () => {
    const bpm = Number(bpmInput.value.replace(',', '.'));
    if (!(bpm > 20 && bpm < 400)) { toast('Введите темп от 21 до 399 BPM'); return showBpm(); }
    cancelTempo(); cancelTaps();
    // При смене BPM сохраняем ближайшую текущую долю как опорную точку.
    const t = audio.currentTime;
    const anchor = metro.beats ? metro.beats[metro.nearestIndex(t)]
      : metro.bpm ? metro.offset + Math.round((t - metro.offset) * metro.bpm / 60) * 60 / metro.bpm : t;
    metro.setGrid(bpm, anchor);
    showBpm('настроено вручную'); rememberTempo();
  });
  for (const ev of ['pause', 'seeking', 'ratechange']) audio.addEventListener(ev, cancelTaps);
  metroBox.querySelector('.m-vol').addEventListener('input', e => metro.setVolume(Number(e.target.value)));
  metro.onBeat = (slot, audible) => { beatControls.pulse(slot); mDot.classList.remove('beat'); if (audible) { void mDot.offsetWidth; mDot.classList.add('beat'); } };
  audio.addEventListener('ratechange', () => showBpm());

  playBtn.addEventListener('click', toggleAudio);
  $('.p-back').addEventListener('click', () => timeline.seekTo(audio.currentTime - 5));
  $('.p-fwd').addEventListener('click', () => timeline.seekTo(audio.currentTime + 5));
  loopBtn.addEventListener('click', () => {
    audio.loop = !audio.loop;
    loopBtn.setAttribute('aria-pressed', String(audio.loop));
  });
  const speedLabel = $('.p-speed-value');
  const setSpeed = value => {
    const number = Math.min(1.5, Math.max(0.5, Number(value) || 1));
    audio.playbackRate = number; speed.value = String(number); speedLabel.textContent = `${number.toFixed(2)}×`;
  };
  speed.addEventListener('input', () => setSpeed(speed.value));
  $('.p-speed-reset').addEventListener('click', () => setSpeed(1));
  dl.addEventListener('click', event => { event.preventDefault(); if (current) downloadVariant(current.student, current.v, dl); });
  $('.p-close').addEventListener('click', () => {
    playbackController?.abort();
    audio.pause();
    token++;
    cancelWave();
    cancelTempo(); cancelTaps();
    current = null;
    audio.removeAttribute('src'); audio.load(); timeline.reset();
    if (metro.on) metroBtn.click();
    bar.hidden = true;
    document.body.classList.remove('has-player');
    markActive();
  });

  audio.addEventListener('seeked', paintWave);
  document.addEventListener('click', e => {
    if (!e.target.matches('.waveform-canvas') || !current || !Number.isFinite(audio.duration)) return;
    const rect = e.target.getBoundingClientRect();
    if (rect.width > 0) timeline.seekTo(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * audio.duration);
  });
  new ResizeObserver(() => {
    document.documentElement.style.setProperty('--player-height', `${bar.hidden ? 0 : bar.getBoundingClientRect().height}px`);
    paintWave();
  }).observe(bar);
  new ResizeObserver(paintWave).observe(main);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintWave);
  audio.addEventListener('play', () => { playBtn.classList.add('playing'); playBtn.setAttribute('aria-label', 'Пауза'); });
  audio.addEventListener('pause', () => { playBtn.classList.remove('playing'); playBtn.setAttribute('aria-label', 'Играть'); });
  audio.addEventListener('error', () => {
    const my = token;
    if (current) tryReserve().then(recovered => {
      if (!recovered && my === token) failed('Не удалось загрузить запись. Попробуйте ещё раз.');
    }).catch(error => { if (my === token) failed('Не удалось открыть резерв: ' + error.message); });
  });
  let stallTimer;
  const cancelStall = () => clearTimeout(stallTimer);
  audio.addEventListener('waiting', () => {
    bar.classList.add('busy'); cancelStall();
    if (storageState().available) {
      const my = token;
      stallTimer = setTimeout(() => {
        if (my === token && !audio.paused) tryReserve().catch(error => {
          if (my === token) failed('Не удалось открыть резерв: ' + error.message);
        });
      }, 15000);
    }
  });
  audio.addEventListener('pause', cancelStall);
  audio.addEventListener('playing', () => { cancelStall(); bar.classList.remove('busy'); });

  // Пробел — пауза/продолжить, если не печатаем в поле.
  document.addEventListener('keydown', e => {
    if (e.code !== 'Space' || !current || e.target.closest('input, select, textarea, button, summary')) return;
    e.preventDefault();
    toggleAudio();
  });

  // После перерисовки страницы подсветить играющий вариант.
  new MutationObserver(markActive).observe(main, { childList: true, subtree: true });

  return { play,
    seekVariant(song, variant, student, seconds) { return play(song, variant, student, {seekTo: seconds}); },
    stop() { if (current) $('.p-close').click(); },
    restrictTo(spaces) { if (current && !spaces.some(space => space.id === current.student.id)) $('.p-close').click(); },
    positionFor(student, song, filename = null) { return current?.student.id === student.id && current?.song.key === song.key && (!filename || current?.v.file.name === filename) ? audio.currentTime : null; },
    stopSongMetronome() { if (metro.on) metroBtn.click(); } };
})();

// Виджет находится вне перерисовываемой библиотеки и остаётся на экране
// при поиске, прокрутке, переходах к ученикам и закрытии плеера.
const standalone = (() => {
  const metro = new StandaloneMetronome();
  const beatControls = beatMaskControls(metro, 'songs:metro:mask:standalone');
  const savedPattern = localGet('songs:standalone:pattern');
  metro.setPattern(Object.hasOwn(DRUM_PATTERNS, savedPattern) ? savedPattern : 'click');
  const storedTempo = Number(localGet('songs:standalone:bpm'));
  metro.setTempo(storedTempo >= 1 && storedTempo <= 999 ? storedTempo : 120);
  const storedVolume = localGet('songs:standalone:volume');
  const volume = storedVolume === null ? 0.6 : Number(storedVolume);
  metro.setVolume(Number.isFinite(volume) && volume >= 0 && volume <= 1 ? volume : 0.6);
  const dot = h('span', { class: 'm-dot', 'aria-hidden': 'true' });
  const pattern = h('select', { class: 'standalone-pattern', 'aria-label': 'Ритм самостоятельного метронома', onchange: e => {
    metro.setPattern(e.target.value); localSet('songs:standalone:pattern', e.target.value);
  } }, Object.entries(DRUM_PATTERNS).map(([id, info]) => h('option', { value: id }, info.name)));
  pattern.value = metro.pattern;
  const bpm = h('input', { class: 'standalone-bpm', type: 'text', inputmode: 'decimal', value: metro.bpm, 'aria-label': 'Темп самостоятельного метронома', title: 'От 1 до 999 BPM, можно вводить дробное число' });
  const toggle = h('button', { class: 'btn primary small', type: 'button', 'aria-pressed': 'false', onclick: () => {
    if (metro.on) return stop();
    if (!setTempo(bpm.value)) return;
    try { player.stopSongMetronome(); metro.start(); update(); }
    catch (e) { stop(); toast('Не удалось включить метроном: ' + e.message, 'error'); }
  } }, 'Запустить');
  const widget = h('section', { class: 'standalone-widget', hidden: true, 'aria-label': 'Самостоятельный метроном' },
    h('div', { class: 'standalone-inner' },
      h('div', { class: 'standalone-title' }, dot, h('strong', {}, 'Метроном'), h('span', { class: 'muted small' }, 'без песни')),
      h('div', { class: 'standalone-controls' },
        pattern,
        h('button', { class: 'm-btn standalone-decrease', type: 'button', 'aria-label': 'Уменьшить самостоятельный темп на 1', onclick: () => setTempo(Math.max(1, metro.bpm - 1)) }, '−'),
        h('label', { class: 'm-tempo' }, bpm, 'BPM'),
        h('button', { class: 'm-btn standalone-increase', type: 'button', 'aria-label': 'Увеличить самостоятельный темп на 1', onclick: () => setTempo(Math.min(999, metro.bpm + 1)) }, '+'),
        toggle,
        h('input', { class: 'm-vol', type: 'range', min: 0, max: 1, step: 0.05, value: metro.volume, 'aria-label': 'Громкость самостоятельного метронома', oninput: e => {
          metro.setVolume(Number(e.target.value)); localSet('songs:standalone:volume', metro.volume);
        } }))), beatControls.el,
    h('p', {class: 'metro-background-note muted small'}, 'Щелчки в браузере могут прерваться при блокировке экрана.'));
  main.before(widget);
  function update() { toggle.textContent = metro.on ? 'Остановить' : 'Запустить'; toggle.setAttribute('aria-pressed', String(metro.on)); }
  function stop() { metro.stop(); dot.classList.remove('beat'); update(); }
  function setTempo(value) {
    const number = Number(String(value).replace(',', '.'));
    if (!Number.isFinite(number) || number < 1 || number > 999) {
      bpm.value = String(metro.bpm); toast('Введите темп от 1 до 999 BPM'); return false;
    }
    metro.setTempo(number); bpm.value = String(number); localSet('songs:standalone:bpm', number); return true;
  }
  bpm.addEventListener('change', () => setTempo(bpm.value));
  bpm.addEventListener('keydown', e => { if (e.key === 'Enter') { setTempo(bpm.value); bpm.blur(); } });
  metro.onBeat = (slot, audible) => { beatControls.pulse(slot); dot.classList.remove('beat'); if (audible) { void dot.offsetWidth; dot.classList.add('beat'); } };
  window.addEventListener('pagehide', stop);
  return { stop, setVisible(visible) {
    widget.hidden = !visible;
    pattern.hidden = role !== 'teacher';
    if (role !== 'teacher' && metro.pattern !== 'click') { metro.setPattern('click'); pattern.value = 'click'; }
    if (!visible) stop();
  } };
})();

route();
