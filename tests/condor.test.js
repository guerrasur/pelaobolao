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
  assert.match(source, /if \(s\.game && revealStage\(s\.game, now\(\)\) === 'actions'\) drawRevealAttackLines\(s\.game, 'actions'\)/);
});


test('0.28 mantiene el countdown fuera del HTML autoritativo para no reiniciar la escena', async () => {
  const source = await readFile('src/main.js', 'utf8');
  const start = source.indexOf('function revealOverlayHtml');
  const end = source.indexOf('function drawRevealAttackLines', start);
  const overlay = source.slice(start, end);
  assert.doesNotMatch(overlay, /revealCountdown\(/);
  assert.match(overlay, /data-reveal-countdown><\/strong>/);
  assert.match(overlay, /aria-hidden="true"/);
});

test('0.28 dispara tiza y énfasis cuando las jugadas son visibles, no debajo del suspense', async () => {
  const js = await readFile('src/condor.js', 'utf8');
  const css = await readFile('src/condor.css', 'utf8');
  assert.match(js, /revealStageChanged/);
  assert.match(js, /revealStage === 'actions'[\s\S]*chalkBurst\(board\)/);
  assert.doesNotMatch(js, /phase === 'reveal'\) chalkBurst\(board\)/);
  assert.doesNotMatch(js, /phase === 'locked'\) playCue\('lock'\)/);
  assert.doesNotMatch(css, /data-phase="locked"\] \.players::after/);
  assert.match(css, /condor-reveal-actions/);
  assert.match(css, /condor-impact-pop/);
});


