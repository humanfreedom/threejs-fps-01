// Sound, all procedural WebAudio: no audio files, no network. A tiny synth per
// event — a noise burst through a low-pass for a shot, a sine blip for a hit,
// a rising beep for the spike — with distance attenuation by a gain the caller
// passes. AudioContext starts on the first user gesture.
export function createAudio() {
  let ctx = null;
  let master = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') void ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext ?? window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      return true;
    } catch {
      return false;
    }
  }

  function noiseBuffer(seconds) {
    const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * seconds)), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function burst(duration, filterFreq, gain, when = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(duration);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter).connect(g).connect(master);
    src.start(t);
    src.stop(t + duration);
  }

  function tone(freq, duration, type, gain, slideTo = 0, when = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + duration);
  }

  return {
    unlock() { ensure(); },
    shot(kind, distance = 0) {
      const atten = Math.max(0.08, 1 - distance / 70);
      if (kind === 'sniper') { burst(0.28, 900, 0.55 * atten); tone(140, 0.18, 'sine', 0.4 * atten, 50); }
      else if (kind === 'smg') burst(0.09, 1800, 0.3 * atten);
      else if (kind === 'pistol') burst(0.1, 1400, 0.35 * atten);
      else burst(0.14, 1200, 0.45 * atten);
    },
    dryFire() { tone(900, 0.05, 'square', 0.08); },
    reload() {
      tone(500, 0.06, 'square', 0.12);
      tone(700, 0.06, 'square', 0.12, 0, 0.35);
    },
    hit(head) {
      tone(head ? 1500 : 1100, 0.07, 'sine', 0.25);
      if (head) tone(2000, 0.09, 'sine', 0.2, 0, 0.05);
    },
    hurt() { tone(180, 0.18, 'sawtooth', 0.25, 90); },
    kill() { tone(700, 0.1, 'sine', 0.25, 1400); },
    plantBeep() { tone(1200, 0.12, 'square', 0.2); },
    spikeTick() { tone(1000, 0.06, 'square', 0.15); },
    explosion(distance = 0) {
      const atten = Math.max(0.15, 1 - distance / 90);
      burst(0.7, 300, 0.9 * atten);
      tone(70, 0.6, 'sine', 0.6 * atten, 30);
    },
    roundWin() {
      tone(523, 0.16, 'sine', 0.25);
      tone(659, 0.16, 'sine', 0.25, 0, 0.14);
      tone(784, 0.3, 'sine', 0.28, 0, 0.28);
    },
    roundLose() {
      tone(392, 0.18, 'sine', 0.22);
      tone(311, 0.3, 'sine', 0.22, 0, 0.16);
    },
    buy() { tone(880, 0.08, 'sine', 0.2); tone(1320, 0.1, 'sine', 0.18, 0, 0.07); },
    deny() { tone(220, 0.12, 'square', 0.15); },
  };
}
