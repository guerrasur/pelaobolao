import './entrance.css';
import { playCue } from './sound.js';

const app = document.querySelector('#app');
const body = document.body;
let lastScreen = '';
let interacted = false;
let arrivalTimer = 0;

function vibrate(pattern) {
  try { if (typeof navigator.vibrate === 'function') navigator.vibrate(pattern); } catch {}
}

function screenName() {
  if (app?.querySelector('.game')) return 'game';
  if (app?.querySelector('.lobby-screen')) return 'lobby';
  if (app?.querySelector('.home-screen')) return 'home';
  if (app?.querySelector('.profile-screen')) return 'profile';
  if (app?.querySelector('.room-loading')) return 'room';
  if (app?.querySelector('.entry-loading')) return 'loading';
  if (app?.querySelector('.update-gate')) return 'update';
  return 'state';
}

function refreshScreen() {
  if (!app) return;
  const next = screenName();
  body.dataset.uiScreen = next;
  if (next === lastScreen) return;

  const section = app.querySelector(':scope > section');
  section?.classList.remove('entry-arrive');
  if (next !== 'game' && section) {
    void section.offsetWidth;
    section.classList.add('entry-arrive');
    window.clearTimeout(arrivalTimer);
    arrivalTimer = window.setTimeout(() => section.classList.remove('entry-arrive'), 720);
  }

  if (interacted && lastScreen && next !== lastScreen) {
    if (next === 'lobby') {
      playCue('menuEnter');
      vibrate([9, 18, 12]);
    } else if (next === 'home' || next === 'profile' || next === 'room') {
      playCue('menuMove');
      vibrate(7);
    }
  }
  lastScreen = next;
}

function pressStart(event) {
  const button = event.target.closest?.('#app button');
  if (!button || button.disabled || button.closest('.game') || event.button > 0) return;
  interacted = true;
  button.classList.add('menu-pressed');
  playCue(button.classList.contains('quiet') ? 'menuSoft' : 'menuTap');
  vibrate(button.classList.contains('quiet') ? 4 : 7);
}

function pressEnd(event) {
  const button = event.target.closest?.('#app button');
  button?.classList.remove('menu-pressed');
}

function focusFeedback(event) {
  if (!(event.target instanceof HTMLInputElement) || event.target.closest('.game')) return;
  if (!interacted) return;
  playCue('menuSoft');
}

if (app && typeof MutationObserver !== 'undefined') {
  const observer = new MutationObserver(refreshScreen);
  observer.observe(app, { childList:true, subtree:true });
  app.addEventListener('pointerdown', pressStart, { passive:true });
  app.addEventListener('pointerup', pressEnd, { passive:true });
  app.addEventListener('pointercancel', pressEnd, { passive:true });
  app.addEventListener('focusin', focusFeedback);
  document.addEventListener('pointerdown', () => { interacted = true; }, { once:true, passive:true });
  refreshScreen();
}
