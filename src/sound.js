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
    const patterns = {
      start: { notes:[392,523.25,659.25], step:.09, length:.18, type:'triangle', gain:.07 },
      reveal: { notes:[523.25,659.25], step:.08, length:.16, type:'triangle', gain:.06 },
      hit: { notes:[150,105,82], step:.055, length:.13, type:'square', gain:.045 },
      block: { notes:[260,390], step:.07, length:.14, type:'triangle', gain:.055 },
      tick: { notes:[880], step:.04, length:.075, type:'square', gain:.032 },
      lock: { notes:[330,220], step:.045, length:.10, type:'triangle', gain:.04 },
      target: { notes:[520,760], step:.045, length:.10, type:'triangle', gain:.032 },
      ready: { notes:[440,660], step:.055, length:.11, type:'triangle', gain:.03 },
      win: { notes:[523.25,659.25,783.99,1046.5], step:.075, length:.24, type:'triangle', gain:.075 },
      lose: { notes:[196,164.81,130.81,98], step:.085, length:.22, type:'sawtooth', gain:.045 },
      end: { notes:[659.25,523.25,392], step:.09, length:.18, type:'triangle', gain:.07 },
    };
    const pattern = patterns[kind] || patterns.reveal;
    pattern.notes.forEach((frequency, index) => {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const at = start + index * pattern.step;
      oscillator.type = pattern.type;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(pattern.gain, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + pattern.length);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(at); oscillator.stop(at + pattern.length + .02);
    });
  } catch { /* Audio is an enhancement; it must never block a round. */ }
}
