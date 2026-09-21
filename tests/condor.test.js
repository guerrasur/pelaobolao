import test from 'node:test';
import assert from 'node:assert/strict';
import { aimGuideGeometry, timerSeconds, shouldCountdownTick, phaseEntranceClass } from '../src/condor-core.js';

test('timerSeconds only accepts rendered second labels', () => {
  assert.equal(timerSeconds('03s'), 3);
  assert.equal(timerSeconds('1s'), 1);
  assert.equal(timerSeconds('···'), null);
  assert.equal(timerSeconds('¡YA!'), null);
});

test('countdown cue only fires for the last three choosing seconds', () => {
  assert.equal(shouldCountdownTick('choosing', 3), true);
  assert.equal(shouldCountdownTick('choosing', 1), true);
  assert.equal(shouldCountdownTick('choosing', 4), false);
  assert.equal(shouldCountdownTick('reveal', 2), false);
  assert.equal(shouldCountdownTick('locked', 1), false);
});

test('only visible phase transitions receive an entrance class', () => {
  assert.equal(phaseEntranceClass('reveal'), 'condor-enter-reveal');
  assert.equal(phaseEntranceClass('finished'), 'condor-enter-finished');
  assert.equal(phaseEntranceClass('syncing'), null);
});


test('aim guide connects centers relative to the board', () => {
  const geometry = aimGuideGeometry(
    { left:10, top:80, width:40, height:20 },
    { left:210, top:20, width:60, height:40 },
    { left:0, top:0, width:320, height:200 },
  );
  assert.ok(geometry);
  assert.equal(geometry.left, 30);
  assert.equal(geometry.top, 90);
  assert.equal(Math.round(geometry.length), 216);
  assert.equal(Math.round(geometry.angle), -13);
});

test('aim guide rejects incomplete rectangles', () => {
  assert.equal(aimGuideGeometry(null, {}, {}), null);
  assert.equal(aimGuideGeometry(
    { left:0, top:0, width:0, height:0 },
    { left:0, top:0, width:0, height:0 },
    { left:0, top:0, width:100, height:100 },
  ), null);
});
