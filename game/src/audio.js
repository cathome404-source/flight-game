// Garuda Skies — procedural WebAudio: engine hum, wind, chimes, impacts.
// Written fresh from the prose spec. No audio files: every sound is built
// from oscillators and a generated white-noise buffer. The AudioContext is
// created lazily on the first resume() (a user gesture) and every method
// is a safe no-op before that, or when WebAudio is unavailable.

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function createAudio() {
  let ctx = null;
  let master = null;
  let engineNodes = null; // { osc1, osc2, filter, gain }
  let windNodes = null; // { src, filter, gain }
  let noiseBuf = null;
  let muted = false;
  let engineWanted = false;
  let throttleVal = 0;
  let speedVal = 0;
  let windVal = 0;

  function audioCtor() {
    if (typeof window === 'undefined') return null;
    return window.AudioContext || window.webkitAudioContext || null;
  }

  function now() {
    return ctx ? ctx.currentTime : 0;
  }

  // setTargetAtTime when available, plain assignment otherwise.
  function ramp(param, value, tc) {
    if (!param) return;
    if (typeof param.setTargetAtTime === 'function') {
      param.setTargetAtTime(value, now(), tc || 0.08);
    } else {
      param.value = value;
    }
  }

  // Schedule a value on an AudioParam when the method exists; plain
  // assignment otherwise. Keeps one-shots from throwing on partial
  // AudioParam implementations.
  function setAt(param, value, t) {
    if (!param) return;
    if (typeof param.setValueAtTime === 'function') {
      param.setValueAtTime(value, t);
    } else {
      param.value = value;
    }
  }

  function rampTo(param, value, t, linear) {
    if (!param) return;
    if (linear && typeof param.linearRampToValueAtTime === 'function') {
      param.linearRampToValueAtTime(value, t);
    } else if (!linear && typeof param.exponentialRampToValueAtTime === 'function') {
      param.exponentialRampToValueAtTime(value, t);
    } else {
      param.value = value;
    }
  }

  function makeNoiseBuffer() {
    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function buildGraph() {
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(ctx.destination);

    noiseBuf = makeNoiseBuffer();

    // Engine: a sawtooth voice plus a sub sine, through a lowpass filter.
    // Pitch and brightness follow the throttle (applied in applyEngine).
    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.value = 52;
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = 26;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    filter.Q.value = 1;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    osc1.start();
    osc2.start();
    engineNodes = { osc1, osc2, filter, gain };

    // Wind: looped white noise through a bandpass filter; the level and
    // the filter frequency follow airspeed and the mission wind.
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const wfilter = ctx.createBiquadFilter();
    wfilter.type = 'bandpass';
    wfilter.frequency.value = 500;
    wfilter.Q.value = 0.6;
    const wgain = ctx.createGain();
    wgain.gain.value = 0;
    src.connect(wfilter);
    wfilter.connect(wgain);
    wgain.connect(master);
    src.start();
    windNodes = { src, filter: wfilter, gain: wgain };

    applyEngine();
    applyWind();
  }

  function applyEngine() {
    if (!engineNodes) return;
    const freq = 52 + throttleVal * 95;
    ramp(engineNodes.osc1.frequency, freq);
    ramp(engineNodes.osc2.frequency, freq * 0.5);
    ramp(engineNodes.filter.frequency, 350 + throttleVal * 1100, 0.15);
    ramp(
      engineNodes.gain.gain,
      engineWanted ? 0.045 + throttleVal * 0.085 : 0,
      0.12
    );
  }

  function applyWind() {
    if (!windNodes) return;
    const fromSpeed = clamp01(speedVal / 88) * 0.22;
    const fromWind = clamp01(windVal / 14) * 0.1;
    ramp(windNodes.gain.gain, fromSpeed + fromWind, 0.2);
    ramp(windNodes.filter.frequency, 350 + speedVal * 9 + windVal * 12, 0.2);
  }

  // One short pitched note: quick attack, exponential decay.
  function tone(freq, delay, dur, type, vol) {
    if (!ctx || !master) return;
    const t0 = now() + delay;
    const osc = ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    setAt(gain.gain, 0.0001, t0);
    rampTo(gain.gain, vol, t0 + 0.015, true);
    rampTo(gain.gain, 0.0001, t0 + dur, false);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  // A burst of filtered noise (touchdown thud body, crash roar).
  function noiseHit(dur, filterFreq, vol) {
    if (!ctx || !master || !noiseBuf) return;
    const t0 = now();
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    setAt(gain.gain, vol, t0);
    rampTo(gain.gain, 0.0001, t0 + dur, false);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  // A low sine thump whose pitch falls (touchdown, crash boom).
  function thump(freqStart, freqEnd, dur, vol) {
    if (!ctx || !master) return;
    const t0 = now();
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    setAt(osc.frequency, freqStart, t0);
    rampTo(osc.frequency, freqEnd, t0 + dur, false);
    const gain = ctx.createGain();
    setAt(gain.gain, vol, t0);
    rampTo(gain.gain, 0.0001, t0 + dur, false);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  return {
    // Create (or wake) the AudioContext. Call from a user gesture.
    resume() {
      const AC = audioCtor();
      if (!AC) return;
      if (!ctx) {
        ctx = new AC();
        buildGraph();
      }
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        ctx.resume();
      }
    },

    setMuted(m) {
      muted = !!m;
      if (master) ramp(master.gain, muted ? 0 : 0.9, 0.05);
    },

    // Throttle 0..1: engine pitch and loudness follow it.
    setThrottle(v) {
      throttleVal = clamp01(v || 0);
      if (ctx) applyEngine();
    },

    // Airspeed in m/s: wind noise follows it.
    setSpeed(v) {
      speedVal = Math.max(0, v || 0);
      if (ctx) applyWind();
    },

    // Mission wind in m/s: adds to the wind noise.
    setWind(v) {
      windVal = Math.max(0, v || 0);
      if (ctx) applyWind();
    },

    // Start or stop the engine hum.
    engine(on) {
      engineWanted = !!on;
      if (ctx) applyEngine();
    },

    // Two-note chime for flying through a ring.
    ring() {
      tone(880, 0, 0.4, 'sine', 0.22);
      tone(1318.5, 0.09, 0.55, 'sine', 0.18);
    },

    // Short rising arpeggio for a checkpoint.
    checkpoint() {
      const notes = [660, 880, 1174.7];
      for (let i = 0; i < notes.length; i++) {
        tone(notes[i], i * 0.07, 0.3, 'triangle', 0.2);
      }
    },

    // Low thud; a hard touchdown is louder and heavier.
    touchdown(hard) {
      noiseHit(0.22, 320, hard ? 0.5 : 0.28);
      thump(75, 38, 0.28, hard ? 0.55 : 0.3);
    },

    // Loud noise roar plus a deep falling boom.
    crash() {
      noiseHit(0.9, 700, 0.7);
      thump(65, 26, 1.0, 0.8);
      noiseHit(0.5, 240, 0.4);
    },

    // Four-note success jingle on mission complete.
    success() {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      for (let i = 0; i < notes.length; i++) {
        tone(notes[i], i * 0.12, 0.45, 'triangle', 0.22);
      }
    },
  };
}
