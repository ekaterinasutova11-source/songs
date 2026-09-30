import { call, setKey, fileUrl, fileText, uploadFile } from './api.js';
import { groupSongs, variantName, songKey, buildFileName, retitleFileName, AUDIO_EXT } from './parse.js';
import { NEW_DAYS, NEW_SINCE } from './config.js';

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

  main.replaceChildren(
    teacherTools || null,
    h('header', { class: 'page-head' },
      h('div', {},
        h('h1', {}, student.name),
        h('p', { class: 'muted' }, plural(student.songs.length, 'песня', 'песни', 'песен'))),
      h('div', { class: 'head-actions' }, addBtn)),
    addBox,
    h('div', { class: 'toolbar' }, search, sort),
    list);
  draw();
}

// ---------- Карточка песни ----------
function songCard(song, student, { owner = false } = {}) {
  const lyricsBox = h('div', { class: 'lyrics', hidden: true });
  let lyricsLoaded = false;
  const lyricsBtn = song.lyrics && h('button', {
    class: 'link-btn', 'aria-expanded': 'false',
    onclick: async () => {
      const open = lyricsBox.hidden;
      lyricsBox.hidden = !open;
      lyricsBtn.setAttribute('aria-expanded', String(open));
      lyricsBtn.textContent = open ? 'Скрыть текст' : 'Текст песни';
      if (open && !lyricsLoaded) {
        lyricsBox.textContent = 'Загружаю…';
        try {
          lyricsBox.textContent = await fileText(student.id, song.lyrics.name);
          lyricsLoaded = true;
        } catch (e) { lyricsBox.textContent = e.message; }
      }
    },
  }, 'Текст песни');

  const editorKey = `${student.id}|${song.key}`;
  const editBox = h('div', { class: 'editor', hidden: openEditor !== editorKey });
  const editBtn = h('button', {
    class: 'link-btn', onclick: () => {
      const open = editBox.hidden;
      editBox.hidden = !open;
      openEditor = open ? editorKey : null;
      if (open) editBox.replaceChildren(songEditor(song, student));
    },
  }, 'Изменить');
  if (!editBox.hidden) editBox.replaceChildren(songEditor(song, student));

  return h('article', { class: 'song' },
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
    h('div', { class: 'song-links' }, lyricsBtn || null, editBtn),
    lyricsBox, editBox);
}

// Все файлы песни (аудио + текст) — для переименования, копирования и удаления.
const songFiles = song => [...song.variants.map(v => v.file.name), ...(song.lyrics ? [song.lyrics.name] : [])];

function songEditor(song, student) {
  const isTeacher = role === 'teacher';

  // Название
  const titleInput = h('input', { class: 'field', value: song.title, 'aria-label': 'Название песни' });
  const saveTitle = () => {
    const newTitle = titleInput.value.trim();
    if (!newTitle || newTitle === song.title) return;
    openEditor = `${student.id}|${songKey(newTitle)}`;
    mutate(async () => {
      for (const name of songFiles(song)) {
        const newName = retitleFileName(name, newTitle);
        if (newName !== name) await call('rename', { folder: student.id, name, newName });
      }
    }, 'Название изменено');
  };

  // Текст
  const lyricsArea = h('textarea', { class: 'field lyrics-edit', rows: 8, placeholder: 'Вставьте сюда текст песни…' });
  if (song.lyrics) {
    lyricsArea.value = 'Загружаю…';
    lyricsArea.disabled = true;
    fileText(student.id, song.lyrics.name)
      .then(t => { lyricsArea.value = t; })
      .catch(e => { lyricsArea.value = ''; toast(e.message, 'error'); })
      .finally(() => { lyricsArea.disabled = false; });
  }
  const saveLyrics = () => mutate(
    () => call('saveText', { folder: student.id, name: song.lyrics?.name || `${song.title}.txt`, text: lyricsArea.value }),
    'Текст сохранён');

  // Варианты
  const variantRows = song.variants.map(v => h('li', { class: 'variant-row' },
    h('span', { class: `dot ${v.kind}` }), h('span', { class: 'variant-name' }, variantName(v)),
    h('span', { class: 'muted small' }, v.file.name),
    h('button', {
      class: 'btn small ghost', onclick: () => {
        const label = prompt('Пометка варианта (например: медленный, ниже, короткий). Пусто — без пометки:', v.label);
        if (label === null) return;
        const newName = buildFileName(v.title, v.kind, label, extOf(v.file.name));
        if (newName !== v.file.name) mutate(() => call('rename', { folder: student.id, name: v.file.name, newName }), 'Переименовано');
      },
    }, 'Пометка'),
    h('button', {
      class: 'btn small ghost danger', onclick: () => {
        if (confirm(`Удалить «${variantName(v)}»? Файл уйдёт в корзину Яндекс Диска.`))
          mutate(() => call('delete', { folder: student.id, name: v.file.name }), 'Удалено');
      },
    }, 'Удалить')));

  // Копирование другому ученику
  let copyBlock = null;
  if (isTeacher) {
    const others = library.filter(s => s.id !== student.id);
    const sel = h('select', { class: 'field' }, others.map(s => h('option', { value: s.id }, s.name)));
    copyBlock = h('div', { class: 'edit-section' },
      h('h3', {}, 'Дать эту песню другому ученику'),
      h('div', { class: 'row' }, sel,
        h('button', {
          class: 'btn small', onclick: () => {
            const to = others.find(s => s.id === sel.value);
            mutate(() => call('copyTo', { folder: student.id, to: sel.value, names: songFiles(song) }), `Скопировано: ${to.name}`);
          },
        }, 'Скопировать')));
  }

  return h('div', { class: 'editor-inner' },
    h('div', { class: 'edit-section' },
      h('h3', {}, 'Название'),
      h('div', { class: 'row' }, titleInput, h('button', { class: 'btn small', onclick: saveTitle }, 'Сохранить'))),
    h('div', { class: 'edit-section' },
      h('h3', {}, 'Текст песни'),
      lyricsArea,
      h('div', { class: 'row end' }, h('button', { class: 'btn small primary', onclick: saveLyrics }, 'Сохранить текст'))),
    h('div', { class: 'edit-section' },
      h('h3', {}, 'Аудио'),
      variantRows.length ? h('ul', { class: 'variant-list' }, variantRows) : null,
      uploadRow(student, song.title)),
    copyBlock,
    h('div', { class: 'edit-section' },
      h('button', {
        class: 'btn small danger', onclick: () => {
          if (confirm(`Удалить песню «${song.title}» целиком (все варианты и текст)? Файлы уйдут в корзину Яндекс Диска.`))
            mutate(async () => {
              for (const name of songFiles(song)) await call('delete', { folder: student.id, name });
            }, 'Песня удалена');
        },
      }, 'Удалить песню')));
}

