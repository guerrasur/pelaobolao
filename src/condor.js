import './condor.css';
import { playCue } from './sound.js';
import { timerSeconds, shouldCountdownTick, phaseEntranceClass } from './condor-core.js';

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
  // Restart the short phase stamp even when the browser batches the replacement.
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

export function startCondor(root = document) {
  const app = root.querySelector('#app');
  if (!app || typeof MutationObserver === 'undefined') return () => {};

  let lastPhase = null;
  let lastTickKey = null;
  let lastBoard = null;
  let tickCleanup = 0;

  const enhance = () => {
    const board = app.querySelector('.game');
    if (!board) {
      lastBoard = null;
      lastPhase = null;
      lastTickKey = null;
      return;
    }

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
  enhance();

  return () => {
    observer.disconnect();
    root.removeEventListener('pointerdown', addPressRipple);
    window.clearTimeout(tickCleanup);
  };
}

if (typeof document !== 'undefined') startCondor(document);
