// 소리와 진동. 음원 파일 없이 Web Audio로 합성한다.
(function (root) {
  'use strict';

  let ctx = null;
  let noiseBuf = null;

  function audio() {
    if (!ctx) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC(); } catch (e) { return null; }
    }
    return ctx;
  }

  function tone(freq, startIn, duration, type = 'sine', peak = 0.2, slideTo = null) {
    const c = audio();
    if (!c) return;
    const t0 = c.currentTime + startIn;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + duration);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  // 걸러 낸 잡음. 낮게 걸러 길게 내면 폭발, 높게 짧게 내면 카드 스치는 소리가 된다.
  function noise(startIn, duration, type, from, to, peak) {
    const c = audio();
    if (!c) return;
    if (!noiseBuf) {
      noiseBuf = c.createBuffer(1, Math.floor(c.sampleRate * 1.5), c.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t0 = c.currentTime + startIn;
    const src = c.createBufferSource();
    const filter = c.createBiquadFilter();
    const gain = c.createGain();
    src.buffer = noiseBuf;
    filter.type = type;
    filter.Q.value = 0.9;
    filter.frequency.setValueAtTime(from, t0);
    filter.frequency.exponentialRampToValueAtTime(to, t0 + duration);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(filter).connect(gain).connect(c.destination);
    src.start(t0);
    src.stop(t0 + duration + 0.02);
  }

  const Sound = {
    unlock() {
      const c = audio();
      if (c && c.state === 'suspended') c.resume().catch(() => {});
    },
    play() {
      noise(0, 0.09, 'bandpass', 2400, 900, 0.18);
    },
    attack() {
      noise(0, 0.35, 'lowpass', 1800, 120, 0.5);
      tone(160, 0, 0.3, 'triangle', 0.25, 50);
    },
    bigAttack() {
      noise(0, 0.6, 'lowpass', 2600, 80, 0.6);
      tone(120, 0, 0.55, 'sawtooth', 0.18, 35);
      noise(0.18, 0.4, 'lowpass', 1400, 90, 0.4);
    },
    boom() {
      noise(0, 0.9, 'lowpass', 3200, 60, 0.7);
      tone(90, 0, 0.85, 'sine', 0.35, 30);
      tone(660, 0.05, 0.25, 'square', 0.06, 220);
    },
    caught() {
      tone(880, 0, 0.12, 'square', 0.12);
      tone(440, 0.12, 0.25, 'square', 0.12, 220);
    },
    call() {
      tone(700, 0, 0.1, 'square', 0.12);
      tone(1050, 0.1, 0.1, 'square', 0.12);
      tone(1400, 0.2, 0.16, 'square', 0.12);
    },
    myTurn() {
      tone(988, 0, 0.12, 'sine', 0.2);
      tone(1319, 0.1, 0.22, 'sine', 0.18);
    },
    vibrate(ms) {
      try { if (root.navigator && root.navigator.vibrate) root.navigator.vibrate(ms); } catch (e) { /* 진동 없음 */ }
    },
  };

  root.Sound = Sound;
})(this);
