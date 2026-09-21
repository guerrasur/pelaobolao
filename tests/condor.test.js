import test from 'node:test';
import assert from 'node:assert/strict';
import { timerSeconds, shouldCountdownTick, phaseEntranceClass } from '../src/condor-core.js';

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
