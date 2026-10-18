import test from 'node:test';
import assert from 'node:assert/strict';
import {attachProgress} from '../player-progress.js';
function setup() {
  const audio=Object.assign(new EventTarget(),{duration:200,currentTime:20,readyState:1});
  const seek=Object.assign(new EventTarget(),{value:0,style:{setProperty(){}}});
  const current={},duration={},win=new EventTarget();
  const progress=attachProgress(audio,{seek,current,duration,format:String,win});
  const fire=(target,name)=>target.dispatchEvent(new Event(name));
  return {audio,seek,current,duration,win,progress,fire};
}
test('cancelled drag and focus loss resume live time updates',()=>{
  for(const name of ['pointercancel','touchcancel','blur']) {
    const {audio,seek,current,win,fire}=setup();
    seek.value=800;fire(seek,'input');assert.equal(current.textContent,'160');
    fire(name==='blur'?win:seek,name);
    audio.currentTime=40;fire(audio,'timeupdate');
    assert.equal(Number(seek.value),200);assert.equal(current.textContent,'40');
  }
});
test('source changes clear an unfinished seek and disable invalid duration',()=>{
  const {audio,seek,current,fire}=setup();
  seek.value=900;fire(seek,'input');
  audio.duration=NaN;audio.readyState=0;fire(audio,'emptied');
  assert.equal(seek.disabled,true);assert.equal(current.textContent,'0');
  audio.duration=100;audio.readyState=1;audio.currentTime=5;fire(audio,'loadedmetadata');
  assert.equal(Number(seek.value),50);assert.equal(seek.disabled,false);
});
test('mouse release and keyboard changes commit seeks and clamp skip buttons',()=>{
  const {audio,seek,progress,fire}=setup();
  seek.value=750;fire(seek,'input');fire(seek,'pointerup');assert.equal(audio.currentTime,150);
  seek.value=500;fire(seek,'input');fire(seek,'change');assert.equal(audio.currentTime,100);
  progress.seekTo(999);assert.equal(audio.currentTime,200);
  progress.seekTo(-10);assert.equal(audio.currentTime,0);
});
test('a rejected browser seek cannot freeze subsequent progress updates',()=>{
  const {audio,seek,current,progress,fire}=setup();
  Object.defineProperty(audio,'currentTime',{configurable:true,get:()=>20,set:()=>{throw new Error('Not ready');}});
  seek.value=750;fire(seek,'input');assert.equal(progress.seekTo(150),false);
  fire(audio,'timeupdate');assert.equal(current.textContent,'20');assert.equal(Number(seek.value),100);
});
