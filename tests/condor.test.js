import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { aimGuideGeometry, dragGuideGeometry, timerSeconds, shouldCountdownTick, phaseEntranceClass, viewportPixels, shouldHoldRenderForDrag } from '../src/condor-core.js';

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


test('drag guide follows the pointer from the center of the local avatar', () => {
  const geometry = dragGuideGeometry(
    { left:20, top:40, width:40, height:60 },
    180, 130,
  );
  assert.ok(geometry);
  assert.equal(geometry.left, 40);
  assert.equal(geometry.top, 70);
  assert.equal(Math.round(geometry.length), 152);
  assert.equal(Math.round(geometry.angle), 23);
});

test('drag guide snaps to the center of a hovered target', () => {
  const geometry = dragGuideGeometry(
    { left:20, top:40, width:40, height:60 },
    500, 500,
    { left:200, top:80, width:60, height:40 },
  );
  assert.ok(geometry);
  assert.equal(geometry.left, 40);
  assert.equal(geometry.top, 70);
  assert.equal(Math.round(geometry.length), 192);
  assert.equal(Math.round(geometry.angle), 9);
});


test('active blow drag holds non-critical choosing renders only', () => {
  assert.equal(shouldHoldRenderForDrag(true, 'choosing', false), true);
  assert.equal(shouldHoldRenderForDrag(false, 'choosing', false), false);
  assert.equal(shouldHoldRenderForDrag(true, 'locked', false), false);
  assert.equal(shouldHoldRenderForDrag(true, 'choosing', true), false);
});


test('mobile viewport prefers the visual viewport and has a safe layout fallback', () => {
  assert.deepEqual(viewportPixels(390, 844, 390, 760.4), { width:390, height:760 });
  assert.deepEqual(viewportPixels(390, 844, 0, undefined), { width:390, height:844 });
  assert.equal(viewportPixels(0, 844), null);
  assert.equal(viewportPixels(390, NaN), null);
});


test('0.27 no deja que el teclado de Safari achique el menú al visualViewport', async () => {
  const css = await readFile('src/condor20.css', 'utf8');
  const js = await readFile('src/condor20.js', 'utf8');
  assert.match(css, /body\[data-ui-screen="game"\],\s*body\[data-ui-screen="lobby"\]/);
  assert.match(css, /body\s*\{\s*height:100dvh;\s*max-height:100dvh;/);
  assert.match(js, /dataset\.keyboardOpen/);
  assert.match(js, /if \(!keyboardOpen\) window\.dispatchEvent/);
});

test('0.27 no reinicia flechas de reveal en cada tick', async () => {
  const source = await readFile('src/main.js', 'utf8');
  const syncStart = source.indexOf('function syncRevealTimeline');
  const syncEnd = source.indexOf('function selectionText', syncStart);
  const syncSource = source.slice(syncStart, syncEnd);
  assert.doesNotMatch(syncSource, /drawRevealAttackLines\(game, stage\);\s*if \(key === lastRevealStageKey\)/);
  assert.match(syncSource, /render\(\);[\s\S]*drawRevealAttackLines\(game, stage\)/);
});
