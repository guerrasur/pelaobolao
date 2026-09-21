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
