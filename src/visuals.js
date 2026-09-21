const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const svg = (body, viewBox = '0 0 64 64') => `<svg viewBox="${viewBox}" aria-hidden="true" focusable="false">${body}</svg>`;
const colors = ['#fa4563', '#139bf5', '#17bb87', '#ffc443', '#b076ed', '#f58d45'];

function avatar(index, hair, effects = {}) {
  const styles = [
    'M13 29 9 17 20 19 17 7 30 13 37 6 42 15 54 12 50 23 57 29 47 31 43 21 35 27 26 20 20 31Z',
    'M11 46C3 7 23 4 34 9 59 3 62 36 53 51L44 39 44 20 35 29 24 19 19 43Z',
    'M12 29Q7 13 22 12Q26 0 38 11Q53 3 56 20L49 32 42 22 33 27 24 20 18 32Z',
  ];
  return svg(`<path d="M8 64Q9 48 32 49Q54 48 57 64" fill="${colors[index % colors.length]}" stroke="#20232e" stroke-width="2.5"/>
    <ellipse cx="12" cy="34" rx="5" ry="7" fill="#edb387" stroke="#20232e" stroke-width="2"/>
    <ellipse cx="52" cy="34" rx="5" ry="7" fill="#edb387" stroke="#20232e" stroke-width="2"/>
    <path d="M13 27C13 3 52 3 52 27L50 41Q46 55 32 56Q18 53 14 41Z" fill="#ffd0a5" stroke="#20232e" stroke-width="2.5"/>
    ${hair >= 2 ? `<path d="${styles[index % styles.length]}" fill="${index % 2 ? '#30242c' : '#734024'}" stroke="#20232e" stroke-width="2"/>` : hair === 1 ? '<path d="M24 15q6-14 10-2m0 0q4-12 9-2" fill="none" stroke="#443127" stroke-width="3" stroke-linecap="round"/>' : ''}
    <path d="M20 32l7-2m12 0 7 2" stroke="#30232a" stroke-width="2.5" stroke-linecap="round"/>
    ${hair === 0
      ? '<path d="M20 36q4 4 8 0m10 0q4 4 8 0" fill="none" stroke="#20232e" stroke-width="2.4" stroke-linecap="round"/>'
      : effects.hit
        ? '<path d="M20 34l7 6m-7 0 7-6m11 0 7 6m-7 0 7-6" fill="none" stroke="#20232e" stroke-width="2.1" stroke-linecap="round"/>'
        : effects.action === 'hide'
          ? '<ellipse cx="24" cy="36" rx="3.2" ry="4.5" fill="#fff" stroke="#20232e" stroke-width="1.5"/><ellipse cx="42" cy="36" rx="3.2" ry="4.5" fill="#fff" stroke="#20232e" stroke-width="1.5"/><circle cx="24" cy="37" r="1.6" fill="#20232e"/><circle cx="42" cy="37" r="1.6" fill="#20232e"/>'
          : effects.action === 'air'
            ? '<path d="M20 36q4-3 8 0m10 0q4-3 8 0" fill="none" stroke="#20232e" stroke-width="2.4" stroke-linecap="round"/>'
            : '<ellipse cx="24" cy="36" rx="2.2" ry="3.5" fill="#20232e"/><ellipse cx="42" cy="36" rx="2.2" ry="3.5" fill="#20232e"/>'}
    <path d="M31 39l-1 5h4" fill="none" stroke="#9e573d" stroke-width="1.8" stroke-linecap="round"/>
    ${hair === 0
      ? '<path d="M27 49q5-3 10 0" fill="none" stroke="#9e573d" stroke-width="1.8" stroke-linecap="round"/>'
      : effects.action === 'blow'
        ? '<ellipse cx="34" cy="48" rx="4.5" ry="3" fill="#87453d" stroke="#20232e" stroke-width="1.4"/>'
        : effects.hit
          ? '<path d="M27 49q5-5 10 0" fill="none" stroke="#9e573d" stroke-width="2" stroke-linecap="round"/>'
          : effects.action === 'air'
            ? '<ellipse cx="33" cy="48" rx="3.7" ry="4.7" fill="#87453d" stroke="#20232e" stroke-width="1.4"/>'
            : '<path d="M27 48q5 4 10-1" fill="none" stroke="#9e573d" stroke-width="1.8" stroke-linecap="round"/>'}`);
}

function effectMarkup(effects = {}) {
  const bits = [];
  if (effects.action === 'blow') bits.push('<span class="fx fx-wind"><i></i><i></i><i></i></span><b class="fx-label fx-label-action">¡SOPLA!</b>');
  if (effects.action === 'air') bits.push('<span class="fx fx-air"><i></i><i></i><i></i></span><b class="fx-label fx-label-action">+1 SOPLO</b>');
  if (effects.action === 'hide') bits.push('<span class="fx fx-desk"><i></i></span><b class="fx-label fx-label-action">¡ABAJO!</b>');
  if (effects.action === 'distracted') bits.push('<span class="fx fx-distracted">…</span>');
  if (effects.hit) {
    bits.push('<span class="fx fx-hair"><i></i><i></i><i></i><i></i></span>');
    bits.push('<b class="fx-label fx-label-hit">−' + Math.max(1, Number(effects.loss || 1)) + ' PELO</b>');
  } else if (effects.blockedDefense) {
    bits.push('<b class="fx-label fx-label-block">¡ATAJÓ!</b>');
  } else if (effects.blockedAttack) {
    bits.push('<b class="fx-label fx-label-block fx-label-rebound">¡BLOQUEADO!</b>');
  }
  return bits.length ? '<span class="player-fx" aria-hidden="true">' + bits.join('') + '</span>' : '';
}

