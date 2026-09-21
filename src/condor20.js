import './condor20.css';
import { viewportPixels } from './condor-core.js';

const requestFrame = window.requestAnimationFrame?.bind(window)
  ?? (callback => window.setTimeout(callback, 16));
let refreshFrame = null;
let lastWidth = null;
let lastHeight = null;

function refreshViewport() {
  refreshFrame = null;
  const visual = window.visualViewport;
  const viewport = viewportPixels(window.innerWidth, window.innerHeight, visual?.width, visual?.height);
  if (!viewport) return;

  const changed = viewport.width !== lastWidth || viewport.height !== lastHeight;
  if (!changed) return;
  lastWidth = viewport.width;
  lastHeight = viewport.height;

  document.documentElement.style.setProperty('--pb-viewport-width', `${viewport.width}px`);
  document.documentElement.style.setProperty('--pb-viewport-height', `${viewport.height}px`);

  // condor.js already recalculates the player-to-target trajectory on resize.
  // Bridge browser-chrome/keyboard viewport changes into that existing path.
  window.dispatchEvent(new Event('resize'));
}

function scheduleViewportRefresh() {
  if (refreshFrame !== null) return;
  refreshFrame = requestFrame(refreshViewport);
}

window.visualViewport?.addEventListener('resize', scheduleViewportRefresh, { passive: true });
window.visualViewport?.addEventListener('scroll', scheduleViewportRefresh, { passive: true });
window.addEventListener('orientationchange', scheduleViewportRefresh, { passive: true });
window.addEventListener('pageshow', scheduleViewportRefresh, { passive: true });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) scheduleViewportRefresh();
});
scheduleViewportRefresh();
