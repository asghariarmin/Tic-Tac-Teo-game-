// Each note specifies a frequency, an offset, and a duration in seconds.
const effects = {
  menu: { wave: 'triangle', volume: 0.14, notes: [[659.25, 0, 0.055], [880, 0.035, 0.045]] },
  X: { wave: 'square', volume: 0.075, notes: [[392, 0, 0.055], [587.33, 0.045, 0.085]] },
  O: { wave: 'sine', volume: 0.22, notes: [[523.25, 0, 0.065], [261.63, 0.055, 0.1]] },
  win: {
    wave: 'triangle', volume: 0.23,
    notes: [[523.25, 0, 0.12], [659.25, 0.09, 0.12], [783.99, 0.18, 0.14], [1046.50, 0.29, 0.28], [783.99, 0.29, 0.24]],
  },
  loss: {
    wave: 'triangle', volume: 0.24,
    notes: [[392, 0, 0.15], [311.13, 0.12, 0.17], [233.08, 0.24, 0.28]],
  },
};

let context;
let master;
let resuming;
let enabled = true;

// Call from a direct user action so browsers can allow later CPU and LAN sounds.
export function unlockSound() {
  if (!enabled) return;
  try {
    if (!context) {
      const AudioContext = window.AudioContext ?? window.webkitAudioContext;
      if (!AudioContext) return;
      context = new AudioContext();
      master = context.createGain();
      master.connect(context.destination);
    }
    if (context.state !== 'running' && !resuming) {
      resuming = context.resume().catch(() => {}).finally(() => { resuming = null; });
    }
  } catch {
    // The game can continue on devices where audio is unavailable.
  }
}

export function setSoundEnabled(value) {
  enabled = value;
  if (master) master.gain.setValueAtTime(value ? 1 : 0, context.currentTime);
}

function schedule(effect, delay) {
  if (!enabled || context?.state !== 'running') return;
  const start = context.currentTime + delay;
  for (const [frequency, offset, duration] of effect.notes) {
    const at = start + offset;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = effect.wave;
    oscillator.frequency.value = frequency;
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(effect.volume, at + 0.009);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(envelope);
    envelope.connect(master);
    oscillator.onended = () => {
      oscillator.disconnect();
      envelope.disconnect();
    };
    oscillator.start(at);
    oscillator.stop(at + duration);
  }
}

export function playSound(name, delay = 0) {
  if (!enabled) return;
  const effect = effects[name];
  if (resuming) resuming.then(() => schedule(effect, delay));
  else schedule(effect, delay);
}
