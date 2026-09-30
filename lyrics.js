// Оформление текстов песен.
// В .txt на Диске хранится простая разметка, которую можно читать и без сайта:
//   **жирный**   *курсив*   __подчёркнутый__   ==маркер==   [red]цвет[/red]
// Знак \ перед символом отменяет его особое значение.

export const COLORS = {
  red: { name: 'Красный', hex: '#c62828' },
  blue: { name: 'Синий', hex: '#1565c0' },
  green: { name: 'Зелёный', hex: '#2e7d32' },
  purple: { name: 'Фиолетовый', hex: '#7b1fa2' },
};
const COLOR_NAMES = Object.keys(COLORS).join('|');
const TOKEN = new RegExp(String.raw`\\([\s\S])|\*\*|\*|__|==|\[(\/?)(${COLOR_NAMES})\]|[^\\*_=\[]+|[\s\S]`, 'g');

const escHtml = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Разметка → куски текста со стилями.
function parse(markup) {
  const runs = [];
  const st = { b: false, i: false, u: false, m: false, c: null };
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
    else if (m[3] && !m[2]) st.c = m[3];
    else if (m[3] && m[2] && st.c === m[3]) st.c = null;
    else push(t);
  });
  return runs;
}

const sameStyle = (a, b) => a.b === b.b && a.i === b.i && a.u === b.u && a.m === b.m && a.c === b.c;

// Разметка → HTML для показа (текст экранирован, теги только наши).
export function renderLyrics(markup, { forEditor = false } = {}) {
  return parse(markup).map(({ text, s }) => {
    let html = escHtml(text);
    if (forEditor) html = html.replace(/\n/g, '<br>');
    if (s.i) html = `<i>${html}</i>`;
    if (s.b) html = `<b>${html}</b>`;
    if (s.u) html = `<u>${html}</u>`;
    if (s.m) html = `<mark>${html}</mark>`;
    if (s.c) html = forEditor
      ? `<font color="${COLORS[s.c].hex}">${html}</font>`
      : `<span class="c-${s.c}">${html}</span>`;
    return html;
  }).join('');
}

// ---------- Редактор → разметка ----------
function colorName(el) {
  const cls = [...el.classList || []].find(c => c.startsWith('c-'));
  if (cls && COLORS[cls.slice(2)]) return cls.slice(2);
  const raw = el.getAttribute?.('color') || el.style?.color;
  if (!raw) return undefined;
  const probe = document.createElement('span');
  probe.style.color = raw;
  const norm = probe.style.color;
  for (const [name, { hex }] of Object.entries(COLORS)) {
    probe.style.color = hex;
    if (probe.style.color === norm) return name;
  }
  return null; // чужой цвет — убираем
}

function isMark(el) {
  if (el.tagName === 'MARK') return true;
  const bg = el.style?.backgroundColor;
  return bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'initial' && bg !== 'inherit';
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
  if (isMark(el)) s.m = true;
  else if (el.style?.backgroundColor === 'transparent') s.m = false;
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
  .replace(new RegExp(String.raw`\[(?=\/?(${COLOR_NAMES})\])`, 'g'), '\\[');

export function editorToMarkup(root) {
  const runs = collect(root, { b: false, i: false, u: false, m: false, c: null }, []);
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
    if (s.c) { open += `[${s.c}]`; close = `[/${s.c}]` + close; }
    if (s.m) { open += '=='; close = '==' + close; }
    if (s.u) { open += '__'; close = '__' + close; }
    if (s.b) { open += '**'; close = '**' + close; }
    if (s.i) { open += '*'; close = '*' + close; }
    return lead + open + escMarkup(core) + close + trail;
  }).join('').replace(/\n+$/, '\n').replace(/^\n+/, '');
}
