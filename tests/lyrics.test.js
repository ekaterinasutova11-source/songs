import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {normalizeColor, parseLyrics, renderLyrics, editorToMarkup, renderedLyricLines, validateTimings, parseTimecode, formatTimecode} from '../lyrics.js';

test('all historical website TXT fixtures preserve their rendering', () => {
  const fixtures = JSON.parse(fs.readFileSync(new URL('../mobile/test/fixtures/lyrics_web.json', import.meta.url)));
  for (const item of fixtures) assert.equal(renderLyrics(item.input), item.html, item.input);
});

test('HEX and RGB accept opaque colors only and normalize before serialization', () => {
  assert.equal(normalizeColor('#AbC'), '#aabbcc');
  assert.equal(normalizeColor('123456'), '#123456');
  assert.equal(normalizeColor('rgb(255, 0, 17)'), '#ff0011');
  assert.equal(normalizeColor('rgba(1,2,3,1)'), '#010203');
  for (const input of ['rgb(256,0,0)', 'rgba(1,2,3,.5)', 'url(javascript:1)', 'red;position:fixed', '#12345z', 'transparent', 'var(--x)']) {
    assert.equal(normalizeColor(input), null);
  }
});

test('letter and marker colors are independent, nested values restore separately', () => {
  const input = '[color=#123456]a[mark=#FFEEDD]b[color=#AABBCC]c[/color]d[/mark]e[/color]f';
  const runs = parseLyrics(input);
  assert.deepEqual(runs.map(r => [r.text,r.s.c,r.s.h]), [
    ['a','#123456',null], ['b','#123456','#ffeedd'], ['c','#aabbcc','#ffeedd'],
    ['d','#123456','#ffeedd'], ['e','#123456',null], ['f',null,null],
  ]);
  assert.equal(renderLyrics('[color=#123456][mark=#abcdef]слово[/mark][/color]'),
    '<span style="color:#123456"><mark style="background-color:#abcdef;color:inherit">слово</mark></span>');
});

test('arbitrary CSS and HTML are displayed literally, never injected', () => {
  const input = '[color=red;position:fixed]x[/color] [mark=url(x)]y[/mark] <img src=x onerror="x">';
  const html = renderLyrics(input);
  assert.equal(html.includes('<img'), false);
  assert.equal(html.includes('style='), false);
  assert.equal(parseLyrics('\\[color=#112233]буквально').map(r => r.text).join(''), '[color=#112233]буквально');
});

const text = data => ({nodeType: 3, data});
const el = (tagName, children, style = {}, attrs = {}) => ({
  nodeType: 1, tagName, childNodes: children, style, classList: [], getAttribute: key => attrs[key],
});

test('editor round trip keeps simultaneous foreground/background and escapes typed markup', () => {
  const previous = globalThis.Node;
  globalThis.Node = {TEXT_NODE:3, ELEMENT_NODE:1};
  try {
    const root = el('DIV', [el('FONT', [el('MARK', [el('B', [text('слово')])],
      {backgroundColor:'rgb(171, 205, 239)',color:'inherit'})], {}, {color:'#123456'})]);
    const markup = editorToMarkup(root);
    assert.equal(markup, '[color=#123456][mark=#abcdef]**слово**[/mark][/color]');
    const [run] = parseLyrics(markup);
    assert.equal(run.s.c, '#123456'); assert.equal(run.s.h, '#abcdef'); assert.equal(run.s.b, true);
    assert.equal(editorToMarkup(el('DIV', [text('[color=#112233]текст[/color]')])), '\\[color=#112233]текст\\[/color]');
  } finally { globalThis.Node = previous; }
});

test('removing only marker leaves letter color and bold intact', () => {
  const previous = globalThis.Node;
  globalThis.Node = {TEXT_NODE:3, ELEMENT_NODE:1};
  try {
    const root = el('DIV', [el('FONT', [el('B', [el('SPAN', [text('цвет')], {backgroundColor:'transparent'})])], {}, {color:'#123456'})]);
    assert.equal(editorToMarkup(root), '[color=#123456]**цвет**[/color]');
  } finally { globalThis.Node = previous; }
});

test('timecodes validate against exact lyric lines and the selected minus revision', () => {
  const song = {lyrics:{name:'Song.txt',modified:'text-v1'}, variants:[{kind:'minus',file:{name:'Song -.mp3',size:123,modified:'audio-v1'}}]};
  const value = {version:1, track:'Song -.mp3',trackSize:123,trackModified:'audio-v1',lyrics:'Song.txt',lyricsModified:'text-v1',lines:[{line:1,seconds:153.125,text:'**Вторая**'}]};
  const text = '\uFEFFПервая\r\n**Вторая**';
  assert.equal(validateTimings(value,song,text).valid,true);
  assert.equal(validateTimings({...value,trackModified:'audio-v0'},song,text).valid,false);
  assert.equal(validateTimings({...value,lyricsModified:'text-v0'},song,text).valid,false);
  assert.equal(validateTimings(value,song,'Первая\nВторая').valid,false);
  assert.equal(validateTimings({...value,lines:[...value.lines,...value.lines]},song,text).valid,false);
  assert.equal(validateTimings({...value,lines:[{line:1,text:'**Вторая**',seconds:Infinity}]},song,text).valid,false);
  assert.equal(validateTimings(null,song,text).reason,null);
});

test('lyric line rendering preserves styles spanning lines without adding markup tokens', () => {
  assert.deepEqual(renderedLyricLines('**Первый\nвторой**\n'), ['<b>Первый</b>','<b>второй</b>','']);
  assert.equal(parseTimecode('2:33.125'),153.125);
  assert.equal(parseTimecode('1:02:03'),3723);
  for (const input of ['2:99','x','-1:00','999:00:00']) assert.equal(parseTimecode(input),null);
  assert.equal(formatTimecode(153.125),'2:33.125');
  assert.equal(formatTimecode(60),'1:00');
});
