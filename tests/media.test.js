import test from 'node:test';
import assert from 'node:assert/strict';
import {attachMediaControls, primeAudio} from '../media.js';

test('system playback controls work without routing music through Web Audio', () => {
  const actions = {}, events = {}, positions = [];
  const audio = {currentTime: 12, duration: 20, playbackRate: 1.25, paused: false,
    addEventListener: (name, fn) => {events[name] = fn;}, pause() {this.paused = true;}};
  const nav = {audioSession: {}, mediaSession: {setActionHandler: (name, handler) => {actions[name] = handler;},
    setPositionState: state => positions.push(state)}};
  let plays = 0, stops = 0;
  attachMediaControls(audio, {nav, play: () => plays++, stop: () => stops++});
  assert.equal(nav.audioSession.type, 'playback');
  actions.play(); actions.seekforward({seekOffset: 30}); assert.equal(audio.currentTime, 20);
  actions.seekbackward({seekOffset: 50}); assert.equal(audio.currentTime, 0);
  actions.seekto({seekTime: 7}); assert.equal(audio.currentTime, 7);
  events.timeupdate(); assert.equal(nav.mediaSession.playbackState, 'playing');
  assert.equal(positions.at(-1).playbackRate, 1.25);
  actions.pause(); events.pause(); assert.equal(nav.mediaSession.playbackState, 'paused');
  actions.stop(); assert.equal(stops, 1); assert.equal(plays, 1);
});
test('audio priming calls play synchronously within the tap and cannot pause a subsequently loaded song', async () => {
  let calls = 0, pauses = 0, resolve;
  const audio = {src: '', play() {calls++; return new Promise(r => {resolve = r;});}, pause() {pauses++;}};
  primeAudio(audio); assert.equal(calls, 1);
  const bytes = Buffer.from(audio.src.split(',')[1], 'base64');
  assert.equal(bytes.subarray(0,4).toString(), 'RIFF');
  assert.equal(bytes.readUInt32LE(40), bytes.length - 44);
  audio.src = 'blob:actual-song'; resolve(); await Promise.resolve();
  assert.equal(pauses, 0);
});
test('unsupported system controls do not stop ordinary playback', () => {
  assert.doesNotThrow(() => attachMediaControls({}, {nav: {}}));
  const nav = {get audioSession() {throw new Error('Unsupported');}, mediaSession: {setActionHandler() {throw new Error('Unsupported');}}};
  assert.doesNotThrow(() => attachMediaControls({addEventListener() {}}, {nav, play() {}, stop() {}}));
});
