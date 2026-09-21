export function timerSeconds(text) {
  const match = /^\s*(\d{1,2})s\s*$/.exec(String(text ?? ''));
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isInteger(seconds) ? seconds : null;
}

export function shouldCountdownTick(phase, seconds) {
  return phase === 'choosing' && Number.isInteger(seconds) && seconds >= 1 && seconds <= 3;
}

export function phaseEntranceClass(phase) {
  return ['choosing', 'locked', 'reveal', 'finished'].includes(phase)
    ? `condor-enter-${phase}`
    : null;
}


export function aimGuideGeometry(sourceRect, targetRect, boardRect) {
  const rects = [sourceRect, targetRect, boardRect];
  if (rects.some(rect => !rect || ![rect.left, rect.top, rect.width, rect.height].every(Number.isFinite))) return null;
  const sourceX = sourceRect.left + sourceRect.width / 2 - boardRect.left;
  const sourceY = sourceRect.top + sourceRect.height / 2 - boardRect.top;
  const targetX = targetRect.left + targetRect.width / 2 - boardRect.left;
  const targetY = targetRect.top + targetRect.height / 2 - boardRect.top;
  const dx = targetX - sourceX, dy = targetY - sourceY;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length < 1) return null;
  return {
    left: sourceX,
    top: sourceY,
    length,
    angle: Math.atan2(dy, dx) * 180 / Math.PI,
  };
}


export function dragGuideGeometry(sourceRect, pointerX, pointerY, targetRect = null) {
  if (!sourceRect || ![sourceRect.left, sourceRect.top, sourceRect.width, sourceRect.height, pointerX, pointerY].every(Number.isFinite)) return null;
  const sourceX = sourceRect.left + sourceRect.width / 2;
  const sourceY = sourceRect.top + sourceRect.height / 2;
  const endX = targetRect && [targetRect.left, targetRect.width].every(Number.isFinite)
    ? targetRect.left + targetRect.width / 2 : pointerX;
  const endY = targetRect && [targetRect.top, targetRect.height].every(Number.isFinite)
    ? targetRect.top + targetRect.height / 2 : pointerY;
  const dx = endX - sourceX, dy = endY - sourceY;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length < 1) return null;
  return { left: sourceX, top: sourceY, length, angle: Math.atan2(dy, dx) * 180 / Math.PI };
}


export function viewportPixels(layoutWidth, layoutHeight, visualWidth = null, visualHeight = null) {
  const width = Number.isFinite(visualWidth) && visualWidth > 0 ? visualWidth : layoutWidth;
  const height = Number.isFinite(visualHeight) && visualHeight > 0 ? visualHeight : layoutHeight;
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) return null;
  return { width: Math.round(width), height: Math.round(height) };
}

export function shouldHoldRenderForDrag(dragActive, phase, updateRequired = false) {
  return Boolean(dragActive && phase === 'choosing' && !updateRequired);
}