export function playerCard({ uid, player: p, index, self, selected, chosen, connected = true, rules, effects = {} }) {
  const seat = Number.isInteger(index) && index >= 0 ? index : 0;
  const effectClass = [effects.action ? 'action-' + effects.action : '', effects.hit ? 'took-hit' : '', effects.blockedDefense ? 'blocked-hit' : '', effects.blockedAttack ? 'attack-blocked' : ''].filter(Boolean).join(' ');
  return `<button class="player ${self ? 'self' : ''} ${p.hair === 0 ? 'eliminated' : ''} ${p.hair === 1 ? 'critical' : ''} ${!connected ? 'offline-player' : ''} ${selected ? 'selected-target' : ''} ${effectClass}" data-player="${esc(uid)}" style="--seat-color:${colors[seat % colors.length]}" ${p.hair <= 0 || self ? 'disabled' : ''}>
    <strong class="player-name"><i>${seat + 1}</i><span class="player-label" title="${esc(p.name)}${self ? ' (vos)' : ''}">${esc(p.name)}${self ? ' (vos)' : ''}</span><span class="presence-dot ${connected ? 'online' : ''}" data-presence-dot="${esc(uid)}" aria-hidden="true"></span></strong>
    <div class="player-body"><div class="avatar-wrap"><div class="avatar">${avatar(seat, p.hair, effects)}</div></div>${effectMarkup(effects)}<div class="resources">
    <span>Pelo <b>${p.hair}</b>/${rules.maxHair}</span><span class="hair-pips" aria-hidden="true">${Array.from({ length: rules.maxHair }, (_, n) => `<i class="${n < p.hair ? 'full' : ''}"></i>`).join('')}</span>
    <span>Soplos <b>${p.breath}</b>/${rules.maxBreath}</span><span class="breath-pips" aria-hidden="true">${Array.from({ length: rules.maxBreath }, (_, n) => `<i class="${n < p.breath ? 'full' : ''}">≋</i>`).join('')}</span>
    </div></div><small>${p.hair === 0 ? 'Pelado' : !connected ? 'Reconectando…' : chosen ? '✓ Ya eligió' : self ? 'Tu posición' : 'En juego'}</small></button>`;
}
const icons = {
  blow: svg('<g fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"><path d="M8 24h28c12 0 10-17 1-15-4 1-5 4-4 6M5 34h44c13 0 13-19 2-19M12 44h22c13 0 12 14 4 13-4 0-5-3-5-5"/></g>'),
  air: svg('<path d="M29 7v23L17 48M35 7v23l13 18" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M23 20C10 20 4 43 8 52c4 8 17 2 19-4V24Zm18 0c13 0 19 23 15 32-4 8-17 2-19-4V24Z" fill="currentColor"/>'),
  hide: svg('<path d="M17 31V23c0-21 32-21 32 0v8" fill="#302038" stroke="currentColor" stroke-width="2"/><path d="M24 21q8-8 17 1v12H23Z" fill="#ffccaa"/><path d="M27 26h1m8 0h1" stroke="#20232e" stroke-width="3"/><path d="M7 34h50v9H7Zm6 10h38v15H13Z" fill="currentColor" stroke="#402360" stroke-width="2"/>'),
};
export function actionControls(enabled, breath, aiming, selectedAction = null) {
  const state = action => selectedAction === action ? '<small class="action-state">ELEGIDA</small>' : '';
  const pressed = action => selectedAction === action ? 'true' : 'false';
  return `<div class="controls" aria-label="Elegí tu acción">
    <button id="blow" class="${aiming ? 'aiming ' : ''}${selectedAction === 'blow' ? 'chosen-action' : ''}" aria-pressed="${pressed('blow')}" ${!enabled || breath < 1 ? 'disabled' : ''}>${icons.blow}<span>Soplar</span>${state('blow')}</button>
    <button data-action="air" class="${selectedAction === 'air' ? 'chosen-action' : ''}" aria-pressed="${pressed('air')}" ${!enabled ? 'disabled' : ''}>${icons.air}<span>Tomar aire</span>${state('air')}</button>
    <button data-action="hide" class="${selectedAction === 'hide' ? 'chosen-action' : ''}" aria-pressed="${pressed('hide')}" ${!enabled ? 'disabled' : ''}>${icons.hide}<span>Esconderse</span>${state('hide')}</button>
  </div>`;
}
