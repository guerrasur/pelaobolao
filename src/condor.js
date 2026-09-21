import './condor.css';
import { playCue } from './sound.js';
import { aimGuideGeometry, timerSeconds, shouldCountdownTick, phaseEntranceClass } from './condor-core.js';

const ENTER_CLASSES = ['condor-enter-choosing', 'condor-enter-locked', 'condor-enter-reveal', 'condor-enter-finished'];

function chalkBurst(board) {
  board.querySelector('.condor-chalk-burst')?.remove();
  const burst = document.createElement('span');
  burst.className = 'condor-chalk-burst';
  burst.setAttribute('aria-hidden', 'true');
  const pieces = Array.from({ length: 10 }, (_, index) => {
    const angle = (index * 137 + 17) % 360;
    const distance = 24 + (index % 5) * 9;
    const rotation = (index * 71) % 180 - 90;
    return `<i style="--angle:${angle}deg;--distance:${distance}px;--rotation:${rotation}deg;--delay:${(index % 4) * 0.025}s"></i>`;
  }).join('');
  burst.innerHTML = pieces;
  board.append(burst);
  window.setTimeout(() => burst.remove(), 950);
}

function pulseEntrance(board, phase) {
  board.classList.remove(...ENTER_CLASSES);
  const className = phaseEntranceClass(phase);
  if (!className) return;
  void board.offsetWidth;
  board.classList.add(className);
  window.setTimeout(() => board.classList.remove(className), 760);
}

function addPressRipple(event) {
  const button = event.target.closest?.('.controls button');
  if (!button || button.disabled || event.button > 0) return;
  const rect = button.getBoundingClientRect();
  const ripple = document.createElement('span');
  ripple.className = 'condor-ripple';
  ripple.setAttribute('aria-hidden', 'true');
  ripple.style.setProperty('--x', `${event.clientX - rect.left}px`);
  ripple.style.setProperty('--y', `${event.clientY - rect.top}px`);
  button.append(ripple);
  window.setTimeout(() => ripple.remove(), 520);
}

function pulseClass(node, className, duration = 650) {
  if (!node) return;
  node.classList.remove(className);
  void node.offsetWidth;
  node.classList.add(className);
  window.setTimeout(() => node.classList.remove(className), duration);
}

function updateAimGuide(board) {
  const sourcePlayer = board?.querySelector('.player.self');
  const targetPlayer = board?.querySelector('.player.selected-target');
  const source = sourcePlayer?.querySelector('.avatar-wrap') ?? sourcePlayer;
  const target = targetPlayer?.querySelector('.avatar-wrap') ?? targetPlayer;
  let guide = board?.querySelector('.condor-aim-guide');
  if (!board || board.dataset.phase !== 'choosing' || !source || !target) {
    guide?.remove();
    return;
  }
  const targetRect = target.getBoundingClientRect();
  const geometry = aimGuideGeometry(source.getBoundingClientRect(), targetRect, board.getBoundingClientRect());
  if (!geometry) {
    guide?.remove();
    return;
  }
  if (!guide) {
    guide = document.createElement('span');
    guide.className = 'condor-aim-guide';
    guide.setAttribute('aria-hidden', 'true');
    guide.innerHTML = '<i></i><i></i><i></i><b>ATAQUE</b>';
    board.append(guide);
  }
  const label = guide.querySelector('b');
  const targetName = targetPlayer?.querySelector('.player-label, .item-label')?.textContent?.trim();
  const nextLabel = targetName ? `SOPLO → ${targetName}` : 'ATAQUE';
  if (label && label.textContent !== nextLabel) label.textContent = nextLabel;
  const stopShort = Math.min(targetRect.width, targetRect.height) * .42;
  guide.style.left = `${geometry.left}px`;
  guide.style.top = `${geometry.top}px`;
  guide.style.width = `${Math.max(20, geometry.length - stopShort)}px`;
  guide.style.transform = `rotate(${geometry.angle}deg)`;
  guide.classList.toggle('is-reversed', geometry.angle > 90 || geometry.angle < -90);
}

