import { loadLibrary, fileUrl, fileText } from './disk.js';
import { groupSongs, variantName, songKey } from './parse.js';
import { PUBLIC_FOLDER, NEW_DAYS, NEW_SINCE } from './config.js';

const main = document.getElementById('main');
let library = null;      // [{id, name, songs}]
let loading = null;

// ---------- Маленький помощник для создания элементов ----------
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
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

// ---------- Загрузка ----------
async function ensureLibrary(force = false) {
  if (library && !force) return library;
  if (!loading || force) {
    loading = loadLibrary().then(dirs => {
      library = dirs
        .map(d => ({ id: d.id, name: d.name, songs: groupSongs(d.files) }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
      return library;
    }).finally(() => { loading = null; });
  }
  return loading;
}

function showLoading() {
  main.replaceChildren(h('div', { class: 'state' }, h('div', { class: 'spinner' }), 'Загружаю песни с Яндекс Диска…'));
}

function showError(err) {
  main.replaceChildren(h('div', { class: 'state' },
    h('p', {}, 'Не получилось загрузить песни.'),
    h('p', { class: 'muted' }, String(err.message || err)),
    h('button', { class: 'btn', onclick: () => route(true) }, 'Попробовать снова')));
}

// ---------- Маршруты ----------
async function route(force = false) {
  const hash = location.hash.replace(/^#\/?/, '');
  if (!hash) return renderLanding();
  showLoading();
  try { await ensureLibrary(force); } catch (e) { return showError(e); }
  if (hash === 'all') return renderTeacher();
  const m = hash.match(/^s\/([0-9a-f]+)/);
  const student = m && library.find(s => s.id === m[1]);
  if (student) return renderStudent(student);
  main.replaceChildren(h('div', { class: 'state' },
    h('p', {}, 'Такой странички нет.'),
    h('p', { class: 'muted' }, 'Возможно, ссылка скопировалась не полностью — попросите новую у преподавателя.')));
}

window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });

// ---------- Стартовая страница ----------
function renderLanding() {
  document.title = 'Песни учеников';
  main.replaceChildren(h('div', { class: 'state landing' },
    h('div', { class: 'landing-mark', 'aria-hidden': 'true' }, '♪'),
    h('h1', {}, 'Песни учеников'),
    h('p', { class: 'muted' }, 'Откройте свою личную ссылку, которую прислал преподаватель.')));
}

// ---------- Страница преподавателя ----------
function renderTeacher() {
  document.title = 'Все ученики — Песни';
  const results = h('div', { class: 'results' });
  const grid = h('div', { class: 'students' }, library.map(studentCard));

  const search = h('input', {
    type: 'search', class: 'search', placeholder: 'Найти песню у всех учеников…',
    oninput: () => {
      const q = songKey(search.value);
      grid.hidden = !!q;
      results.replaceChildren();
      if (!q) return;
      const found = [];
      for (const s of library) for (const song of s.songs)
        if (song.key.includes(q)) found.push({ s, song });
      results.replaceChildren(found.length
        ? h('div', { class: 'songs' }, found.map(({ s, song }) => songCard(song, s.name)))
        : h('p', { class: 'muted' }, 'Ничего не нашлось.'));
    },
  });

  const total = library.reduce((n, s) => n + s.songs.length, 0);
  main.replaceChildren(
    h('header', { class: 'page-head' },
      h('div', {},
        h('p', { class: 'eyebrow' }, 'Страница преподавателя'),
        h('h1', {}, 'Ученики'),
        h('p', { class: 'muted' }, `${plural(library.length, 'страничка', 'странички', 'страничек')} · ${plural(total, 'песня', 'песни', 'песен')}`)),
      h('div', { class: 'head-actions' },
        h('a', { class: 'btn ghost', href: PUBLIC_FOLDER, target: '_blank', rel: 'noopener' }, 'Папка на Диске'),
        h('button', { class: 'btn ghost', onclick: () => route(true) }, 'Обновить'))),
    search, results, grid);
}

function studentLink(s) {
  return `${location.origin}${location.pathname}#/s/${s.id}`;
}

function studentCard(s) {
  const copyBtn = h('button', {
    class: 'btn small',
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(studentLink(s));
        copyBtn.textContent = 'Скопировано ✓';
      } catch {
        prompt('Скопируйте ссылку:', studentLink(s));
      }
      setTimeout(() => { copyBtn.textContent = 'Скопировать ссылку'; }, 1800);
    },
  }, 'Скопировать ссылку');
  const fresh = s.songs.filter(x => isNew(x.modified)).length;
  return h('article', { class: 'student' },
    h('a', { class: 'student-name', href: `#/s/${s.id}` }, s.name),
    h('p', { class: 'muted' }, plural(s.songs.length, 'песня', 'песни', 'песен'),
      fresh ? h('span', { class: 'badge' }, `новых: ${fresh}`) : null),
    h('div', { class: 'student-actions' },
      h('a', { class: 'btn small primary', href: `#/s/${s.id}` }, 'Открыть'), copyBtn));
}

