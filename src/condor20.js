import './condor20.css';
import { viewportPixels } from './condor-core.js';

const requestFrame = window.requestAnimationFrame?.bind(window)
  ?? (callback => window.setTimeout(callback, 16));
let refreshFrame = null;
let lastWidth = null;
let lastHeight = null;
let blurTimer = null;

function entryInputFocused() {
  const active = document.activeElement;
  return active instanceof HTMLInputElement && !active.closest?.('.game');
}

function setKeyboardMode(active = entryInputFocused()) {
  document.body.dataset.keyboardOpen = active ? 'true' : 'false';
  return active;
}

function refreshViewport() {
  refreshFrame = null;
  const keyboardOpen = setKeyboardMode();
  const visual = window.visualViewport;
  const viewport = viewportPixels(window.innerWidth, window.innerHeight, visual?.width, visual?.height);
  if (!viewport) return;

  const changed = viewport.width !== lastWidth || viewport.height !== lastHeight;
  if (!changed) return;
  lastWidth = viewport.width;
  lastHeight = viewport.height;

  document.documentElement.style.setProperty('--pb-viewport-width', `${viewport.width}px`);
  document.documentElement.style.setProperty('--pb-viewport-height', `${viewport.height}px`);

  // On entry/profile screens the CSS deliberately ignores visualViewport height
  // while the keyboard is open. Dispatching synthetic resize events there only
  // caused extra reflow during Safari's keyboard animation.
  if (!keyboardOpen) window.dispatchEvent(new Event('resize'));
}

function scheduleViewportRefresh() {
  if (refreshFrame !== null) return;
  refreshFrame = requestFrame(refreshViewport);
}

document.addEventListener('focusin', event => {
  if (!(event.target instanceof HTMLInputElement) || event.target.closest?.('.game')) return;
  window.clearTimeout(blurTimer);
  setKeyboardMode(true);
  scheduleViewportRefresh();
}, { passive:true });

document.addEventListener('focusout', event => {
  if (!(event.target instanceof HTMLInputElement) || event.target.closest?.('.game')) return;
  window.clearTimeout(blurTimer);
  blurTimer = window.setTimeout(() => {
    setKeyboardMode();
    scheduleViewportRefresh();
  }, 120);
}, { passive:true });

window.visualViewport?.addEventListener('resize', scheduleViewportRefresh, { passive:true });
window.visualViewport?.addEventListener('scroll', scheduleViewportRefresh, { passive:true });
window.addEventListener('orientationchange', scheduleViewportRefresh, { passive:true });
window.addEventListener('pageshow', scheduleViewportRefresh, { passive:true });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) scheduleViewportRefresh();
});
scheduleViewportRefresh();
