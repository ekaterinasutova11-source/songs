// Оформление текстов песен.
// В .txt на Диске хранится простая разметка, которую можно читать и без сайта:
//   **жирный** *курсив* __подчёркнутый__ ==маркер== [red]цвет[/red]
//   [color=#1a2b3c]цвет букв[/color] [mark=#ffeedd]цветной маркер[/mark]
// Знак \ перед символом отменяет его особое значение.

export const COLORS = {
  red: { name: 'Красный', hex: '#c62828' },
  blue: { name: 'Синий', hex: '#1565c0' },
  green: { name: 'Зелёный', hex: '#2e7d32' },
  purple: { name: 'Фиолетовый', hex: '#7b1fa2' },
};
const COLOR_NAMES = Object.keys(COLORS).join('|');
const TOKEN = new RegExp(String.raw`\\([\s\S])|\*\*|\*|__|==|\[(\/?)(${COLOR_NAMES}|color(?:=#[\da-fA-F]{6})?|mark(?:=#[\da-fA-F]{6})?)\]|[^\\*_=\[]+|[\s\S]`, 'g');

// The stored format and emitted HTML only allow an opaque RGB hex color.
// CSS functions/variables, alpha, URLs and arbitrary style strings never pass.
export function normalizeColor(value) {
  const text = String(value || '').trim();
  const hex = text.match(/^#?([\da-f]{6}|[\da-f]{3})$/i);
  if (hex) return '#' + (hex[1].length === 3 ? [...hex[1]].map(c => c + c).join('') : hex[1]).toLowerCase();
  const rgb = text.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(1|1\.0))?\s*\)$/i);
  if (!rgb || (text.toLowerCase().startsWith('rgba') && rgb[4] == null)) return null;
  const values = rgb.slice(1, 4).map(Number);
  return values.every(n => n <= 255) ? '#' + values.map(n => n.toString(16).padStart(2, '0')).join('') : null;
}

const escHtml = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Разметка → куски текста со стилями.
export function parseLyrics(markup) {
  const runs = [];
  const st = { b: false, i: false, u: false, m: false, c: null, h: null };
  const colors = [], highlights = [];
  const push = text => {
    const last = runs[runs.length - 1];
    if (last && sameStyle(last.s, st)) last.text += text;
    else runs.push({ text, s: { ...st } });
  };
  const tokens = [...markup.matchAll(TOKEN)];
  const KEY = { '**': 'b', '*': 'i', '__': 'u', '==': 'm' };
  const charBefore = k => markup[tokens[k].index - 1] || ' ';
  const charAfter = k => markup[tokens[k].index + tokens[k][0].length] || ' ';
  // Открывающий значок должен стоять вплотную к слову справа, закрывающий — слева,
  // и у открывающего должна найтись пара. Иначе это просто символ в тексте («2*3», «* * *»).
  const canClose = k => !/\s/.test(charBefore(k));
  const canOpen = k => {
    if (/\s/.test(charAfter(k))) return false;
    for (let j = k + 1; j < tokens.length; j++) if (tokens[j][0] === tokens[k][0] && canClose(j)) return true;
    return false;
  };
  tokens.forEach((m, k) => {
    const t = m[0];
    const key = KEY[t];
    if (m[1] !== undefined) push(m[1]);
    else if (key && st[key] && canClose(k)) st[key] = false;
    else if (key && !st[key] && canOpen(k)) st[key] = true;
    else if (m[3] && !m[2] && (COLORS[m[3]] || m[3].startsWith('color='))) {
      colors.push({tag: COLORS[m[3]] ? m[3] : 'color', value: st.c});
      st.c = COLORS[m[3]] ? m[3] : m[3].slice(6).toLowerCase();
    } else if (m[3] && m[2] && colors.at(-1)?.tag === m[3]) st.c = colors.pop().value;
    else if (m[3]?.startsWith('mark=') && !m[2]) { highlights.push(st.h); st.h = m[3].slice(5).toLowerCase(); }
    else if (m[3] === 'mark' && m[2] && highlights.length) st.h = highlights.pop();
    else push(t);
  });
  return runs;
}

const sameStyle = (a, b) => a.b === b.b && a.i === b.i && a.u === b.u && a.m === b.m && a.c === b.c && a.h === b.h;

// Разметка → HTML для показа (текст экранирован, теги только наши).
export function renderLyrics(markup, { forEditor = false } = {}) {
  return renderRuns(parseLyrics(markup), forEditor);
}

function renderRuns(runs, forEditor = false) {
  return runs.map(({ text, s }) => {
    let html = escHtml(text);
    if (forEditor) html = html.replace(/\n/g, '<br>');
    if (s.i) html = `<i>${html}</i>`;
    if (s.b) html = `<b>${html}</b>`;
    if (s.u) html = `<u>${html}</u>`;
    if (s.h) html = `<mark style="background-color:${s.h};color:inherit">${html}</mark>`;
    else if (s.m) html = `<mark>${html}</mark>`;
    if (s.c) html = forEditor
      ? `<font color="${COLORS[s.c]?.hex || s.c}">${html}</font>`
      : COLORS[s.c] ? `<span class="c-${s.c}">${html}</span>` : `<span style="color:${s.c}">${html}</span>`;
    return html;
  }).join('');
}

// Split parsed runs, not markup: styles spanning a newline keep their state.
export function renderedLyricLines(markup) {
  const lines = [[]];
  for (const run of parseLyrics(markup)) {
    run.text.split('\n').forEach((text, index) => {
      if (index) lines.push([]);
      if (text) lines.at(-1).push({text: text.replace(/\r$/, ''), s: run.s});
    });
  }
  return lines.map(line => renderRuns(line));
}

