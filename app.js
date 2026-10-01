import { call, setKey, fileUrl, fileText, uploadFile } from './api.js';
import { groupSongs, variantName, songKey, buildFileName, retitleFileName, parseFileName, AUDIO_EXT } from './parse.js';
import { NEW_DAYS, NEW_SINCE } from './config.js';
import { renderLyrics, editorToMarkup, COLORS } from './lyrics.js';
import { Metronome, StandaloneMetronome, fitTaps } from './metronome.js?v=standalone1';
import { detectTempo, TEMPO_VERSION } from './tempo.js?v=metro3';

const main = document.getElementById('main');
let role = null;         // 'teacher' | 'student'
let library = null;      // [{id, name, key?, songs}]
let libraryKey = null;   // для какого ключа загружена библиотека
let openEditor = null;   // песня, у которой открыт редактор (folder + key)

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

function localGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localSet(k, v) { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } }

// ---------- Уведомления ----------
const toastBox = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
document.body.append(toastBox);
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
function saveMeta(folder, song, extra) {
  const job = metaQueue.then(() => call('saveMeta', { folder, song, ...extra }));
  metaQueue = job.catch(() => {});
  return job;
}
async function ensureLibrary(key, force) {
  if (library && libraryKey === key && !force) return;
  setKey(key);
  const data = await call('library');
  role = data.role;
  libraryKey = key;
  library = data.students
    .map(d => ({ id: d.id, name: d.name, key: d.key, songs: withMeta(groupSongs(d.files), d.meta) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

function showState(...children) {
  main.replaceChildren(h('div', { class: 'state' }, ...children));
}

// ---------- Маршруты ----------
// #/t/<ключ>               — преподаватель, все ученики
// #/t/<ключ>/s/<папка>     — преподаватель на страничке ученика
// #/s/<ключ>               — ученик
async function route(force = false, quiet = false) {
  const hash = location.hash.replace(/^#\/?/, '');
  const m = hash.match(/^([ts])\/([\w-]{8,})(?:\/s\/(.+))?$/);
  if (!m) { standalone.setVisible(false); return hash ? renderOldLink() : renderLanding(); }
  const [, mode, key, folder] = m;
  if (mode !== 't' || libraryKey !== key) standalone.setVisible(false);
  if (!quiet || !library) showState(h('div', { class: 'spinner' }), 'Загружаю песни…');
  try {
    await ensureLibrary(key, force);
  } catch (e) {
    if (e.status === 403) standalone.setVisible(false);
    return showState(
      h('p', {}, e.status === 403 ? 'Эта ссылка не работает.' : 'Не получилось загрузить песни.'),
      h('p', { class: 'muted' }, e.message),
      e.status === 403 ? null : h('button', { class: 'btn', onclick: () => route(true) }, 'Попробовать снова'));
  }
  standalone.setVisible(role === 'teacher' && mode === 't');
  if (role === 'student' || mode === 's') return renderStudent(library[0]);
  if (folder) {
    const s = library.find(x => x.id === decodeURIComponent(folder));
    if (s) return renderStudent(s);
    if (!force) return route(true, quiet);   // может, ученика только что добавили
  }
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
  document.title = 'Все ученики — Песни';
  const results = h('div', { class: 'results' });
  const grid = h('div', { class: 'students' }, library.map(s => studentCard(s, key)));

  const search = h('input', {
    type: 'search', class: 'search', placeholder: 'Найти песню у всех учеников…',
    oninput: () => {
      const q = songKey(search.value);
      grid.hidden = !!q;
      if (!q) return results.replaceChildren();
      const found = [];
      for (const s of library) for (const song of s.songs)
        if (song.key.includes(q)) found.push({ s, song });
      results.replaceChildren(found.length
        ? h('div', { class: 'songs' }, found.map(({ s, song }) => songCard(song, s, { owner: true })))
        : h('p', { class: 'muted' }, 'Ничего не нашлось.'));
    },
  });

  const addStudent = () => {
    const name = prompt('Имя ученика (или название коллектива):');
    if (name?.trim()) mutate(() => call('createStudent', { name }), `Добавлен: ${name.trim()}`);
  };

  const total = library.reduce((n, s) => n + s.songs.length, 0);
  main.replaceChildren(
    h('header', { class: 'page-head' },
      h('div', {},
        h('p', { class: 'eyebrow' }, 'Страница преподавателя'),
        h('h1', {}, 'Ученики'),
        h('p', { class: 'muted' }, `${plural(library.length, 'страничка', 'странички', 'страничек')} · ${plural(total, 'песня', 'песни', 'песен')}`)),
      h('div', { class: 'head-actions' },
        h('button', { class: 'btn primary', onclick: addStudent }, '+ Ученик'),
        h('button', { class: 'btn ghost', onclick: () => route(true) }, 'Обновить'))),
    search, results, grid,
    h('p', { class: 'muted hint' }, 'Не показывайте эту страницу ученикам: её адрес открывает доступ ко всем песням.'));
}

function studentCard(s, key) {
  const copyBtn = h('button', { class: 'btn small', onclick: () => copyText(studentLink(s), copyBtn) }, 'Скопировать ссылку');
  const fresh = s.songs.filter(x => isNew(x.modified)).length;
  const href = `#/t/${key}/s/${encodeURIComponent(s.id)}`;
  return h('article', { class: 'student' },
    h('a', { class: 'student-name', href }, s.name),
    h('p', { class: 'muted' }, plural(s.songs.length, 'песня', 'песни', 'песен'),
      fresh ? h('span', { class: 'badge' }, `новых: ${fresh}`) : null),
    h('div', { class: 'student-actions' },
      h('a', { class: 'btn small primary', href }, 'Открыть'), copyBtn));
}

// ---------- Страница ученика ----------
let sortMode = localGet('sort') || 'name';

function renderStudent(student) {
  document.title = `${student.name} — Песни`;
  const isTeacher = role === 'teacher';
  const list = h('div', { class: 'songs' });
  const addBox = h('div', { class: 'add-song', hidden: true });

  const draw = () => {
    const q = songKey(search.value);
    let songs = student.songs.filter(s => !q || s.key.includes(q));
    songs = [...songs].sort(sortMode === 'new'
      ? (a, b) => b.modified.localeCompare(a.modified)
      : (a, b) => a.title.localeCompare(b.title, 'ru'));
    list.replaceChildren(...(songs.length
      ? songs.map(s => songCard(s, student))
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
    h('a', { class: 'btn ghost small', href: `#/t/${libraryKey}` }, '← Все ученики'),
    (() => {
      const b = h('button', { class: 'btn small', onclick: () => copyText(studentLink(student), b) }, 'Скопировать ссылку ученика');
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
        h('button', {
          class: 'btn small danger', onclick: () => {
            if (confirm(`Удалить страничку «${student.name}» со всеми песнями? Папка уйдёт в корзину Яндекс Диска, её можно будет восстановить оттуда.`))
              mutate(async () => { await call('deleteStudent', { folder: student.id }); location.hash = `#/t/${libraryKey}`; }, 'Удалено (в корзине Диска)');
          },
        }, 'Удалить ученика'))));

  main.replaceChildren(...[
    teacherTools,
    h('header', { class: 'page-head' },
      h('div', {},
        h('h1', {}, student.name),
        h('p', { class: 'muted' }, plural(student.songs.length, 'песня', 'песни', 'песен'))),
      h('div', { class: 'head-actions' }, addBtn)),
    addBox,
    h('div', { class: 'toolbar' }, search, sort),
    list,
  ].filter(Boolean));
  draw();
}

// ---------- Карточка песни ----------
// Раскрывающееся окно для чтения (текст песни или перевод) с кнопкой «Свернуть» внизу.
function readingPane(label, load) {
  const body = h('div', { class: 'lyrics-text' });
  const box = h('div', { class: 'lyrics', hidden: true },
    h('div', { class: 'pane-title' }, label), body,
    h('button', { class: 'link-btn collapse', onclick: () => { set(false); box.parentNode?.parentNode?.scrollIntoView({ block: 'nearest' }); } }, 'Свернуть ▲'));
  const btn = h('button', { class: 'link-btn', 'aria-expanded': 'false', onclick: () => set(box.hidden) }, label);
  let loaded = false;
  async function set(open) {
    box.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    btn.textContent = open ? `Свернуть: ${label.toLowerCase()}` : label;
    btn.parentNode?.parentNode?.querySelector('.reading')?.classList.toggle('two', [...btn.parentNode.parentNode.querySelectorAll('.reading > .lyrics')].filter(x => !x.hidden).length > 1);
    if (open && !loaded) {
      body.textContent = 'Загружаю…';
      try { body.innerHTML = renderLyrics(await load()); loaded = true; } catch (e) { body.textContent = e.message; }
    }
  }
  return { btn, box, set };
}

// «Импульс»: ученик вписывает 1–2 слова; преподаватель видит их у песни.
function impulseBlock(song, student) {
  const value = song.meta.impulse || '';
  if (role !== 'student') {
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

function songCard(song, student, { owner = false } = {}) {
  const editorKey = `${student.id}|${song.key}`;

  const lyrics = song.lyrics && readingPane('Текст песни', () => fileText(student.id, song.lyrics.name));
  const translation = song.meta.translation && readingPane('Перевод', async () => song.meta.translation);
  const reading = h('div', { class: 'reading' }, lyrics?.box, translation?.box);

  // Редактор: пока он открыт, окна для чтения и ссылки скрыты.
  const editBox = h('div', { class: 'editor', hidden: true });
  const links = h('div', { class: 'song-links' }, lyrics?.btn, translation?.btn,
    h('button', { class: 'link-btn', onclick: () => setEditing(true) }, 'Изменить'));
  function setEditing(on) {
    openEditor = on ? editorKey : null;
    editBox.hidden = !on;
    links.hidden = on;
    reading.hidden = on;
    if (on) {
      lyrics?.set(false);
      translation?.set(false);
      editBox.replaceChildren(songEditor(song, student, { onClose: () => setEditing(false) }));
    } else {
      editBox.replaceChildren();
    }
  }

  const card = h('article', { class: 'song' + (role === 'student' && !song.meta.impulse ? ' needs-impulse' : '') },
    h('div', { class: 'song-head' },
      h('h2', {}, song.title),
      isNew(song.modified) ? h('span', { class: 'badge' }, 'новое') : null,
      owner ? h('span', { class: 'owner' }, student.name) : null),
    impulseBlock(song, student),
    song.variants.length
      ? h('div', { class: 'variants' }, song.variants.map(v =>
        h('button', {
          class: `chip ${v.kind}`, 'data-id': `${student.id}|${v.file.name}`,
          onclick: () => player.play(song, v, student),
        }, variantName(v))))
      : h('p', { class: 'muted' }, 'Нет аудио — добавьте вариант в «Изменить».'),
    song.meta.notes ? h('div', { class: 'notes' }, h('div', { class: 'pane-title' }, 'Заметки'), song.meta.notes) : null,
    links, reading, editBox);
  if (openEditor === editorKey) setEditing(true);
  return card;
}

// Все файлы песни (аудио + текст) — для копирования и удаления.
const songFiles = song => [...song.variants.map(v => v.file.name), ...(song.lyrics ? [song.lyrics.name] : [])];

// Открытые редакторы с несохранёнными правками — предупреждаем перед уходом со страницы.
const dirtyEditors = new Set();
window.addEventListener('beforeunload', e => {
  if ([...dirtyEditors].some(f => f())) { e.preventDefault(); e.returnValue = ''; }
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
    if (sel.rangeCount && area.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
  });
  const cmd = (name, value) => {
    area.focus();
    if (savedRange) {
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

  const markActive = () => {
    const sel = getSelection();
    if (!sel.rangeCount) return false;
    let n = sel.anchorNode;
    for (; n && n !== area; n = n.parentNode) {
      if (n.nodeType === 1 && (n.tagName === 'MARK' || (n.style.backgroundColor && n.style.backgroundColor !== 'transparent'))) return true;
    }
    return false;
  };

  const toolbar = h('div', { class: 'toolbar-fmt' },
    tool(h('b', {}, 'Ж'), 'Жирный (Ctrl+B)', () => cmd('bold')),
    tool(h('i', {}, 'К'), 'Курсив (Ctrl+I)', () => cmd('italic')),
    tool(h('u', {}, 'Ч'), 'Подчёркнутый (Ctrl+U)', () => cmd('underline')),
    tool(h('mark', {}, 'М'), 'Маркер', () => cmd('hiliteColor', markActive() ? 'transparent' : '#fff176')),
    h('span', { class: 'tool-sep' }),
    Object.entries(COLORS).map(([name, c]) =>
      tool(h('span', { class: `swatch c-${name}` }), c.name, () => cmd('foreColor', c.hex), 'color')),
    tool('A', 'Обычный цвет', () => cmd('foreColor', getComputedStyle(area).color), 'color plain'),
    h('span', { class: 'tool-sep' }),
    tool('⌫', 'Убрать оформление', () => { cmd('removeFormat'); cmd('hiliteColor', 'transparent'); }));

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
  audio.crossOrigin = 'anonymous'; // чтобы музыку можно было пустить через тот же звуковой путь, что и метроном
  audio.preload = 'auto';
  const bar = document.getElementById('player');
  const $ = sel => bar.querySelector(sel);
  const title = $('.p-title'), sub = $('.p-sub'), playBtn = $('.p-play'),
    seek = $('.p-seek'), cur = $('.p-cur'), dur = $('.p-dur'),
    loopBtn = $('.p-loop'), speed = $('.p-speed'), dl = $('.p-dl'), impulseEl = $('.p-impulse');
  let current = null;
  let token = 0;

  const fmt = t => {
    if (!isFinite(t)) return '0:00';
    t = Math.floor(t);
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  };

  function markActive() {
    document.querySelectorAll('.chip.active').forEach(c => c.classList.remove('active'));
    if (!current) return;
    document.querySelectorAll('.chip').forEach(c => {
      if (c.dataset.id === current.id) c.classList.add('active');
    });
  }

  function failed(text) {
    sub.textContent = text;
    playBtn.classList.remove('playing');
    bar.classList.remove('busy');
  }

  async function play(song, v, student) {
    const id = `${student.id}|${v.file.name}`;
    if (current && current.id === id) {
      return audio.paused ? audio.play() : audio.pause();
    }
    const my = ++token;
    cancelTempo();
    cancelTaps();
    audio.pause();
    metro.setGrid(0, 0);
    current = { id, song, v, student, url: null };
    bar.hidden = false;
    document.body.classList.add('has-player');
    impulseEl.hidden = !song.meta?.impulse;
    impulseEl.textContent = song.meta?.impulse || '';
    title.textContent = song.title;
    sub.textContent = variantName(v);
    bar.classList.add('busy');
    markActive();
    try {
      const url = await fileUrl(student.id, v.file.name);
      if (my !== token) return;
      current.url = url;
      const wasRate = audio.playbackRate;
      audio.src = url;
      audio.playbackRate = wasRate;
      if (metro.on) loadTempo();
      dl.href = url;
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({ title: song.title, artist: variantName(v) });
      }
      await audio.play();
    } catch (e) {
      if (my === token && e.name !== 'AbortError') failed('Не удалось запустить: ' + e.message);
    } finally {
      if (my === token) bar.classList.remove('busy');
    }
  }

  // ---------- Метроном ----------
  const metro = new Metronome(audio);
  const metroBtn = $('.p-metro-btn'), metroBox = $('.p-metro');
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
  metro.onBeat = () => { mDot.classList.remove('beat'); void mDot.offsetWidth; mDot.classList.add('beat'); };
  audio.addEventListener('ratechange', () => showBpm());

  playBtn.addEventListener('click', () => (audio.paused ? audio.play() : audio.pause()));
  $('.p-back').addEventListener('click', () => { audio.currentTime = Math.max(0, audio.currentTime - 5); });
  $('.p-fwd').addEventListener('click', () => { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5); });
  loopBtn.addEventListener('click', () => {
    audio.loop = !audio.loop;
    loopBtn.setAttribute('aria-pressed', String(audio.loop));
  });
  speed.addEventListener('change', () => { audio.playbackRate = Number(speed.value); });
  $('.p-close').addEventListener('click', () => {
    audio.pause();
    token++;
    cancelTempo(); cancelTaps();
    current = null;
    if (metro.on) metroBtn.click();
    bar.hidden = true;
    document.body.classList.remove('has-player');
    markActive();
  });

  let seeking = false;
  seek.addEventListener('input', () => { seeking = true; cur.textContent = fmt(seek.value / 1000 * audio.duration); });
  seek.addEventListener('change', () => { audio.currentTime = seek.value / 1000 * audio.duration; seeking = false; });

  audio.addEventListener('timeupdate', () => {
    if (seeking || !audio.duration) return;
    seek.value = Math.round(audio.currentTime / audio.duration * 1000);
    seek.style.setProperty('--p', seek.value / 10 + '%');
    cur.textContent = fmt(audio.currentTime);
  });
  audio.addEventListener('loadedmetadata', () => { dur.textContent = fmt(audio.duration); });
  audio.addEventListener('play', () => { playBtn.classList.add('playing'); playBtn.setAttribute('aria-label', 'Пауза'); });
  audio.addEventListener('pause', () => { playBtn.classList.remove('playing'); playBtn.setAttribute('aria-label', 'Играть'); });
  audio.addEventListener('error', () => {
    if (current) failed('Не играет. Если сайт открыт в DuckDuckGo — попробуйте Chrome или Яндекс Браузер.');
  });
  audio.addEventListener('waiting', () => bar.classList.add('busy'));
  audio.addEventListener('playing', () => bar.classList.remove('busy'));

  // Пробел — пауза/продолжить, если не печатаем в поле.
  document.addEventListener('keydown', e => {
    if (e.code !== 'Space' || !current || e.target.closest('input, select, textarea, button, summary')) return;
    e.preventDefault();
    audio.paused ? audio.play() : audio.pause();
  });

  // После перерисовки страницы подсветить играющий вариант.
  new MutationObserver(markActive).observe(main, { childList: true, subtree: true });

  return { play, stopSongMetronome() { if (metro.on) metroBtn.click(); } };
})();

// Виджет находится вне перерисовываемой библиотеки и остаётся на экране
// при поиске, прокрутке, переходах к ученикам и закрытии плеера.
const standalone = (() => {
  const metro = new StandaloneMetronome();
  const storedTempo = Number(localGet('songs:standalone:bpm'));
  metro.setTempo(storedTempo >= 1 && storedTempo <= 999 ? storedTempo : 120);
  const storedVolume = localGet('songs:standalone:volume');
  const volume = storedVolume === null ? 0.6 : Number(storedVolume);
  metro.setVolume(Number.isFinite(volume) && volume >= 0 && volume <= 1 ? volume : 0.6);
  const dot = h('span', { class: 'm-dot', 'aria-hidden': 'true' });
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
        h('button', { class: 'm-btn', type: 'button', 'aria-label': 'Уменьшить самостоятельный темп на 1', onclick: () => setTempo(Math.max(1, metro.bpm - 1)) }, '−'),
        h('label', { class: 'm-tempo' }, bpm, 'BPM'),
        h('button', { class: 'm-btn', type: 'button', 'aria-label': 'Увеличить самостоятельный темп на 1', onclick: () => setTempo(Math.min(999, metro.bpm + 1)) }, '+'),
        toggle,
        h('input', { class: 'm-vol', type: 'range', min: 0, max: 1, step: 0.05, value: metro.volume, 'aria-label': 'Громкость самостоятельного метронома', oninput: e => {
          metro.setVolume(Number(e.target.value)); localSet('songs:standalone:volume', metro.volume);
        } }))));
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
  metro.onBeat = () => { dot.classList.remove('beat'); void dot.offsetWidth; dot.classList.add('beat'); };
  window.addEventListener('pagehide', stop);
  return { stop, setVisible(visible) { widget.hidden = !visible; if (!visible) stop(); } };
})();

route();
