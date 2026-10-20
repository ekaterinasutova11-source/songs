import test from 'node:test';
import assert from 'node:assert/strict';
import {SCALE_KEY, normalizedScale, readScale, applyScale} from '../interface-scale.js';

test('scale has readable defaults and clamps corrupted stored values', () => {
  for (const value of [null, undefined, '', 'no', Infinity]) assert.equal(normalizedScale(value), 100);
  assert.equal(normalizedScale(70), 85);
  assert.equal(normalizedScale(200), 150);
  assert.equal(normalizedScale('125'), 125);
});

test('scale persists independently and restores without altering other preferences', () => {
  const values = new Map([['songs:lyrics-font', 'book']]);
  const storage = {getItem: k => values.get(k), setItem: (k,v) => values.set(k,v)};
  const properties = new Map();
  const root = {style: {setProperty: (k,v) => properties.set(k,v)}, dataset: {}};
  assert.equal(readScale(storage), 100);
  assert.equal(applyScale(root, storage, 125), 125);
  assert.equal(properties.get('--interface-scale'), '1.25');
  assert.equal(root.dataset.interfaceScale, '125');
  assert.equal(readScale(storage), 125);
  assert.equal(values.get(SCALE_KEY), '125');
  assert.equal(values.get('songs:lyrics-font'), 'book');
});

test('blocked storage does not prevent page scale or default rendering', () => {
  const storage = {getItem() {throw Error('blocked');}, setItem() {throw Error('blocked');}};
  const root = {style: {setProperty() {}}, dataset: {}};
  assert.equal(readScale(storage), 100);
  assert.equal(applyScale(root, storage, 150), 150);
  assert.equal(readScale(null), 100);
});