test('0.29 deja el item central como mechón sin tarjeta ni copy visible', async () => {
  const source = await readFile('src/main.js', 'utf8');
  const start = source.indexOf('function centerItemHtml');
  const end = source.indexOf('function centerItemNotice', start);
  const itemSource = source.slice(start, end);
  assert.match(itemSource, /class="hair-tuft"/);
  assert.doesNotMatch(itemSource, /item-new-badge|item-label|OBJETO EN EL AULA|AGARRAR<\/span>|1 SOPLO<\/span>/);

  const css = await readFile('src/style.css', 'utf8');
  const marker = css.indexOf('Plan Cóndor 0.29.0');
  const itemCss = css.slice(marker);
  assert.ok(marker >= 0);
  assert.match(itemCss, /background:transparent!important;/);
  assert.match(itemCss, /radial-gradient\(circle/);
  assert.match(itemCss, /drop-shadow/);
  assert.match(itemCss, /\.center-item\.drag-target::after\s*\{[\s\S]*?content:none!important;/);
});


test('0.29.1 elimina el aviso textual separado del mechón', async () => {
  const source = await readFile('src/main.js', 'utf8');
  const start = source.indexOf('function centerItemNotice');
  const end = source.indexOf('function outcomeKind', start);
  const noticeSource = source.slice(start, end);
  assert.match(noticeSource, /return '';/);
  assert.doesNotMatch(noticeSource, /MECHÓN|ÚLTIMA RONDA|No cuesta Soplos|item-notice/);
});


test('0.30 limpia el menú y estabiliza el lobby sin copy auxiliar', async () => {
  const [entrance, css] = await Promise.all([
    readFile('src/entrance.js', 'utf8'),
    readFile('src/condor30.css', 'utf8'),
  ]);
  assert.match(entrance, /function trimMenuCopy\(\)/);
  assert.match(entrance, /'\.home-copy'/);
  assert.match(entrance, /'\.lobby-help'/);
  assert.match(entrance, /new MutationObserver\(scheduleRefresh\)/);
  assert.match(css, /body\[data-keyboard-open="true"\]\[data-ui-screen="home"\]/);
  assert.match(css, /#app > \.lobby-screen/);
  assert.match(css, /\.presence-text\s*\{[\s\S]*?font-size:0!important/);
  assert.match(css, /@keyframes entry-surface-in/);
});


test('0.31 centra nombre, recompone el menú y limpia el código de sala', async () => {
  const [source, css] = await Promise.all([
    readFile('src/main.js', 'utf8'),
    readFile('src/condor30.css', 'utf8'),
  ]);
  assert.match(source, /¿Cuál es tu nombre\?/);
  assert.match(source, /class="profile-map"/);
  assert.match(source, /class="home-title-mark"/);
  assert.match(source, /No te quedes pelao/);
  assert.match(source, /lobby-room-label">SALA/);
  assert.match(css, /\.home-mascot\s*\{[\s\S]*?animation:pb-home-mascot-idle/);
  assert.match(source, /lobby-room-label">SALA<\/span><span class="code"/);
  assert.doesNotMatch(source, /BUENAS PARTIDAS AQUÍ|ESTRATEGIA RISAS AMIGOS|MISMO JUEGO MÁS AMIGOS|QUE COMIENCE LA JUGADA/);
});


test('0.32 recupera el resaltado amarillo sólo para el código de sala', async () => {
  const [source, css] = await Promise.all([
    readFile('src/main.js', 'utf8'),
    readFile('src/condor30.css', 'utf8'),
  ]);
  assert.match(source, /lobby-room-label">SALA<\/span><span class="code"/);
  assert.match(css, /\.lobby-heading \.code\s*\{[\s\S]*?border:2px dashed #202633!important;[\s\S]*?background:#ffdf4f!important;/);
  assert.match(css, /@media\(max-width:340px\)[\s\S]*?\.lobby-heading \.code/);
  const labelStart = css.indexOf('.lobby-room-label {');
  const labelEnd = css.indexOf('}', labelStart);
  const labelBlock = css.slice(labelStart, labelEnd + 1);
  assert.doesNotMatch(labelBlock, /background:#ffdf4f|background:yellow/);
});


test('0.33 refuerza tactilidad y jerarquía de fase sin mover la geometría', async () => {
  const [js, css, sound, packageInfo] = await Promise.all([
    readFile('src/condor.js', 'utf8'),
    readFile('src/condor.css', 'utf8'),
    readFile('src/sound.js', 'utf8'),
    readFile('package.json', 'utf8').then(JSON.parse),
  ]);
  assert.equal(packageInfo.version, '0.35.0');
  assert.match(js, /playCue\('gameTap'\)/);
  assert.match(js, /chosenInitialized/);
  assert.match(js, /condor-choice-locked/);
  assert.match(css, /Plan Cóndor 0\.33\.0/);
  assert.match(css, /--condor33-phase-glow/);
  assert.match(css, /button\.chosen-action/);
  assert.match(css, /condor33-seat-stamp/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(sound, /gameTap: \{ notes:/);
});


test('0.34 evita que el heartbeat del host bloquee su jugada y no confirma antes del servidor', async () => {
  const [client, main, visuals, sw, packageInfo, publicVersion] = await Promise.all([
    readFile('src/client.js', 'utf8'),
    readFile('src/main.js', 'utf8'),
    readFile('src/visuals.js', 'utf8'),
    readFile('public/sw.js', 'utf8'),
    readFile('package.json', 'utf8').then(JSON.parse),
    readFile('public/version.json', 'utf8').then(JSON.parse),
  ]);
  const start = client.indexOf('async function submitIntent');
  const end = client.indexOf('async function acknowledgeRound', start);
  const submitIntent = client.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(submitIntent, /tx\.get\(doc\(db, 'rooms'/);
  assert.match(submitIntent, /maxAttempts:\s*10/);
  assert.match(main, /const choiceSaving = Boolean\(s\.choice\?\.turn === game\.turn\)/);
  assert.match(main, /actionControls\(canChoose\(\), me\.breath, s\.targeting, choice\?\.action, hideBlocked, choiceSaving\)/);
  assert.match(visuals, /GUARDANDO…/);
  assert.equal(packageInfo.version, '0.35.0');
  assert.equal(publicVersion.version, '0.35.0');
  assert.match(sw, /pelaobolao-shell-0\.35\.0/);
});


test('0.35 endurece resolución y cubre stress multijugador', async () => {
  const [client, main, integration, sw, packageInfo, publicVersion] = await Promise.all([
    readFile('src/client.js', 'utf8'),
    readFile('src/main.js', 'utf8'),
    readFile('tests/integration.test.js', 'utf8'),
    readFile('public/sw.js', 'utf8'),
    readFile('package.json', 'utf8').then(JSON.parse),
    readFile('public/version.json', 'utf8').then(JSON.parse),
  ]);
  const start = client.indexOf('async function advanceGame');
  const end = client.indexOf('const commands', start);
  const advanceGame = client.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.ok(advanceGame.split('maxAttempts: 10').length - 1 >= 2);
  assert.match(main, /heartbeatBusy \|\| advancing/);
  assert.match(integration, /Plan Cóndor stress: 2, 3, 4 y 6 jugadores/);
  assert.match(integration, /Promise\.allSettled/);
  assert.match(integration, /resolvedTurn, turn/);
  assert.equal(packageInfo.version, '0.35.0');
  assert.equal(publicVersion.version, '0.35.0');
  assert.match(sw, /pelaobolao-shell-0\.35\.0/);
});


test('el lote de pulido conserva una jugada pendiente durante una desconexión breve', async () => {
  const main = await readFile('src/main.js', 'utf8');
  const offlineStart = main.indexOf("window.addEventListener('offline'");
  const onlineStart = main.indexOf("window.addEventListener('online'", offlineStart);
  const offlineBlock = main.slice(offlineStart, onlineStart);
  const onlineBlock = main.slice(onlineStart, main.indexOf("document.addEventListener('visibilitychange'", onlineStart));
  const flushStart = main.indexOf('async function flushIntent');
  const flushEnd = main.indexOf('function roundImpact', flushStart);
  const flush = main.slice(flushStart, flushEnd);
  assert.ok(offlineStart >= 0 && onlineStart > offlineStart);
  assert.doesNotMatch(offlineBlock, /pending\s*=\s*null/);
  assert.doesNotMatch(offlineBlock, /s\.choice\s*=\s*null/);
  assert.match(onlineBlock, /flushIntent\(\)/);
  assert.match(main, /function pendingIntentStillValid/);
  assert.match(flush, /endsWith\('unavailable'\)/);
  assert.match(flush, /Sin conexión · la jugada se enviará al volver/);
  assert.match(main, /Sin conexión · pendiente:/);
});

test('el lote de pulido diferencia GUARDANDO de ELEGIDA también en feedback visual y sonoro', async () => {
  const [visuals, css, condor, sound] = await Promise.all([
    readFile('src/visuals.js', 'utf8'),
    readFile('src/condor.css', 'utf8'),
    readFile('src/condor.js', 'utf8'),
    readFile('src/sound.js', 'utf8'),
  ]);
  assert.match(visuals, /saving \? 'saving-action' : 'chosen-action'/);
  assert.match(css, /button\.saving-action/);
  assert.match(css, /@keyframes condor-saving-pulse/);
  assert.match(condor, /classList\.contains\('self'\)\) playCue\('confirm'\)/);
  assert.match(sound, /confirm: \{ notes:/);
});


test('el lote de pulido: salida activa requiere una segunda intención visible', async () => {
  const [main, css] = await Promise.all([
    readFile('src/main.js', 'utf8'),
    readFile('src/condor.css', 'utf8'),
  ]);
  assert.match(main, /const matchStillRunning = \(\) =>/);
  assert.match(main, /leaveArmedUntil = Date\.now\(\) \+ 2600/);
  assert.match(main, /Tocá Confirmar salida para abandonar esta partida/);
  assert.match(main, /Confirmar salida/);
  assert.match(css, /#leave-room\.leave-armed/);
});


test('el lote de pulido: una cola de intención vieja no puede bloquear una sala nueva', async () => {
  const main = await readFile('src/main.js', 'utf8');
  assert.match(main, /intentGeneration = 0, sendingGeneration = -1/);
  assert.match(main, /const generation = intentGeneration/);
  assert.match(main, /sending && sendingGeneration === generation/);
  assert.match(main, /if \(generation !== intentGeneration\) break/);
  assert.match(main, /if \(sendingGeneration === generation\)/);
  const detachStart = main.indexOf('function detachGame');
  const resetStart = main.indexOf('function resetRoomSession', detachStart);
  assert.match(main.slice(detachStart, resetStart), /intentGeneration \+= 1/);
});


test('el lote de pulido silencia feedback en background y recalcula geometría al volver', async () => {
  const [main, condor, sound] = await Promise.all([
    readFile('src/main.js', 'utf8'),
    readFile('src/condor.js', 'utf8'),
    readFile('src/sound.js', 'utf8'),
  ]);
  assert.match(sound, /document !== 'undefined' && document\.hidden/);
  assert.match(main, /!document\.hidden && typeof navigator\.vibrate/);
  assert.match(condor, /window\.visualViewport\?\.addEventListener\('resize', scheduleEnhance/);
  assert.match(condor, /document\.addEventListener\('visibilitychange', resumeEnhance/);
  assert.match(condor, /window\.visualViewport\?\.removeEventListener\('resize', scheduleEnhance/);
});


test('el lote de pulido bloquea decisiones si el navegador dice online pero Firestore está stale', async () => {
  const [main, css] = await Promise.all([
    readFile('src/main.js', 'utf8'),
    readFile('src/condor.css', 'utf8'),
  ]);
  assert.match(main, /const connectionFresh = \(\) =>/);
  assert.match(main, /s\.online && connectionFresh\(\) && s\.game\?\.phase === 'choosing'/);
  assert.match(main, /Comprobando conexión con el servidor…/);
  assert.match(main, /lastContact = Date\.now\(\)/);
  assert.match(main, /classList\.toggle\('connection-stale', checkingConnection\)/);
  assert.match(css, /\.game\.connection-stale \.controls/);
});


test('el lote de pulido reintenta una jugada que queda colgada antes de que venza el turno', async () => {
  const main = await readFile('src/main.js', 'utf8');
  assert.match(main, /async function boundedCall\(promise, ms\)/);
  assert.match(main, /error\.code = 'unavailable'/);
  assert.match(main, /Promise\.race\(\[promise, timeout\]\)/);
  assert.match(main, /boundedCall\([\s\S]*?call\('submitIntent'/);
  assert.match(main, /3200/);
  assert.match(main, /pending = pending \?\? next/);
});


test('el lote de pulido: ningún request interno puede dejar congelado heartbeat o resolución', async () => {
  const main = await readFile('src/main.js', 'utf8');
  assert.match(main, /boundedCall\(roomCommand\('touch'\), 3200\)/);
  assert.match(main, /boundedCall\(roomCommand\('lobby'\), 3500\)/);
  assert.match(main, /boundedCall\(call\('acknowledgeRound'[\s\S]*?3200\)/);
  assert.match(main, /boundedCall\(call\('advanceGame'[\s\S]*?4000\)/);
  assert.match(main, /finally\(\(\) => \{ advancing = false; \}\)/);
  assert.match(main, /finally \{ heartbeatBusy = false; \}/);
});


test('el lote de pulido: la recuperación transitoria no deja avisos de error pegados', async () => {
  const main = await readFile('src/main.js', 'utf8');
  assert.match(main, /const showInternalError = error =>/);
  assert.match(main, /endsWith\('unavailable'\)\) showError\(error\)/);
  assert.match(main, /catch\(showInternalError\)/);
  assert.match(main, /notice\.textContent === 'Comprobando conexión con el servidor…'/);
  assert.match(main, /message\(''\)/);
});


test('el lote de pulido ignora un segundo dedo mientras se arrastra Soplar', async () => {
  const main = await readFile('src/main.js', 'utf8');
  assert.match(main, /if \(drag \|\| !canChoose\(\) \|\| event\.button !== 0 \|\| event\.isPrimary === false\) return;/);
  assert.match(main, /event\.pointerId !== drag\.pointerId/);
  assert.match(main, /setPointerCapture\(event\.pointerId\)/);
});