export function startCondor(root = document) {
  const app = root.querySelector('#app');
  if (!app || typeof MutationObserver === 'undefined') return () => {};

  let lastPhase = null;
  let lastTickKey = null;
  let lastBoard = null;
  let lastTargetUid = null;
  let tickCleanup = 0;
  let lobbyInitialized = false;
  let lobbyState = new Map();
  let waitingInitialized = false;
  let waitingIds = new Set();
  let itemInitialized = false;
  let lastItemTurn = null;
  let lastGrabSelected = false;

  const enhanceLobby = () => {
    const list = app.querySelector('.lobby-list');
    if (!list) {
      lobbyInitialized = false;
      lobbyState = new Map();
      return;
    }
    const nextState = new Map();
    let readyCue = false;
    for (const row of list.querySelectorAll('[data-member]')) {
      const uid = row.dataset.member;
      const ready = row.dataset.ready === 'true';
      nextState.set(uid, ready);
      if (!lobbyInitialized) continue;
      if (!lobbyState.has(uid)) {
        pulseClass(row, 'condor-lobby-join', 720);
      } else if (!lobbyState.get(uid) && ready) {
        pulseClass(row, 'condor-lobby-ready', 680);
        readyCue = true;
      } else if (lobbyState.get(uid) && !ready) {
        pulseClass(row, 'condor-lobby-unready', 460);
      }
    }
    if (readyCue) playCue('ready');
    lobbyState = nextState;
    lobbyInitialized = true;
  };

  const enhance = () => {
    const board = app.querySelector('.game');
    if (!board) {
      lastBoard?.querySelector('.condor-aim-guide')?.remove();
      lastBoard = null;
      lastPhase = null;
      lastTickKey = null;
      lastTargetUid = null;
      waitingInitialized = false;
      waitingIds = new Set();
      itemInitialized = false;
      lastItemTurn = null;
      lastGrabSelected = false;
      enhanceLobby();
      return;
    }

    lobbyInitialized = false;
    lobbyState = new Map();
    const phase = board.dataset.phase || '';
    const phaseChanged = phase !== lastPhase;
    if (phaseChanged) {
      lastPhase = phase;
      lastTickKey = null;
      pulseEntrance(board, phase);
      if (phase === 'locked') playCue('lock');
      if (phase === 'reveal') chalkBurst(board);
    }
    lastBoard = board;

    const target = board.querySelector('.player.selected-target');
    const targetUid = target?.dataset.player ?? null;
    if (targetUid && targetUid !== lastTargetUid) {
      pulseClass(target, 'condor-target-lock', 620);
      playCue('target');
    }
    lastTargetUid = targetUid;
    updateAimGuide(board);

    const centerItem = board.querySelector('[data-center-item]');
    const grabSelected = Boolean(centerItem?.classList.contains('selected-grab'));
    centerItem?.classList.toggle('condor-grab-confirmed', grabSelected);
    if (grabSelected && !lastGrabSelected) {
      pulseClass(centerItem, 'condor-item-grab', 720);
      playCue('grab');
    }
    lastGrabSelected = grabSelected;
    const itemTurn = centerItem?.dataset.itemTurn ?? null;
    if (centerItem && itemInitialized && itemTurn && itemTurn !== lastItemTurn) {
      pulseClass(centerItem, 'condor-item-arrive', 820);
      playCue('item');
    }
    lastItemTurn = itemTurn;
    itemInitialized = true;

    const queue = board.querySelector('[data-waiting-ids]');
    const nextWaitingIds = new Set((queue?.dataset.waitingIds || '').split(',').filter(Boolean));
    if (queue && waitingInitialized && [...nextWaitingIds].some(uid => !waitingIds.has(uid))) {
      pulseClass(queue, 'condor-queue-join', 720);
      playCue('ready');
    }
    waitingIds = nextWaitingIds;
    waitingInitialized = true;

    const seconds = timerSeconds(board.querySelector('#timer')?.textContent);
    const tickKey = `${phase}:${seconds}`;
    if (shouldCountdownTick(phase, seconds) && tickKey !== lastTickKey) {
      lastTickKey = tickKey;
      playCue('tick');
      board.dataset.condorTick = String(seconds);
      window.clearTimeout(tickCleanup);
      tickCleanup = window.setTimeout(() => {
        if (lastBoard === board && board.dataset.condorTick === String(seconds)) delete board.dataset.condorTick;
      }, 360);
    }
  };

  const observer = new MutationObserver(enhance);
  observer.observe(app, { subtree: true, childList: true, characterData: true });
  root.addEventListener('pointerdown', addPressRipple, { passive: true });
  window.addEventListener('resize', enhance, { passive: true });
  enhance();

  return () => {
    observer.disconnect();
    root.removeEventListener('pointerdown', addPressRipple);
    window.removeEventListener('resize', enhance);
    window.clearTimeout(tickCleanup);
    lastBoard?.querySelector('.condor-aim-guide')?.remove();
  };
}

if (typeof document !== 'undefined') startCondor(document);