// ---------- Страница ученика ----------
let sortMode = localGet('sort') || 'name';

function localGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localSet(k, v) { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } }

function renderStudent(student) {
  document.title = `${student.name} — Песни`;
  const list = h('div', { class: 'songs' });

  const draw = () => {
    const q = songKey(search.value);
    let songs = student.songs.filter(s => !q || s.key.includes(q));
    songs = [...songs].sort(sortMode === 'new'
      ? (a, b) => b.modified.localeCompare(a.modified)
      : (a, b) => a.title.localeCompare(b.title, 'ru'));
    list.replaceChildren(...(songs.length
      ? songs.map(s => songCard(s))
      : [h('p', { class: 'muted' }, q ? 'Ничего не нашлось.' : 'Здесь пока нет песен.')]));
  };

  const search = h('input', { type: 'search', class: 'search', placeholder: 'Поиск по песням…', oninput: draw });
  const sort = h('select', {
    class: 'sort', 'aria-label': 'Сортировка',
    onchange: () => { sortMode = sort.value; localSet('sort', sortMode); draw(); },
  },
    h('option', { value: 'name', selected: sortMode === 'name' }, 'По алфавиту'),
    h('option', { value: 'new', selected: sortMode === 'new' }, 'Сначала новые'));

  main.replaceChildren(
    h('header', { class: 'page-head' },
      h('div', {},
        h('h1', {}, student.name),
        h('p', { class: 'muted' }, plural(student.songs.length, 'песня', 'песни', 'песен')))),
    h('div', { class: 'toolbar' }, search, sort),
    list);
  draw();
}

function songCard(song, owner) {
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
          lyricsBox.textContent = await fileText(song.lyrics.path);
          lyricsLoaded = true;
        } catch (e) { lyricsBox.textContent = e.message; }
      }
    },
  }, 'Текст песни');

  return h('article', { class: 'song', 'data-key': song.key },
    h('div', { class: 'song-head' },
      h('h2', {}, song.title),
      isNew(song.modified) ? h('span', { class: 'badge' }, 'новое') : null,
      owner ? h('span', { class: 'owner' }, owner) : null),
    h('div', { class: 'variants' }, song.variants.map(v =>
      h('button', {
        class: `chip ${v.kind}`, 'data-path': v.file.path,
        onclick: () => player.play(song, v),
      }, variantName(v)))),
    lyricsBtn || null,
    lyricsBox);
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
      if (c.dataset.path === current.v.file.path) c.classList.add('active');
    });
  }

  async function play(song, v) {
    if (current && current.v.file.path === v.file.path) {
      return audio.paused ? audio.play() : audio.pause();
    }
    const my = ++token;
    current = { song, v };
    bar.hidden = false;
    document.body.classList.add('has-player');
    title.textContent = song.title;
    sub.textContent = variantName(v);
    bar.classList.add('busy');
    markActive();
    try {
      const url = await fileUrl(v.file.path);
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
      if (my === token && e.name !== 'AbortError') sub.textContent = 'Не удалось запустить: ' + e.message;
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
    playBtn.classList.remove('playing');
    bar.classList.remove('busy');
  });
  audio.addEventListener('waiting', () => bar.classList.add('busy'));
  audio.addEventListener('playing', () => bar.classList.remove('busy'));

  // Пробел — пауза/продолжить, если не печатаем в поле.
  document.addEventListener('keydown', e => {
    if (e.code !== 'Space' || !current || e.target.closest('input, select, textarea, button')) return;
    e.preventDefault();
    audio.paused ? audio.play() : audio.pause();
  });

  // После перерисовки страницы подсветить играющий вариант.
  new MutationObserver(markActive).observe(main, { childList: true, subtree: true });

  return { play };
})();

route();