export function parseTimecode(value) {
  const match = String(value).trim().match(/^(?:(\d{1,2}):)?(\d{1,3}):(\d{2})(?:[.,](\d{1,3}))?$/);
  if (!match || Number(match[3]) >= 60 || (match[1] != null && Number(match[2]) >= 60)) return null;
  const seconds = Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(`0.${match[4] || 0}`);
  return seconds <= 86400 ? seconds : null;
}

export function formatTimecode(seconds) {
  const millis = Math.max(0, Math.round(seconds * 1000));
  const minutes = Math.floor(millis / 60000);
  const remainder = (millis % 60000 / 1000).toFixed(3).padStart(6, '0');
  return `${minutes}:${remainder}`.replace(/\.000$/, '');
}

export function validateTimings(timings, song, text) {
  const invalid = {valid: false, track: null, lines: [], reason: timings ? 'Текст или запись изменены. Настройте таймкоды заново.' : null};
  if (!timings || timings.version !== 1 || !Array.isArray(timings.lines) || !song.lyrics) return invalid;
  const track = song.variants.find(v => v.kind === 'minus' && v.file.name === timings.track &&
    v.file.size === timings.trackSize && v.file.modified === timings.trackModified);
  if (!track || timings.lyrics !== song.lyrics.name || timings.lyricsModified !== song.lyrics.modified) return invalid;
  const rawLines = text.replace(/^\uFEFF/, '').split(/\r?\n/), seen = new Set();
  for (const line of timings.lines) {
    if (!Number.isInteger(line.line) || line.line < 0 || line.line >= rawLines.length || seen.has(line.line) ||
        rawLines[line.line] !== line.text || !Number.isFinite(line.seconds) || line.seconds < 0 || line.seconds > 86400) return invalid;
    seen.add(line.line);
  }
  return {valid: true, track, lines: timings.lines, reason: null};
}

// ---------- Редактор → разметка ----------
function colorName(el) {
  const cls = [...el.classList || []].find(c => c.startsWith('c-'));
  if (cls && COLORS[cls.slice(2)]) return cls.slice(2);
  const raw = el.getAttribute?.('color') || el.style?.color;
  if (!raw) return undefined;
  if (raw === 'inherit') return undefined;
  const norm = normalizeColor(raw);
  for (const [name, { hex }] of Object.entries(COLORS)) {
    if (hex === norm) return name;
  }
  return norm;
}

function styleOf(el, parent) {
  const s = { ...parent };
  const tag = el.tagName;
  const fw = el.style?.fontWeight;
  if (tag === 'B' || tag === 'STRONG' || fw === 'bold' || Number(fw) >= 600) s.b = true;
  if (fw === 'normal' || (fw && Number(fw) < 600)) s.b = false;
  if (tag === 'I' || tag === 'EM' || el.style?.fontStyle === 'italic') s.i = true;
  if (el.style?.fontStyle === 'normal') s.i = false;
  if (tag === 'U' || /underline/.test(el.style?.textDecoration || el.style?.textDecorationLine || '')) s.u = true;
  const bg = el.style?.backgroundColor;
  if (el.tagName === 'MARK' && !bg) { s.m = true; s.h = null; }
  else if (bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') { s.m = false; s.h = null; }
  else if (normalizeColor(bg)) { s.m = false; s.h = normalizeColor(bg); }
  const c = colorName(el);
  if (c !== undefined) s.c = c;
  return s;
}

const BLOCKS = new Set(['DIV', 'P', 'LI', 'H1', 'H2', 'H3', 'BLOCKQUOTE']);

function collect(node, s, runs) {
  const lastText = () => runs.length ? runs[runs.length - 1].text : '';
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      runs.push({ text: child.data.replace(/ /g, ' '), s });
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      if (child.tagName === 'BR') { runs.push({ text: '\n', s }); continue; }
      if (BLOCKS.has(child.tagName) && runs.length && !lastText().endsWith('\n')) runs.push({ text: '\n', s });
      collect(child, styleOf(child, s), runs);
    }
  }
  return runs;
}

const escMarkup = text => text
  .replace(/\\/g, '\\\\')
  .replace(/\*/g, '\\*')
  .replace(/_(?=_)/g, '\\_')
  .replace(/=(?==)/g, '\\=')
  .replace(/\[/g, '\\[');

export function editorToMarkup(root) {
  const runs = collect(root, { b: false, i: false, u: false, m: false, c: null, h: null }, []);
  // Склеиваем соседние куски с одинаковым оформлением.
  const merged = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && sameStyle(last.s, r.s)) last.text += r.text;
    else if (r.text) merged.push({ ...r });
  }
  return merged.map(({ text, s }) => {
    // Переносы строк и пробелы по краям оставляем снаружи оформления.
    const [, lead, core, trail] = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
    if (!core) return text;
    let open = '', close = '';
    if (s.c) { open += COLORS[s.c] ? `[${s.c}]` : `[color=${s.c}]`; close = `[/${COLORS[s.c] ? s.c : 'color'}]` + close; }
    if (s.h) { open += `[mark=${s.h}]`; close = '[/mark]' + close; }
    else if (s.m) { open += '=='; close = '==' + close; }
    if (s.u) { open += '__'; close = '__' + close; }
    if (s.b) { open += '**'; close = '**' + close; }
    if (s.i) { open += '*'; close = '*' + close; }
    return lead + open + escMarkup(core) + close + trail;
  }).join('').replace(/\n+$/, '\n').replace(/^\n+/, '');
}