// Строка «добавить аудио»: тип, пометка, файл.
function uploadRow(student, title, { onDone } = {}) {
  const kind = h('select', { class: 'field', 'aria-label': 'Тип' },
    h('option', { value: 'minus' }, 'Минус'),
    h('option', { value: 'plus' }, 'Плюс'),
    h('option', { value: 'orig' }, 'Оригинал'));
  const label = h('input', { class: 'field', placeholder: 'Пометка: медленный, ниже…', 'aria-label': 'Пометка' });
  const file = h('input', { type: 'file', accept: 'audio/*,.mp3,.wav,.m4a,.ogg,.flac', class: 'file-input' });
  const progress = h('div', { class: 'progress', hidden: true }, h('div', { class: 'progress-bar' }));
  const btn = h('button', {
    class: 'btn small primary', onclick: async () => {
      const t = typeof title === 'function' ? title() : title;
      const f = file.files[0];
      if (!t) return toast('Сначала напишите название песни', 'error');
      if (!f) return toast('Выберите аудиофайл', 'error');
      if (!AUDIO_EXT.test(f.name)) return toast('Это не похоже на аудиофайл (нужен mp3, wav, m4a…)', 'error');
      const name = buildFileName(t, kind.value, label.value, extOf(f.name));
      btn.disabled = true;
      progress.hidden = false;
      try {
        await uploadFile(student.id, name, f, p => progress.firstChild.style.width = `${Math.round(p * 100)}%`);
        onDone?.();
        await mutate(async () => {}, `Загружено: ${name}`);
      } catch (e) {
        toast(e.status === 409 ? 'Такой вариант уже есть — поставьте другую пометку' : e.message, 'error');
        btn.disabled = false;
        progress.hidden = true;
      }
    },
  }, 'Загрузить');
  return h('div', { class: 'upload' },
    h('div', { class: 'row' }, kind, label),
    h('div', { class: 'row' }, file, btn),
    progress);
}

function addSongForm(student, close) {
  const title = h('input', { class: 'field', placeholder: 'Название песни', 'aria-label': 'Название песни' });
  return h('div', { class: 'editor-inner card' },
    h('h3', {}, 'Новая песня'),
    title,
    h('p', { class: 'muted small' }, 'Загрузите первый вариант — остальные варианты и текст можно добавить потом через «Изменить».'),
    uploadRow(student, () => {
      const t = title.value.trim();
      if (t) openEditor = `${student.id}|${songKey(t)}`;
      return t;
    }, { onDone: close }),
    h('div', { class: 'row end' }, h('button', { class: 'btn small ghost', onclick: close }, 'Отмена')));
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
