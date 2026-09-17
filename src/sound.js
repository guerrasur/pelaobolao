let context;

function getContext() {
  if (typeof window === 'undefined') return null;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  context ||= new AudioContext();
  return context;
}

if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', () => {
    const audio = getContext();
    if (audio?.state === 'suspended') void audio.resume();
  }, { passive: true });
}

export function playCue(kind) {
  try {
    const audio = getContext();
    if (!audio) return;
    if (audio.state === 'suspended') void audio.resume();
    const start = audio.currentTime;
    const notes = kind === 'start' ? [392, 523.25, 659.25] : [659.25, 523.25, 392];
    notes.forEach((frequency, index) => {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = 'triangle'; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start + index * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.075, start + index * 0.09 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + index * 0.09 + 0.16);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(start + index * 0.09); oscillator.stop(start + index * 0.09 + 0.18);
    });
  } catch { /* Audio is an enhancement; it must never block a round. */ }
}
