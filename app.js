import { call, setKey, fileUrl, fileText, uploadFile } from './api.js';
import { groupSongs, variantName, songKey, buildFileName, retitleFileName, parseFileName, AUDIO_EXT } from './parse.js';
import { NEW_DAYS, NEW_SINCE } from './config.js';
import { renderLyrics, editorToMarkup, COLORS } from './lyrics.js';

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
async function ensureLibrary(key, force) {
  if (library && libraryKey === key && !force) return;
  setKey(key);
  const data = await call('library');
  role = data.role;
  libraryKey = key;
  library = data.students
    .map(d => ({ id: d.id, name: d.name, key: d.key, songs: groupSongs(d.files) }))
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
  if (!m) return hash ? renderOldLink() : renderLanding();
  const [, mode, key, folder] = m;
  if (!quiet || !library) showState(h('div', { class: 'spinner' }), 'Загружаю песни…');
  try {
    await ensureLibrary(key, force);
  } catch (e) {
    return showState(
      h('p', {}, e.status === 403 ? 'Эта ссылка не работает.' : 'Не получилось загрузить песни.'),
      h('p', { class: 'muted' }, e.message),
      e.status === 403 ? null : h('button', { class: 'btn', onclick: () => route(true) }, 'Попробовать снова'));
  }
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
function songCard(song, student, { owner = false } = {}) {
  const editorKey = `${student.id}|${song.key}`;

  // Текст для чтения: раскрывается и сворачивается (кнопки сверху и снизу текста).
  const lyricsText = h('div', { class: 'lyrics-text' });
  const lyricsBox = h('div', { class: 'lyrics', hidden: true },
    lyricsText,
    h('button', { class: 'link-btn collapse', onclick: () => { setLyrics(false); card.scrollIntoView({ block: 'nearest' }); } }, 'Свернуть текст ▲'));
  let lyricsLoaded = false;
  const lyricsBtn = song.lyrics && h('button', { class: 'link-btn', 'aria-expanded': 'false', onclick: () => setLyrics(lyricsBox.hidden) }, 'Текст песни');
  async function setLyrics(open) {
    if (!lyricsBtn) return;
    lyricsBox.hidden = !open;
    lyricsBtn.setAttribute('aria-expanded', String(open));
    lyricsBtn.textContent = open ? 'Свернуть текст' : 'Текст песни';
    if (open && !lyricsLoaded) {
      lyricsText.textContent = 'Загружаю…';
      try {
        lyricsText.innerHTML = renderLyrics(await fileText(student.id, song.lyrics.name));
        lyricsLoaded = true;
      } catch (e) { lyricsText.textContent = e.message; }
    }
  }

  // Редактор: пока он открыт, текст для чтения и ссылки скрыты.
  const editBox = h('div', { class: 'editor', hidden: true });
  const links = h('div', { class: 'song-links' }, lyricsBtn || null,
    h('button', { class: 'link-btn', onclick: () => setEditing(true) }, 'Изменить'));
  function setEditing(on) {
    openEditor = on ? editorKey : null;
    editBox.hidden = !on;
    links.hidden = on;
    if (on) {
      setLyrics(false);
      editBox.replaceChildren(songEditor(song, student, { onClose: () => setEditing(false) }));
    } else {
      editBox.replaceChildren();
    }
  }

  const card = h('article', { class: 'song' },
    h('div', { class: 'song-head' },
      h('h2', {}, song.title),
      isNew(song.modified) ? h('span', { class: 'badge' }, 'новое') : null,
      owner ? h('span', { class: 'owner' }, student.name) : null),
    song.variants.length
      ? h('div', { class: 'variants' }, song.variants.map(v =>
        h('button', {
          class: `chip ${v.kind}`, 'data-id': `${student.id}|${v.file.name}`,
          onclick: () => player.play(song, v, student),
        }, variantName(v))))
      : h('p', { class: 'muted' }, 'Нет аудио — добавьте вариант в «Изменить».'),
    links, lyricsBox, editBox);
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
function lyricsEditorBox() {
  const area = h('div', {
    class: 'field lyrics-edit', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true',
    'aria-label': 'Текст песни', 'data-placeholder': 'Вставьте сюда текст песни…',
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

  const isDirty = () => titleInput.value.trim() !== song.title || lyricsChanged() || rows.some(rowChanged) || pending.length > 0;
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
    if (!isDirty()) return close();

    const titleChanged = newTitle !== song.title;
    saveBtn.disabled = cancelBtn.disabled = true;
    const step = text => { status.textContent = text; };
    let failed = false;
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
      // 4. Загрузить новые файлы.
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
          mutate(() => call('copyTo', { folder, to: sel.value, names: songFiles(song) }), `Скопировано: ${to.name}`);
        },
      }, 'Скопировать')));
  }
  if (!isNew) {
    extra.push(h('div', { class: 'row' }, h('button', {
      class: 'btn small danger', type: 'button', onclick: () => {
        if (!confirm(`Удалить песню «${song.title}» целиком (все варианты и текст)? Файлы уйдут в корзину Яндекс Диска.`)) return;
        dirtyEditors.delete(isDirty);
        openEditor = null;
        mutate(async () => { for (const name of songFiles(song)) await call('delete', { folder, name }); }, 'Песня удалена');
      },
    }, 'Удалить песню целиком')));
  }

  return h('div', { class: `editor-inner${isNew ? ' card' : ''}` },
    isNew ? h('h3', { class: 'editor-title' }, 'Новая песня') : null,
    h('div', { class: 'edit-section' }, h('h3', {}, 'Название'), titleInput),
    h('div', { class: 'edit-section' }, h('h3', {}, 'Текст песни'), lyricsEditor.el),
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
  const bar = document.getElementById('player');
  const $ = sel => bar.querySelector(sel);
  const title = $('.p-title'), sub = $('.p-sub'), playBtn = $('.p-play'),
    seek = $('.p-seek'), cur = $('.p-cur'), dur = $('.p-dur'),
    loopBtn = $('.p-loop'), speed = $('.p-speed'), dl = $('.p-dl');
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
    current = { id };
    bar.hidden = false;
    document.body.classList.add('has-player');
    title.textContent = song.title;
    sub.textContent = variantName(v);
    bar.classList.add('busy');
    markActive();
    try {
      const url = await fileUrl(student.id, v.file.name);
      if (my !== token) return;
      const wasRate = audio.playbackRate;
      audio.src = url;
      audio.playbackRate = wasRate;
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
    current = null;
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

  return { play };
})();

route();
