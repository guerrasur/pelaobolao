import './condor20.css';

const requestFrame = window.requestAnimationFrame?.bind(window)
  ?? (callback => window.setTimeout(callback, 16));
let refreshFrame = null;

function scheduleAimRefresh() {
  if (refreshFrame !== null) return;
  refreshFrame = requestFrame(() => {
    refreshFrame = null;
    // condor.js already recalculates the player-to-target trajectory on resize.
    // Mobile Safari/Chrome can change the visual viewport without firing a
    // reliable layout resize, so bridge those changes into the existing path.
    window.dispatchEvent(new Event('resize'));
  });
}

window.visualViewport?.addEventListener('resize', scheduleAimRefresh, { passive: true });
window.visualViewport?.addEventListener('scroll', scheduleAimRefresh, { passive: true });
window.addEventListener('orientationchange', scheduleAimRefresh, { passive: true });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) scheduleAimRefresh();
});
