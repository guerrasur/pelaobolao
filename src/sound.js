let context;
let enabled = true;
try { enabled = globalThis.localStorage?.getItem('pb-sound') !== 'off'; } catch {}

export const soundEnabled = () => enabled;
export function setSoundEnabled(value) {
  enabled = Boolean(value);
  try { globalThis.localStorage?.setItem('pb-sound', enabled ? 'on' : 'off'); } catch {}
  if (!enabled && context?.state === 'running') void context.suspend().catch(() => {});
  return enabled;
}

function unlockAudio() {
  if (!enabled) return;
  try {
    const audio = getContext();
    if (audio?.state === 'suspended') void audio.resume().catch(() => {});
  } catch { /* Unsupported audio must never break input. */ }
}

function getContext() {
  if (typeof window === 'undefined') return null;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  if (!context || context.state === 'closed') context = new AudioContext();
  return context;
}

if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', unlockAudio, { passive: true });
  document.addEventListener('keydown', unlockAudio);
}

export function playCue(kind) {
  try {
    if (!enabled || (typeof document !== 'undefined' && document.hidden)) return;
    const audio = getContext();
    if (!audio) return;
    if (audio.state === 'suspended') void audio.resume().catch(() => {});
    const start = audio.currentTime;
    const patterns = {
      start: { notes:[392,523.25,659.25], step:.09, length:.18, type:'triangle', gain:.07 },
      reveal: { notes:[523.25,659.25], step:.08, length:.16, type:'triangle', gain:.06 },
      hit: { notes:[150,105,82], step:.055, length:.13, type:'square', gain:.045 },
      block: { notes:[260,390], step:.07, length:.14, type:'triangle', gain:.055 },
      tick: { notes:[880], step:.04, length:.075, type:'square', gain:.032 },
      lock: { notes:[330,220], step:.045, length:.10, type:'triangle', gain:.04 },
      target: { notes:[520,760], step:.045, length:.10, type:'triangle', gain:.032 },
      item: { notes:[392,587.33,783.99], step:.055, length:.15, type:'triangle', gain:.045 },
      grab: { notes:[330,523.25,698.46], step:.04, length:.11, type:'triangle', gain:.04 },
      itemClaim: { notes:[493.88,659.25,987.77], step:.05, length:.15, type:'triangle', gain:.05 },
      itemClash: { notes:[220,174.61,220], step:.045, length:.12, type:'square', gain:.035 },
      heal: { notes:[440,659.25,880], step:.06, length:.17, type:'triangle', gain:.05 },
      swing: { notes:[150,110,440,659.25], step:.045, length:.14, type:'triangle', gain:.045 },
      ready: { notes:[440,660], step:.055, length:.11, type:'triangle', gain:.03 },
      menuTap: { notes:[310,465], step:.032, length:.075, type:'triangle', gain:.022 },
      menuSoft: { notes:[420], step:.03, length:.06, type:'triangle', gain:.016 },
      menuMove: { notes:[360,480], step:.05, length:.10, type:'triangle', gain:.022 },
      menuEnter: { notes:[392,523.25,659.25], step:.055, length:.14, type:'triangle', gain:.035 },
      gameTap: { notes:[293.66,392], step:.028, length:.075, type:'triangle', gain:.024 },
      confirm: { notes:[523.25,659.25], step:.045, length:.105, type:'triangle', gain:.028 },
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
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(at); oscillator.stop(at + pattern.length + .02);
    });
  } catch { /* Audio is an enhancement; it must never block a round. */ }
}
