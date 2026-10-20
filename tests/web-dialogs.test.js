import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the actual dialog callbacks with a small DOM surface and a fake API.
// No production URL, key, student or request is used by these tests.
const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
function harness(extra = {}) {
  const nodes = [], mounted = [];
  const h = (tag, attrs = {}, ...children) => {
    const events = new Map();
    const node = {tag, attrs, children: children.flat(), value: attrs.value || '',
      disabled: false, textContent: '', focus() {},
      addEventListener(name, fn) {events.set(name, fn);},
      showModal() {this.open = true;},
      close() {this.open = false; events.get('close')?.();},
      remove() {const index = mounted.indexOf(this); if (index >= 0) mounted.splice(index, 1);},
    };
    nodes.push(node); return node;
  };
  const routes = [], toasts = [];
  const context = {h, document: {
    querySelector(selector) {return mounted.find(n => n.attrs.class?.split(' ').includes(selector.slice(1))) || null;},
    body: {append(node) {mounted.push(node);}},
  }, route: async (...args) => routes.push(args), toast: value => toasts.push(value), ...extra};
  return {nodes, mounted, context, routes, toasts};
}
function loadCreate(h) {
  vm.runInNewContext(source.slice(source.indexOf('function createStudentDialog()'), source.indexOf('function archiveStudent(')), h.context);
  h.context.createStudentDialog();
  return {form: h.nodes.find(n => n.tag === 'form'), input: h.nodes.find(n => n.tag === 'input'),
    submit: h.nodes.find(n => n.attrs.type === 'submit')};
}
const event = () => ({preventDefault() {}});

test('new pupil form trims input, submits once while pending and refreshes on success', async () => {
  let finish;
  const calls = [];
  const h = harness({call: (action, params) => {calls.push([action, params]); return new Promise(resolve => {finish = resolve;});}});
  const {form,input,submit} = loadCreate(h);
  h.context.createStudentDialog();
  assert.equal(h.mounted.length, 1);
  input.value = '  Тестовый ученик  ';
  const first = form.attrs.onsubmit(event());
  assert.equal(submit.disabled, true);
  await form.attrs.onsubmit(event());
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'createStudent');
  assert.equal(calls[0][1].name, 'Тестовый ученик');
  finish(); await first;
  assert.equal(h.mounted.length, 0);
  assert.equal(h.routes.length, 1);
});

test('new pupil form keeps input and inline error after failure and allows retry', async () => {
  let calls = 0;
  const h = harness({call: async () => {calls++; throw Error('Проверочная ошибка');}});
  const {form,input,submit} = loadCreate(h);
  input.value = '   '; await form.attrs.onsubmit(event());
  assert.equal(calls, 0);
  input.value = 'Тест'; await form.attrs.onsubmit(event());
  assert.equal(calls, 1);
  assert.equal(input.value, 'Тест'); assert.equal(submit.disabled, false);
  assert.equal(h.mounted.length, 1);
  assert.equal(h.nodes.some(n => n.textContent === 'Проверочная ошибка'), true);
  await form.attrs.onsubmit(event()); assert.equal(calls, 2);
});

function loadBrand(h) {
  const handlers = {};
  const original = h.context.document.querySelector;
  h.context.document.querySelector = selector => selector === '.studio-brand'
    ? {addEventListener: (name, fn) => {handlers[name] = fn;}} : original(selector);
  vm.runInNewContext(source.slice(source.indexOf('const brandHome = '), source.indexOf('const kindSelect = ')), h.context);
  return handlers.click;
}

test('brand goes home by role without touching the shared player', () => {
  for (const role of ['teacher','student']) {
    const location = {hash:'#/test/song'}, dirtyEditors = new Set();
    const h = harness({location, role, libraryKey:'test-only-key', dirtyEditors,
      window: {scrollTo() {}}, openEditor: null,
      player: new Proxy({}, {get() {throw Error('Audio must continue untouched');}})});
    const click = loadBrand(h); click(event());
    assert.equal(location.hash, `#/${role === 'teacher' ? 't' : 's'}/test-only-key`);
  }
});

test('brand preserves unsaved edits until the explicit leave action', () => {
  const location = {hash:'#/test/song'}, dirtyEditors = new Set([() => true]);
  const h = harness({location,role:'teacher',libraryKey:'test-only-key',dirtyEditors,
    window:{scrollTo() {}},openEditor:'test-song'});
  const click = loadBrand(h); click(event());
  assert.equal(location.hash, '#/test/song');
  h.nodes.find(n => n.children.includes('Продолжить редактирование')).attrs.onclick();
  assert.equal(location.hash, '#/test/song'); assert.equal(dirtyEditors.size, 1);
  click(event());
  h.nodes.filter(n => n.children.includes('Выйти без сохранения')).at(-1).attrs.onclick();
  assert.equal(location.hash, '#/t/test-only-key'); assert.equal(dirtyEditors.size, 0);
});
