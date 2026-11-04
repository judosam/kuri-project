/**
 * Web Audio API Notification Sound Engine for Field Verifier Portal.
 * Clean two-tone alert chime (587 Hz [D5] -> 880 Hz [A5])
 * with zero external audio assets.
 */

const STORAGE_KEY_MUTED = 'kuri_verifier_sound_muted';

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!audioCtx) {
    audioCtx = new AudioContextClass();
  }
  return audioCtx;
}

// Browser user-gesture unlock
if (typeof window !== 'undefined') {
  const unlockAudio = () => {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    window.removeEventListener('click', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
    window.removeEventListener('touchstart', unlockAudio);
  };

  window.addEventListener('click', unlockAudio, { passive: true });
  window.addEventListener('keydown', unlockAudio, { passive: true });
  window.addEventListener('touchstart', unlockAudio, { passive: true });
}

export function isNotificationSoundMuted(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(STORAGE_KEY_MUTED) === 'true';
}

export function setNotificationSoundMuted(muted: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY_MUTED, muted ? 'true' : 'false');
}

export function playNotificationSound(): void {
  if (isNotificationSoundMuted()) return;

  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      ctx.resume().then(() => playChime(ctx)).catch(() => {});
    } else {
      playChime(ctx);
    }
  } catch (err) {
    console.warn('[SoundEngine] Could not play notification chime:', err);
  }
}

function playChime(ctx: AudioContext): void {
  const now = ctx.currentTime;

  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(0.32, now);
  masterGain.connect(ctx.destination);

  // Tone 1: 587 Hz (D5)
  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(587.33, now);

  gain1.gain.setValueAtTime(0.001, now);
  gain1.gain.exponentialRampToValueAtTime(0.35, now + 0.02);
  gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

  osc1.connect(gain1);
  gain1.connect(masterGain);
  osc1.start(now);
  osc1.stop(now + 0.17);

  // Tone 2: 880 Hz (A5)
  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(880.0, now + 0.1);

  gain2.gain.setValueAtTime(0.001, now + 0.1);
  gain2.gain.exponentialRampToValueAtTime(0.4, now + 0.12);
  gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);

  osc2.connect(gain2);
  gain2.connect(masterGain);
  osc2.start(now + 0.1);
  osc2.stop(now + 0.46);
}
