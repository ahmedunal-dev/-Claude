/* Rift Runner — a one-finger, fast-paced neon dodger.
 * Drag to steer. Skim hazards for close calls, chain shards for a multiplier,
 * fill the ring to trigger Overdrive and smash through everything. */
'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const cvs = $('game');
  const ctx = cvs.getContext('2d');
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const sign = () => (Math.random() < 0.5 ? -1 : 1);
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const COL = {
    hazard: '#ff2e6a', hazard2: '#ff8a2e', mine: '#ff4fd8', shard: '#ffd23f',
    shield: '#7cf6ff', magnet: '#c08cff', slow: '#9dff3c', ink: '#f3ecff', dim: '#9a8fc4',
  };
  const ZONES = [
    { bg: '#0c0622', grid: '#4a2a9a' },
    { bg: '#041330', grid: '#1f5fa8' },
    { bg: '#1c0424', grid: '#8a237a' },
    { bg: '#03201c', grid: '#1a7a66' },
    { bg: '#220c06', grid: '#8a4a1a' },
    { bg: '#10101e', grid: '#5a5a9a' },
  ];

  // ---------- colour helpers ----------
  const rgbCache = new Map();
  function hexRgb(hex) {
    let v = rgbCache.get(hex);
    if (!v) {
      const n = parseInt(hex.slice(1), 16);
      v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      rgbCache.set(hex, v);
    }
    return v;
  }
  const rgba = (hex, a) => { const c = hexRgb(hex); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; };
  function mixHex(a, b, t) {
    const x = hexRgb(a), y = hexRgb(b);
    const c = x.map((v, i) => Math.round(lerp(v, y[i], t)));
    return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  }
  function hslHex(h, s, l) {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
    return '#' + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  // ---------- persistence ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('riftrunner_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('riftrunner_' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  };
  const save = Object.assign({ best: 0, coins: 0, owned: [0], skin: 0, muted: false, games: 0 }, store.get('save', {}));
  const persist = () => store.set('save', save);

  const SKINS = [
    { name: 'Volt', cost: 0, c1: '#2ef2ff', c2: '#ff2e6a' },
    { name: 'Ember', cost: 500, c1: '#ff9a3c', c2: '#ffd23f' },
    { name: 'Toxin', cost: 1500, c1: '#9dff3c', c2: '#2ef2ff' },
    { name: 'Royal', cost: 3500, c1: '#c08cff', c2: '#ff4fd8' },
    { name: 'Ghost', cost: 7500, c1: '#ffffff', c2: '#8aa0ff' },
    { name: 'Prism', cost: 15000, c1: null, c2: null },
  ];
  function skinColors(i, t) {
    const s = SKINS[i] || SKINS[0];
    if (s.c1) return [s.c1, s.c2];
    const h = Math.round((t * 120) / 15) * 15;
    return [hslHex(h % 360, 100, 62), hslHex((h + 150) % 360, 100, 62)];
  }

  // ---------- haptics ----------
  function haptic(kind) {
    try {
      const Hp = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics;
      if (Hp) { Hp.impact({ style: kind === 'heavy' ? 'HEAVY' : kind === 'medium' ? 'MEDIUM' : 'LIGHT' }); return; }
      if (navigator.vibrate) navigator.vibrate(kind === 'heavy' ? 45 : kind === 'medium' ? 18 : 8);
    } catch (e) { /* no haptics */ }
  }

  // ---------- audio: synthesized SFX + a tiny procedural soundtrack ----------
  const Sound = (() => {
    let ac = null, master = null, music = null, noiseBuf = null;
    let muted = !!save.muted;
    const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

    function init() {
      if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        ac = new AC();
        master = ac.createGain();
        master.gain.value = muted ? 0 : 0.55;
        master.connect(ac.destination);
        music = ac.createGain();
        music.gain.value = 0;
        music.connect(master);
        noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      } catch (e) { ac = null; }
    }
    function tone(f, dur, o = {}) {
      if (!ac) return;
      const t = o.t != null ? o.t : ac.currentTime + (o.at || 0);
      const osc = ac.createOscillator(), g = ac.createGain();
      osc.type = o.type || 'square';
      osc.frequency.setValueAtTime(f, t);
      if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
      g.gain.setValueAtTime(o.vol != null ? o.vol : 0.12, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      let node = osc;
      if (o.lp) { const f2 = ac.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = o.lp; f2.Q.value = 6; osc.connect(f2); node = f2; }
      node.connect(g); g.connect(o.dest || master);
      osc.start(t); osc.stop(t + dur + 0.03);
    }
    function noise(dur, o = {}) {
      if (!ac) return;
      const t = o.t != null ? o.t : ac.currentTime + (o.at || 0);
      const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
      const f = ac.createBiquadFilter();
      f.type = o.type || 'lowpass';
      f.frequency.setValueAtTime(o.freq || 1500, t);
      if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
      f.Q.value = o.q || 0.8;
      const g = ac.createGain();
      g.gain.setValueAtTime(o.vol != null ? o.vol : 0.2, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(o.dest || master);
      s.start(t); s.stop(t + dur + 0.03);
    }

    // sequencer
    const BPM = 136, STEP = 60 / BPM / 4;
    const ROOTS = [45, 41, 48, 43];
    let timer = null, nextT = 0, step = 0, intensity = 0, pitch = 0;
    const lastAt = {};
    function limit(k, gap) {
      const n = performance.now();
      if ((lastAt[k] || 0) + gap * 1000 > n) return false;
      lastAt[k] = n;
      return true;
    }
    function schedule() {
      if (!ac) return;
      while (nextT < ac.currentTime + 0.12) {
        const s = step % 16, bar = Math.floor(step / 16) % 4, root = ROOTS[bar] + pitch;
        if (s % 4 === 0) tone(150, 0.16, { type: 'sine', to: 40, vol: 0.55, t: nextT, dest: music });
        if (s % 4 === 2) noise(0.05, { type: 'highpass', freq: 7000, vol: 0.12, t: nextT, dest: music });
        if (intensity > 0.25 && s % 2 === 1) noise(0.03, { type: 'highpass', freq: 9000, vol: 0.05, t: nextT, dest: music });
        if (intensity > 0.45 && (s === 4 || s === 12)) noise(0.12, { type: 'bandpass', freq: 1800, q: 1.2, vol: 0.18, t: nextT, dest: music });
        if (s % 2 === 0) tone(mtof(root + (s % 8 === 6 ? 12 : 0)), STEP * 1.7, { type: 'sawtooth', vol: 0.09, lp: 380 + intensity * 900, t: nextT, dest: music });
        if (intensity > 0.65 && (s === 3 || s === 10 || s === 14)) tone(mtof(root + 24 + pick([0, 3, 7, 10])), STEP * 1.5, { type: 'square', vol: 0.035, t: nextT, dest: music });
        nextT += STEP; step++;
      }
    }
    return {
      init,
      get muted() { return muted; },
      setMuted(m) {
        muted = m; save.muted = m; persist();
        if (master) master.gain.setTargetAtTime(m ? 0 : 0.55, ac.currentTime, 0.02);
      },
      startMusic() {
        if (!ac || timer) return;
        nextT = ac.currentTime + 0.06; step = 0;
        music.gain.cancelScheduledValues(ac.currentTime);
        music.gain.setTargetAtTime(0.5, ac.currentTime, 0.1);
        timer = setInterval(schedule, 25);
      },
      stopMusic() {
        if (!ac) return;
        clearInterval(timer); timer = null;
        music.gain.cancelScheduledValues(ac.currentTime);
        music.gain.setTargetAtTime(0, ac.currentTime, 0.05);
      },
      setIntensity(v, p) { intensity = v; pitch = p || 0; },
      shard(n) {
        const sc = [0, 2, 4, 7, 9];
        const semi = Math.min(30, sc[n % 5] + 12 * Math.floor(n / 5));
        tone(mtof(76 + semi), 0.09, { type: 'triangle', vol: 0.16 });
        tone(mtof(88 + semi), 0.05, { type: 'square', vol: 0.03 });
      },
      near() {
        noise(0.2, { type: 'bandpass', freq: 3200, to: 600, q: 2, vol: 0.32 });
        tone(500, 0.12, { type: 'sine', to: 1300, vol: 0.08 });
      },
      mult() { [0, 4, 7, 12].forEach((s, i) => tone(mtof(84 + s), 0.08, { type: 'square', vol: 0.05, at: i * 0.04 })); },
      power() { [0, 7, 12, 19].forEach((s, i) => tone(mtof(72 + s), 0.12, { type: 'triangle', vol: 0.14, at: i * 0.05 })); },
      overdrive() {
        tone(180, 0.5, { type: 'sawtooth', to: 900, vol: 0.12, lp: 2400 });
        noise(0.5, { type: 'bandpass', freq: 400, to: 4000, q: 1, vol: 0.25 });
      },
      smash() { noise(0.18, { freq: 2500, to: 200, vol: 0.3 }); tone(220, 0.12, { type: 'square', to: 80, vol: 0.06 }); },
      shieldBreak() { noise(0.3, { type: 'highpass', freq: 1800, vol: 0.3 }); tone(900, 0.25, { type: 'triangle', to: 200, vol: 0.12 }); },
      laserWarn() { tone(1200, 0.06, { type: 'square', vol: 0.04 }); tone(1200, 0.06, { type: 'square', vol: 0.04, at: 0.12 }); },
      laserFire() { noise(0.35, { type: 'bandpass', freq: 900, q: 4, vol: 0.25 }); tone(90, 0.35, { type: 'sawtooth', vol: 0.08 }); },
      death() {
        noise(1.0, { freq: 3000, to: 60, vol: 0.55 });
        tone(260, 0.7, { type: 'sawtooth', to: 35, vol: 0.14 });
      },
      zone() { [0, 5, 7, 12, 17].forEach((s, i) => tone(mtof(69 + s), 0.14, { type: 'triangle', vol: 0.1, at: i * 0.06 })); },
      click() { tone(700, 0.04, { type: 'square', vol: 0.05 }); },
      shoot() { if (limit('shoot', 0.09)) tone(1500, 0.04, { type: 'square', to: 700, vol: 0.018 }); },
      beam() { if (limit('beam', 0.12)) noise(0.12, { type: 'bandpass', freq: 2400, q: 6, vol: 0.05 }); },
      hit() { if (limit('hit', 0.06)) noise(0.04, { type: 'highpass', freq: 3000, vol: 0.06 }); },
      eshot() { if (limit('eshot', 0.08)) tone(520, 0.08, { type: 'triangle', to: 260, vol: 0.05 }); },
      dash() { noise(0.25, { type: 'bandpass', freq: 600, to: 2600, q: 2, vol: 0.18 }); },
      enemyDie() { if (!limit('edie', 0.04)) return; noise(0.22, { freq: 2600, to: 180, vol: 0.24 }); tone(420, 0.14, { type: 'square', to: 90, vol: 0.05 }); },
      pickup() { for (let i = 0; i < 7; i++) tone(mtof(72 + pick([0, 3, 5, 7, 10, 12, 15])), 0.07, { type: 'square', vol: 0.05, at: i * 0.045 }); tone(mtof(91), 0.3, { type: 'triangle', vol: 0.14, at: 0.32 }); },
      alarm() { for (let i = 0; i < 4; i++) { tone(620, 0.22, { type: 'sawtooth', to: 880, vol: 0.07, lp: 2200, at: i * 0.5 }); } },
      bossIn() { tone(70, 1.2, { type: 'sawtooth', to: 45, vol: 0.2, lp: 400 }); noise(1.0, { freq: 300, to: 1200, vol: 0.2 }); },
      bossDie() { tone(300, 1.4, { type: 'sawtooth', to: 30, vol: 0.18, lp: 1500 }); },
      bossBoom() { noise(1.6, { freq: 4000, to: 50, vol: 0.6 }); [0, 4, 7, 12, 16, 19, 24].forEach((st, i) => tone(mtof(72 + st), 0.18, { type: 'triangle', vol: 0.12, at: 0.3 + i * 0.07 })); },
      buy() { [0, 4, 7, 12, 16].forEach((s, i) => tone(mtof(79 + s), 0.1, { type: 'triangle', vol: 0.12, at: i * 0.045 })); },
    };
  })();

  // ---------- canvas sizing ----------
  let W = 0, H = 0, DPR = 1, U = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    cvs.width = Math.round(W * DPR); cvs.height = Math.round(H * DPR);
    U = clamp(Math.min(W / 400, H / 720), 0.8, 1.7);
    P.r = 13 * U;
    if (state.mode === 'menu' || !g) { P.x = P.tx = W / 2; P.y = P.ty = H * 0.56; }
    P.tx = clamp(P.tx, P.r, W - P.r);
    P.ty = clamp(P.ty, H * 0.3, H - P.r * 3);
    initStars();
    placeMenuShip();
  }

  // ---------- glow sprites ----------
  const glowCache = new Map();
  function glowSprite(color) {
    let c = glowCache.get(color);
    if (!c) {
      c = document.createElement('canvas');
      c.width = c.height = 64;
      const x = c.getContext('2d');
      const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, rgba(color, 0.85));
      gr.addColorStop(0.3, rgba(color, 0.32));
      gr.addColorStop(1, rgba(color, 0));
      x.fillStyle = gr;
      x.fillRect(0, 0, 64, 64);
      glowCache.set(color, c);
    }
    return c;
  }
  function glow(x, y, rad, color, alpha = 1) {
    ctx.globalAlpha = alpha;
    ctx.drawImage(glowSprite(color), x - rad, y - rad, rad * 2, rad * 2);
    ctx.globalAlpha = 1;
  }

  // ---------- world state ----------
  const state = { mode: 'menu' }; // menu | play | dying | over | paused | shop
  let g = null;
  const P = { x: 0, y: 0, tx: 0, ty: 0, r: 13, vx: 0, trail: [] };
  const obstacles = [], shards = [], powerups = [], particles = [], texts = [];
  let stars = [];
  let shake = 0, flash = 0, flashColor = '#ffffff', hitstop = 0, tsDip = 0;
  let bgScroll = 0, clock = 0, zoneIdx = 0, zoneFrom = 0, zoneBlend = 1, menuShipY = 0;
  // park the idle ship in the empty band between the tagline and the stats
  function placeMenuShip() {
    const a = document.querySelector('#menu .tag'), b = document.querySelector('#menu .stats');
    if (!a || !b || a.offsetParent === null) { menuShipY = H * 0.56; return; }
    const top = a.getBoundingClientRect().bottom, bot = b.getBoundingClientRect().top;
    menuShipY = bot - top > 60 ? (top + bot) / 2 : H * 0.56;
  }

  function initStars() {
    stars = [];
    const n = Math.round((W * H) / 5200);
    for (let i = 0; i < n; i++) stars.push({ x: Math.random() * W, y: Math.random() * H, z: rand(0.15, 1) });
  }

  function newRun() {
    g = {
      t: 0, score: 0, speed: 0, cursor: 0, need: H * 0.25,
      shards: 0, banked: 0, combo: 0, comboT: 0, mult: 1,
      meter: 0, overdrive: 0, odCount: 0, odCool: 0, shield: false, magnet: 0, slow: 0, invuln: 0.6,
      near: 0, revived: false, zone: 0, lastLaser: -99, lastPower: 0,
      tutorial: save.games < 3 ? 4 : 0, dying: 0, banner: null,
      level: 1, phase: 'run', phaseT: 0, runLen: 30, rt: 0,
      enemyT: 3, dropT: 8.01, weapon: { kind: 'blaster', tier: 1 }, fireT: 0, beam: null,
      kills: 0, bosses: 0,
    };
    resetCombat();
    obstacles.length = shards.length = powerups.length = particles.length = texts.length = 0;
    P.r = 13 * U;
    P.x = P.tx = W / 2; P.y = P.ty = H * 0.78; P.trail.length = 0; P.vx = 0;
    zoneIdx = 0; zoneFrom = 0; zoneBlend = 1;
  }

  const diff = () => 1 - Math.exp(-g.rt / 65);
  // keeps ramping after diff() saturates, so long runs always end
  const late = () => clamp((g.rt - 75) / 150, 0, 1);
  const OD_TIME = 3.5, OD_COOL = 8;
  function addMeter(v) {
    if (g.overdrive > 0 || g.odCool > 0) return;
    g.meter = Math.min(1, g.meter + v / (1 + 0.6 * g.odCount));
    if (g.meter >= 1) startOverdrive();
  }

  // ---------- spawning ----------
  function weighted(list) {
    let sum = 0;
    for (const [, w] of list) sum += w;
    let r = Math.random() * sum;
    for (const [k, w] of list) { if ((r -= w) <= 0) return k; }
    return list[0][0];
  }

  function addRect(x, y, w, h, extra) {
    const o = Object.assign({ type: 'rect', x, y, w, h, vx: 0, color: COL.hazard, near: false, nearDone: false }, extra);
    obstacles.push(o);
    return o;
  }

  function spawnPattern() {
    const d = diff();
    const opts = [['blocks', 1.0]];
    if (g.rt > 4) opts.push(['wall', 0.9]);
    if (g.rt > 12) opts.push(['spinner', 0.75]);
    if (g.rt > 24) opts.push(['mines', 0.6]);
    if (g.rt > 34 && g.t - g.lastLaser > 5) opts.push(['laser', 0.6 + late() * 0.4]);
    const kind = weighted(opts);
    const top = -12 * U;
    let extent = 0, lane = null;

    if (kind === 'blocks') {
      const n = Math.random() < 0.3 + d * 0.5 ? (Math.random() < d * 0.6 ? 3 : 2) : 1;
      const h = 26 * U, minGap = 74 * U;
      let placed = null;
      for (let tries = 0; tries < 25 && !placed; tries++) {
        const bs = [];
        for (let i = 0; i < n; i++) { const w = rand(54, 125) * U; bs.push({ x: rand(-w * 0.25, W - w * 0.75), w }); }
        const iv = bs.map((b) => [Math.max(0, b.x), Math.min(W, b.x + b.w)]).sort((a, b) => a[0] - b[0]);
        let cur = 0, best = 0, bestMid = 0;
        for (const [a, b] of iv) { if (a - cur > best) { best = a - cur; bestMid = (a + cur) / 2; } cur = Math.max(cur, b); }
        if (W - cur > best) { best = W - cur; bestMid = (W + cur) / 2; }
        if (best >= minGap) placed = { bs, mid: bestMid };
      }
      if (!placed) placed = { bs: [{ x: rand(0, W - 100 * U), w: 100 * U }], mid: W / 2 };
      for (const b of placed.bs) {
        const moving = d > 0.45 && Math.random() < 0.3;
        addRect(b.x, top - h, b.w, h, { vx: moving ? rand(50, 110) * U * sign() : 0, bounce: moving });
      }
      extent = h;
      lane = placed.mid;
    } else if (kind === 'wall') {
      const h = 22 * U;
      const gapW = (lerp(132, 84, d) - 12 * late()) * U;
      const gx = rand(gapW / 2 + 12 * U, W - gapW / 2 - 12 * U);
      const moving = d > 0.3 && Math.random() < 0.45;
      const osc = moving ? { amp: rand(30, 70) * U, f: rand(1.4, 2.6), ph: Math.random() * TAU } : null;
      const grp = { near: false, nearDone: false, gx, gapW };
      const span = W * 1.6;
      addRect(gx - gapW / 2 - span, top - h, span, h, { x0: gx - gapW / 2 - span, osc, group: grp, color: COL.hazard });
      addRect(gx + gapW / 2, top - h, span, h, { x0: gx + gapW / 2, osc, group: grp, color: COL.hazard });
      extent = h;
      lane = gx;
      // shards threading the gap
      if (!moving) for (let i = 0; i < 3; i++) addShard(gx, top - h / 2 - i * 30 * U);
      else addShard(gx, top - h - 40 * U);
    } else if (kind === 'spinner') {
      const twin = d > 0.5 && Math.random() < 0.4;
      const len = (twin ? rand(95, 115) : rand(115, 165)) * U;
      const cy = top - len / 2;
      const make = (cx) => obstacles.push({
        type: 'spin', x: cx, y: cy, len, th: 11 * U, ang: Math.random() * TAU,
        av: rand(1.5, 2.3 + d * 1.6) * sign(), color: COL.hazard2, near: false, nearDone: false,
      });
      if (twin) { make(W * 0.24); make(W * 0.76); lane = W / 2; }
      else {
        const cx = rand(W * 0.3, W * 0.7); make(cx);
        lane = cx < W / 2 ? cx + len / 2 + 40 * U : cx - len / 2 - 40 * U;
        if (Math.random() < 0.6) {
          const rr = len / 2 + 30 * U;
          for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; addShard(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
        }
      }
      extent = len;
    } else if (kind === 'mines') {
      const n = 2 + Math.round(Math.random() * (1 + d * 2));
      for (let i = 0; i < n; i++) {
        obstacles.push({
          type: 'mine', x: rand(20 * U, W - 20 * U), y: top - rand(12, 100) * U, r: 12 * U,
          vx: rand(50, 120 + d * 80) * U * sign(), spin: Math.random() * TAU,
          color: COL.mine, near: false, nearDone: false,
        });
      }
      extent = 112 * U;
    } else if (kind === 'laser') {
      g.lastLaser = g.t;
      const count = late() > 0.4 && Math.random() < 0.35 ? 3 : d > 0.45 && Math.random() < 0.5 ? 2 : 1;
      const xs = [];
      for (let i = 0; i < count; i++) {
        let x = i === 0 ? clamp(P.x, 30 * U, W - 30 * U) : rand(30 * U, W - 30 * U);
        for (let tries = 0; tries < 12; tries++) {
          if (laserSafe(x) && xs.every((o) => Math.abs(o - x) > 90 * U)) break;
          x = rand(30 * U, W - 30 * U);
        }
        xs.push(x);
        obstacles.push({ type: 'laser', x, w: 20 * U, age: 0, warn: lerp(1.0, 0.75, d), dur: 0.4, fired: false, color: COL.hazard, near: false, nearDone: false });
      }
      Sound.laserWarn();
      extent = 0;
      g.need = g.speed * 0.55; // keep the lane clear while the beam is up
    }

    const gap = lerp(250, 135, d) * (1 - 0.25 * late()) * 1.1 * U;
    if (kind !== 'laser') g.need = extent + gap;
    g.cursor = 0;

    // reward in the space before the next pattern
    const midY = top - extent - gap / 2;
    if (kind !== 'laser') {
      if (g.rt > 8 && g.t - g.lastPower > 20 && Math.random() < 0.12) {
        g.lastPower = g.t;
        powerups.push({ x: clamp(lane ?? rand(40 * U, W - 40 * U), 40 * U, W - 40 * U), y: midY, kind: pick(['shield', 'magnet', 'slow']), t: 0 });
      } else if (Math.random() < 0.7) {
        shardLine(lane ?? W / 2, midY);
      }
    }
  }

  function laserSafe(x) {
    for (const o of obstacles) {
      if (o.group && o.y < P.y && Math.abs(x - o.group.gx) < o.group.gapW / 2 + 34 * U) return false;
    }
    return true;
  }

  function addShard(x, y) {
    if (x < 14 * U || x > W - 14 * U) return;
    shards.push({ x, y, a: Math.random() * TAU });
  }

  function shardLine(cx, cy) {
    const n = 5, sp = 24 * U;
    const shape = pick(['line', 'diag', 'wave']);
    const dir = sign();
    cx = clamp(cx, 50 * U, W - 50 * U);
    for (let i = 0; i < n; i++) {
      const k = i - (n - 1) / 2;
      let x = cx;
      if (shape === 'diag') x = cx + k * 16 * U * dir;
      if (shape === 'wave') x = cx + Math.sin(i * 1.2) * 26 * U;
      addShard(x, cy + k * sp);
    }
  }

  // ---------- geometry ----------
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1);
    return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
  }
  function distTo(o, px, py, pr) {
    switch (o.type) {
      case 'rect': {
        const dx = Math.max(o.x - px, 0, px - (o.x + o.w));
        const dy = Math.max(o.y - py, 0, py - (o.y + o.h));
        return Math.hypot(dx, dy) - pr;
      }
      case 'spin': {
        const c = Math.cos(o.ang) * o.len / 2, s = Math.sin(o.ang) * o.len / 2;
        return segDist(px, py, o.x - c, o.y - s, o.x + c, o.y + s) - o.th / 2 - pr;
      }
      case 'mine': return Math.hypot(px - o.x, py - o.y) - o.r - pr;
      case 'laser': return o.age >= o.warn ? Math.abs(px - o.x) - o.w / 2 - pr : Infinity;
    }
    return Infinity;
  }
  function passed(o) {
    switch (o.type) {
      case 'rect': return o.y > P.y + P.r;
      case 'spin': return o.y - o.len / 2 > P.y + P.r;
      case 'mine': return o.y - o.r > P.y + P.r;
    }
    return false;
  }
  function bottomOf(o) {
    if (o.type === 'rect') return o.y;
    if (o.type === 'spin') return o.y - o.len / 2;
    if (o.type === 'mine') return o.y - o.r;
    return -1;
  }

  // ---------- effects ----------
  function burst(x, y, n, color, spd, size = 3, life = 0.6) {
    for (let i = 0; i < n; i++) {
      if (particles.length > 700) particles.shift();
      const a = Math.random() * TAU, v = rand(0.25, 1) * spd * U;
      particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.5, 1) * life, max: life, color, size: rand(0.6, 1.3) * size * U });
    }
  }
  function floatText(x, y, text, color, size = 18) {
    texts.push({ x, y, text, color, size: size * U, life: 0.9, max: 0.9 });
  }
  function banner(text, color, sub) {
    g.banner = { text, color, sub, t: 0 };
  }
  function addShake(v) { if (!reduceMotion) shake = Math.max(shake, v * U); }

  function smash(o) {
    if (o.type === 'laser') return;
    o.dead = true;
    const cx = o.type === 'rect' ? clamp(P.x, o.x, o.x + o.w) : o.x;
    const cy = o.type === 'rect' ? o.y + o.h / 2 : o.y;
    if (o.group) { for (const q of obstacles) if (q.group === o.group) q.dead = true; }
    burst(cx, cy, 26, o.color, 420, 3.2, 0.7);
    g.score += 40 * g.mult;
    floatText(cx, cy, '+' + 40 * g.mult, o.color, 16);
    addShake(6);
    Sound.smash();
    haptic('medium');
  }

  function nearMiss(o) {
    g.near++;
    const pts = 25 * g.mult;
    g.score += pts;
    addMeter(0.1);
    tsDip = 0.09;
    const words = ['CLOSE!', 'NEAR MISS', 'WHOA', 'SKIM!', 'RAZOR'];
    floatText(P.x, P.y - 34 * U, pick(words) + ' +' + pts, COL.ink, 17);
    burst(P.x, P.y, 10, skinColors(save.skin, clock)[0], 260, 2.2, 0.4);
    Sound.near();
    haptic('light');
  }

  function startOverdrive() {
    g.overdrive = OD_TIME;
    g.odCount++;
    g.meter = 0;
    flash = 0.6; flashColor = '#ffffff';
    banner('OVERDRIVE', '#ffffff', 'smash everything');
    Sound.overdrive();
    haptic('heavy');
    addShake(8);
  }

  function collectShard(s) {
    g.shards++;
    g.combo++;
    g.comboT = 2.3;
    const m = Math.min(10, 1 + Math.floor(g.combo / 6));
    if (m > g.mult) { Sound.mult(); floatText(P.x, P.y - 52 * U, 'x' + m, COL.shard, 24); }
    g.mult = m;
    g.score += 10 * g.mult;
    addMeter(0.012);
    burst(s.x, s.y, 7, COL.shard, 200, 2.4, 0.35);
    Sound.shard(g.combo);
  }

  function collectPower(p) {
    const label = { shield: 'SHIELD', magnet: 'MAGNET', slow: 'SLOW-MO' }[p.kind];
    if (p.kind === 'shield') g.shield = true;
    if (p.kind === 'magnet') g.magnet = 9;
    if (p.kind === 'slow') g.slow = 5;
    floatText(p.x, p.y - 26 * U, label, COL[p.kind], 20);
    burst(p.x, p.y, 22, COL[p.kind], 320, 3, 0.6);
    flash = 0.25; flashColor = COL[p.kind];
    Sound.power();
    haptic('medium');
  }

  function die() {
    state.mode = 'dying';
    g.dying = 1.05;
    hitstop = 0.1;
    addShake(20);
    flash = 0.9; flashColor = COL.hazard;
    const [c1, c2] = skinColors(save.skin, clock);
    burst(P.x, P.y, 70, c1, 560, 4, 1.1);
    burst(P.x, P.y, 40, c2, 380, 3, 0.9);
    burst(P.x, P.y, 20, '#ffffff', 700, 2, 0.5);
    Sound.stopMusic();
    Sound.death();
    haptic('heavy');
    showHud(false);
  }

  // =====================================================================
  // ---------- combat: weapons, enemies, weapon drops, bosses ----------
  // =====================================================================
  // Each level: dodge obstacles and shoot enemies for levelLen() seconds,
  // then one boss. Bosses rotate Warden -> Hydra -> Rift Core and every
  // level makes them tougher, so level 1 is gentle and it ramps from there.
  // Enemies drop one of five weapons, each with its own colour and icon.
  const enemies = [], ebullets = [], pbullets = [], drops = [];
  let boss = null;
  const levelLen = () => 30 + Math.min(g.level - 1, 5) * 3;

  const WEAPONS = {
    blaster: { name: 'Blaster', color: null },
    // cool, clearly separated hues so drops never read as warm-coloured hazards
    spread: { name: 'Spread', color: '#ffe14d' },
    rapid: { name: 'Rapid', color: '#2ef2ff' },
    homing: { name: 'Homing', color: '#5b8cff' },
    beam: { name: 'Beam', color: '#c08cff' },
    plasma: { name: 'Plasma', color: '#7dff5a' },
  };
  const DROP_POOL = ['spread', 'rapid', 'homing', 'beam', 'plasma'];
  const DROP_CHANCE = { drone: 0.12, diver: 0.25, gunner: 0.7 };

  const ENEMY = {
    drone: { color: '#ff5a5a', hp: 2, r: 14, pts: 30 },
    diver: { color: '#ff9a3c', hp: 3, r: 13, pts: 45 },
    gunner: { color: '#ff2e6a', hp: 7, r: 18, pts: 70 },
  };

  const BOSSES = [
    { name: 'Warden', hp: 55, r: 44, color: '#ff9a3c' },
    { name: 'Hydra', hp: 95, r: 46, color: '#ff4fd8' },
    { name: 'Rift Core', hp: 140, r: 50, color: '#ff2e6a' },
  ];

  function resetCombat() {
    enemies.length = ebullets.length = pbullets.length = drops.length = 0;
    boss = null;
  }

  // Shared damage rules for enemy bodies, enemy bullets and boss contact.
  function tryHurt() {
    if (g.overdrive > 0 || g.invuln > 0) return 'ignore';
    if (g.shield) {
      g.shield = false; g.invuln = 1.1;
      flash = 0.5; flashColor = COL.shield;
      Sound.shieldBreak();
      floatText(P.x, P.y - 40 * U, 'SHIELD BROKE', COL.shield, 16);
      return 'shield';
    }
    return 'dead';
  }

  // ---- player weapons ----
  function liveTargets() {
    const list = [];
    for (const e of enemies) if (!e.dead && e.y > -e.r) list.push(e);
    if (boss && boss.vulnerable) list.push(boss);
    return list;
  }
  function nearestTarget(x, y, list) {
    let best = null, bd = Infinity;
    for (const t of list) { const d = Math.hypot(t.x - x, t.y - y); if (t.y < y + 40 * U && d < bd) { bd = d; best = t; } }
    return best;
  }

  function fireWeapon(rdt, list, c1) {
    const w = g.weapon, t = w.tier;
    const od = g.overdrive > 0 ? 1.6 : 1;
    if (w.kind === 'beam') {
      const bw = (5 + 3 * t) * U;
      let hit = null;
      for (const e of list) if (Math.abs(e.x - P.x) < e.r + bw / 2 && e.y < P.y && (!hit || e.y > hit.y)) hit = e;
      g.beam = { w: bw, y: hit ? hit.y + hit.r * 0.4 : -20 * U };
      if (hit) damage(hit, (8 + 4 * t) * od * rdt, P.x, hit.y + hit.r * 0.5, true);
      Sound.beam();
      return;
    }
    g.beam = null;
    g.fireT -= rdt;
    if (g.fireT > 0) return;
    const nose = P.y - P.r * 1.2, S = 940 * U;
    const shot = (x, ang, sp, dmg, extra) => pbullets.push(Object.assign({
      x, y: nose, vx: Math.sin(ang) * sp, vy: -Math.cos(ang) * sp, dmg: dmg * od, r: 4 * U, kind: 'bolt', color: c1,
    }, extra));
    switch (w.kind) {
      case 'blaster': shot(P.x, 0, S, 1); g.fireT = 0.2; break;
      case 'spread': {
        const n = 1 + 2 * t;
        for (let i = 0; i < n; i++) shot(P.x, (i - (n - 1) / 2) * 0.12, S, 1, { color: WEAPONS.spread.color });
        g.fireT = 0.25; break;
      }
      case 'rapid': shot(P.x + rand(-6, 6) * U, rand(-0.05, 0.05), S * 1.1, 0.8, { color: WEAPONS.rapid.color, r: 3 * U }); g.fireT = 1 / (8 + 3 * t); break;
      case 'homing': {
        const n = 1 + t;
        for (let i = 0; i < n; i++) shot(P.x, (i - (n - 1) / 2) * 0.9, 460 * U, 2, { kind: 'missile', color: WEAPONS.homing.color, r: 5 * U, life: 2.4 });
        g.fireT = 0.42; break;
      }
      case 'plasma': shot(P.x, 0, S * 0.6, 6, { kind: 'plasma', color: WEAPONS.plasma.color, r: (8 + 2 * t) * U, pierce: new Set() }); g.fireT = 1 / (1.4 + 0.4 * t); break;
    }
    Sound.shoot();
  }

  function updatePlayerBullets(dt, list) {
    for (const b of pbullets) {
      if (b.kind === 'missile') {
        b.life -= dt;
        const tg = nearestTarget(b.x, b.y, list);
        const cur = Math.atan2(b.vy, b.vx);
        let na = -Math.PI / 2;
        if (tg) { let da = Math.atan2(tg.y - b.y, tg.x - b.x) - cur; da = Math.atan2(Math.sin(da), Math.cos(da)); na = cur + clamp(da, -7 * dt, 7 * dt); }
        else { let da = -Math.PI / 2 - cur; da = Math.atan2(Math.sin(da), Math.cos(da)); na = cur + clamp(da, -4 * dt, 4 * dt); }
        const sp = Math.min(980 * U, Math.hypot(b.vx, b.vy) + 1500 * U * dt);
        b.vx = Math.cos(na) * sp; b.vy = Math.sin(na) * sp;
        if (b.life <= 0) { b.dead = true; continue; }
      }
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.y < -40 * U || b.y > H + 40 * U || b.x < -40 * U || b.x > W + 40 * U) { b.dead = true; continue; }
      for (const t of list) {
        if (t.dead || (t.isBoss && !t.vulnerable)) continue;
        if (Math.hypot(t.x - b.x, t.y - b.y) > t.r + b.r) continue;
        if (b.pierce) { if (b.pierce.has(t)) continue; b.pierce.add(t); }
        damage(t, b.dmg, b.x, b.y, false);
        if (!b.pierce) { b.dead = true; break; }
      }
    }
    compact(pbullets);
  }

  function damage(t, dmg, hx, hy, quiet) {
    t.hp -= dmg;
    if (!quiet || Math.random() < 0.12) t.flash = 0.06;
    if (!quiet || Math.random() < 0.3) particles.push({ x: hx, y: hy, vx: rand(-120, 120) * U, vy: rand(-160, 40) * U, life: 0.25, max: 0.25, color: '#ffffff', size: 2.4 * U });
    Sound.hit();
    if (t.isBoss) { if (t.hp <= 0 && t.vulnerable) bossDefeated(); }
    else if (t.hp <= 0 && !t.dead) killEnemy(t, true);
  }

  function dropWeapon(x, y) {
    g.dropT = 0;
    drops.push({ x: clamp(x, 30 * U, W - 30 * U), y, kind: pick(DROP_POOL), t: 0 });
  }

  function pickUpWeapon(d) {
    const cur = g.weapon;
    if (d.kind === cur.kind) cur.tier = Math.min(3, cur.tier + 1);
    else g.weapon = { kind: d.kind, tier: 1 };
    const w = g.weapon, def = WEAPONS[w.kind];
    floatText(d.x, d.y - 30 * U, def.name.toUpperCase() + (w.tier > 1 ? ' LV' + w.tier : '') + '!', def.color, 24);
    burst(d.x, d.y, 30, def.color, 360, 3, 0.7);
    flash = 0.3; flashColor = def.color;
    Sound.pickup();
    haptic('medium');
  }

  // ---- enemies ----
  function spawnEnemy() {
    const L = g.level;
    const hpMul = 1 + 0.35 * (L - 1);
    const opts = [['drone', 1]];
    if (L >= 2 || g.phaseT > 16) opts.push(['diver', 0.6]);
    if (L >= 3 || (L === 2 && g.phaseT > 10)) opts.push(['gunner', 0.5]);
    const kind = weighted(opts), def = ENEMY[kind];
    const base = { kind, r: def.r * U, hp: def.hp * hpMul, max: def.hp * hpMul, t: 0, flash: 0, color: def.color };
    if (kind === 'drone') {
      const n = Math.random() < 0.5 ? 3 : 1, cx = rand(W * 0.2, W * 0.8), amp = rand(30, 70) * U, f = rand(1.6, 2.6);
      for (let i = 0; i < n; i++) enemies.push(Object.assign({}, base, { x: cx, cx, amp, f, y: -20 * U - i * 44 * U, t: i * 0.45 }));
    } else if (kind === 'diver') {
      enemies.push(Object.assign(base, { x: rand(W * 0.15, W * 0.85), y: -20 * U, state: 'enter', ty: rand(0.1, 0.24) * H, ang: Math.PI / 2 }));
    } else {
      enemies.push(Object.assign(base, { x: rand(W * 0.2, W * 0.8), y: -26 * U, state: 'enter', ty: rand(0.1, 0.2) * H, shotT: 1.1, vx: rand(40, 80) * U * sign() }));
    }
  }

  function killEnemy(e, reward) {
    e.dead = true;
    burst(e.x, e.y, 22, e.color, 380, 3, 0.6);
    burst(e.x, e.y, 8, '#ffffff', 240, 2, 0.35);
    Sound.enemyDie();
    if (!reward) return;
    const pts = ENEMY[e.kind].pts * g.mult;
    g.score += pts;
    g.kills++;
    floatText(e.x, e.y - 16 * U, '+' + pts, e.color, 15);
    addMeter(0.02);
    addShake(3);
    const n = e.kind === 'gunner' ? 3 : e.kind === 'diver' ? 2 : 1;
    for (let i = 0; i < n; i++) addShard(e.x + rand(-14, 14) * U, e.y + rand(-10, 10) * U);
    // drops only before the boss; a dry spell guarantees the next one
    if (g.phase === 'run' && (Math.random() < DROP_CHANCE[e.kind] || g.dropT > 8)) dropWeapon(e.x, e.y);
  }

  function eshot(x, y, ang, speed, o = {}) {
    if (ebullets.length > 280) return;
    ebullets.push({ x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, r: (o.r || 5.5) * U, color: o.color || COL.hazard, grazed: false });
  }
  const aimAt = (x, y) => Math.atan2(P.y - y, P.x - x);

  function updateEnemies(dt, playing) {
    const d = diff();
    for (const e of enemies) {
      if (e.dead) continue;
      e.t += dt; e.flash = Math.max(0, e.flash - dt);
      if (e.kind === 'drone') {
        e.y += (g.speed * 0.45 + 70 * U) * dt;
        e.x = e.cx + Math.sin(e.t * e.f) * e.amp;
      } else if (e.kind === 'diver') {
        if (e.state === 'enter') {
          e.y += (e.ty - e.y) * Math.min(1, dt * 3);
          if (e.t > 0.9) { e.state = 'aim'; e.t = 0; }
        } else if (e.state === 'aim') {
          e.ang = aimAt(e.x, e.y);
          if (e.t > 0.6) {
            e.state = 'dash';
            const sp = (720 + 160 * d) * U;
            e.vx = Math.cos(e.ang) * sp; e.vy = Math.sin(e.ang) * sp;
            Sound.dash();
          }
        } else { e.x += e.vx * dt; e.y += e.vy * dt; }
      } else if (e.kind === 'gunner') {
        if (e.state === 'enter') {
          e.y += (e.ty - e.y) * Math.min(1, dt * 2.5);
          if (e.t > 1) { e.state = 'hover'; e.t = 0; }
        } else if (e.state === 'hover') {
          e.x += e.vx * dt;
          if (e.x < e.r + 10 * U) { e.x = e.r + 10 * U; e.vx = Math.abs(e.vx); }
          if (e.x > W - e.r - 10 * U) { e.x = W - e.r - 10 * U; e.vx = -Math.abs(e.vx); }
          e.shotT -= dt;
          if (e.shotT <= 0 && playing) {
            e.shotT = lerp(1.5, 0.9, d) / (1 + 0.15 * (g.level - 1));
            const a = aimAt(e.x, e.y), n = g.level >= 3 ? 3 : 1;
            for (let i = 0; i < n; i++) eshot(e.x, e.y + e.r * 0.6, a + (i - (n - 1) / 2) * 0.22, (250 + 60 * d) * U);
            Sound.eshot();
          }
          if (e.t > 6) e.state = 'leave';
        } else { e.y += 320 * U * dt; }
      }
      if (e.y > H + 50 * U || e.x < -80 * U || e.x > W + 80 * U) { e.dead = true; continue; }
      if (!playing) continue;
      if (Math.hypot(e.x - P.x, e.y - P.y) < e.r * 0.8 + P.r * 0.8) {
        if (g.overdrive > 0) { killEnemy(e, true); continue; }
        const res = tryHurt();
        if (res === 'shield') { killEnemy(e, false); continue; }
        if (res === 'dead') { die(); return false; }
      }
    }
    compact(enemies);
    return true;
  }

  function updateEnemyBullets(dt, playing) {
    for (const b of ebullets) {
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.y > H + 30 * U || b.y < -60 * U || b.x < -30 * U || b.x > W + 30 * U) { b.dead = true; continue; }
      if (!playing) continue;
      const dd = Math.hypot(b.x - P.x, b.y - P.y);
      if (dd < b.r + P.r * 0.55) {
        if (g.overdrive > 0) { b.dead = true; burst(b.x, b.y, 4, b.color, 160, 2, 0.25); continue; }
        const res = tryHurt();
        if (res === 'shield') { b.dead = true; continue; }
        if (res === 'dead') { die(); return false; }
        continue;
      }
      if (!b.grazed && dd < b.r + P.r + 12 * U) {
        // grazing bullets rewards brave flying and charges Overdrive
        b.grazed = true;
        g.score += 5 * g.mult;
        addMeter(0.012);
        particles.push({ x: P.x, y: P.y, vx: rand(-90, 90) * U, vy: rand(-90, 90) * U, life: 0.2, max: 0.2, color: '#ffffff', size: 2 * U });
      }
    }
    compact(ebullets);
    return true;
  }

  // ---- bosses ----
  function spawnBoss() {
    const L = g.level, idx = (L - 1) % 3, def = BOSSES[idx];
    const hp = def.hp * (1 + 0.35 * (L - 1));
    const dr = def.r * U;
    // hover just below the HUD so the health bar never covers the boss
    const hudBottom = ui.hud.getBoundingClientRect().bottom || H * 0.15;
    boss = {
      isBoss: true, idx, name: def.name, color: def.color,
      x: W / 2, y: -140 * U, ty: Math.max(H * 0.24, hudBottom + dr * 1.1 + 18 * U),
      dr, r: idx < 2 ? dr * 1.3 : dr, hp, max: hp,
      t: 0, entering: true, vulnerable: false, flash: 0, atk: 1.4, step: 0, spiral: null, phase: 1, dying: 0,
      // level 1 bullets are slower and attacks less frequent
      spd: 0.85 + 0.07 * (L - 1), rate: 0.8 + 0.1 * (L - 1),
    };
    banner(def.name.toUpperCase(), def.color, 'level ' + L + ' boss');
    Sound.bossIn();
  }

  function bossLasers(n) {
    const xs = [clamp(P.x, 30 * U, W - 30 * U)];
    for (let i = 1; i < n; i++) {
      let x = rand(30 * U, W - 30 * U);
      for (let k = 0; k < 10 && xs.some((o) => Math.abs(o - x) < 90 * U); k++) x = rand(30 * U, W - 30 * U);
      xs.push(x);
    }
    for (const x of xs) obstacles.push({ type: 'laser', x, w: 20 * U, age: 0, warn: 0.85, dur: 0.4, fired: false, color: COL.hazard, near: false, nearDone: false });
    Sound.laserWarn();
  }

  function bossAttack(b) {
    const s = b.spd * U, step = b.step++, k = g.level - 1;
    const fan = (n, spread, speed) => { const a = aimAt(b.x, b.y); for (let i = 0; i < n; i++) eshot(b.x, b.y + b.r * 0.5, a + (i - (n - 1) / 2) * spread, speed * s, { color: b.color }); Sound.eshot(); };
    const ring = (n, speed, off) => { for (let i = 0; i < n; i++) eshot(b.x, b.y, off + (i * TAU) / n, speed * s, { color: '#ffffff', r: 6 }); Sound.eshot(); };
    const spiral = (arms, dur, rot, speed, int) => { b.spiral = { arms, t: dur, rot, speed: speed * s, int, acc: 0, ang: Math.random() * TAU }; };
    const wall = (speed) => {
      const gapW = (120 - Math.min(30, 5 * k)) * U, gx = clamp(P.x + rand(-80, 80) * U, gapW, W - gapW);
      for (let x = 10 * U; x < W; x += 24 * U) if (Math.abs(x - gx) > gapW / 2) eshot(x, b.y + b.r, Math.PI / 2, speed * s, { color: b.color, r: 6 });
      Sound.eshot();
    };
    const summon = (kind, n) => {
      for (let i = 0; i < n; i++) {
        const def = ENEMY[kind], hp = def.hp * (1 + 0.4 * (g.level - 1));
        const e = { kind, r: def.r * U, hp, max: hp, t: 0, flash: 0, color: def.color, x: clamp(b.x + (i ? 1 : -1) * 70 * U, 30 * U, W - 30 * U), y: b.y };
        if (kind === 'diver') Object.assign(e, { state: 'enter', ty: b.y + 70 * U, ang: Math.PI / 2 });
        else Object.assign(e, { cx: e.x, amp: 40 * U, f: 2 });
        enemies.push(e);
      }
    };

    if (b.idx === 0) { // Warden: aimed bursts and rings
      switch (step % 4) {
        case 0: case 1: case 2: fan(k >= 3 ? 5 : 3, 0.22, 290); return 0.95;
        default: ring(10 + Math.min(12, 2 * k), 200, Math.random() * TAU); return 1.5;
      }
    }
    if (b.idx === 1) { // Hydra: spirals, lasers, bullet walls, summons
      switch (step % 5) {
        case 0: spiral(k >= 4 ? 3 : 2, 2.4, 0.24, 210, 0.1); return 2.8;
        case 1: fan(5, 0.18, 320); return 1.1;
        case 2: bossLasers(k >= 4 ? 2 : 1); return 1.8;
        case 3: wall(240); return 1.5;
        default:
          if (b.hp < b.max * 0.6 && enemies.length < 4) { summon('drone', 2); return 1.2; }
          fan(5, 0.18, 320); return 1.1;
      }
    }
    // Rift Core: three phases, each meaner
    if (b.phase === 1) {
      switch (step % 3) {
        case 0: ring(16, 210, b.t); return 0.85;
        case 1: ring(16, 210, b.t + TAU / 32); return 0.85;
        default: fan(5, 0.16, 330); return 1.15;
      }
    }
    if (b.phase === 2) {
      switch (step % 4) {
        case 0: spiral(k >= 5 ? 3 : 2, 2.6, 0.2, 225, 0.085); return 2.4;
        case 1: bossLasers(k >= 5 ? 2 : 1); return 1.4;
        case 2: wall(270); return 1.3;
        default: fan(7, 0.14, 350); return 1.05;
      }
    }
    switch (step % 4) {
      case 0: spiral(k >= 5 ? 4 : 3, 3, (step % 8 < 4 ? 1 : -1) * 0.17, 235, 0.075); fan(3, 0.2, 370); return 2.3;
      case 1: bossLasers(k >= 5 ? 3 : 2); wall(290); return 1.7;
      case 2: ring(22, 240, Math.random() * TAU); fan(5, 0.16, 370); return 1.1;
      default: if (enemies.length < 4) summon('diver', 2); ring(18, 220, 0); return 1.4;
    }
  }

  function updateBoss(dt, playing) {
    const b = boss;
    b.t += dt; b.flash = Math.max(0, b.flash - dt);
    if (b.dying > 0) {
      b.dying -= dt;
      if (Math.random() < 0.5) burst(b.x + rand(-b.r, b.r), b.y + rand(-b.r, b.r), 10, pick([b.color, '#ffffff', COL.shard]), 300, 3, 0.5);
      addShake(4);
      if (b.dying <= 0) {
        burst(b.x, b.y, 90, b.color, 650, 4.5, 1.2);
        burst(b.x, b.y, 50, '#ffffff', 800, 3, 0.8);
        for (let i = 0; i < 26; i++) { const a = (i / 26) * TAU, rr = rand(20, 90) * U; addShard(b.x + Math.cos(a) * rr, b.y + Math.sin(a) * rr); }
        g.magnet = Math.max(g.magnet, 5);
        flash = 1; flashColor = '#ffffff';
        addShake(26);
        Sound.bossBoom();
        haptic('heavy');
        boss = null;
      }
      return true;
    }
    if (b.entering) {
      b.y += (b.ty - b.y) * Math.min(1, dt * 2);
      if (Math.abs(b.y - b.ty) < 4 * U) { b.entering = false; b.vulnerable = true; b.t = 0; }
      return true;
    }
    // movement
    const sp = b.idx === 2 ? 0.75 + (b.phase - 1) * 0.3 : b.idx === 1 ? 0.75 : 0.55;
    const span = b.idx < 2 ? b.dr * 1.75 : b.dr;
    b.x = W / 2 + Math.sin(b.t * sp) * Math.max(0, W / 2 - span - 10 * U);
    b.y = b.ty + Math.sin(b.t * sp * 2.1) * 14 * U;
    if (b.idx === 2) {
      const f = b.hp / b.max, ph = f > 0.66 ? 1 : f > 0.33 ? 2 : 3;
      if (ph !== b.phase) {
        b.phase = ph; b.atk = 1.3; b.spiral = null; b.step = 0;
        for (const e of ebullets) e.dead = true;
        banner('PHASE ' + ph, b.color, ph === 3 ? 'enraged' : 'core exposed');
        burst(b.x, b.y, 50, b.color, 500, 3.5, 0.8);
        addShake(12);
        Sound.zone();
      }
    }
    if (!playing) return true;
    if (b.spiral) {
      const s = b.spiral;
      s.t -= dt; s.acc += dt;
      while (s.acc >= s.int) {
        s.acc -= s.int; s.ang += s.rot;
        for (let k = 0; k < s.arms; k++) eshot(b.x, b.y, s.ang + (k * TAU) / s.arms, s.speed, { color: b.color });
      }
      if (s.t <= 0) b.spiral = null;
    }
    b.atk -= dt * b.rate;
    if (b.atk <= 0) b.atk = bossAttack(b);
    // body contact
    if (Math.hypot(b.x - P.x, b.y - P.y) < b.dr * 0.85 + P.r * 0.8) {
      const res = tryHurt();
      if (res === 'dead') { die(); return false; }
    }
    return true;
  }

  function bossDefeated() {
    const b = boss;
    b.vulnerable = false;
    b.dying = 1.5;
    b.spiral = null;
    // every enemy bullet on screen turns into a shard
    let n = 0;
    for (const e of ebullets) { if (n++ < 40) addShard(e.x, e.y); }
    ebullets.length = 0;
    for (const o of obstacles) if (o.type === 'laser') o.dead = true;
    for (const e of enemies) if (!e.dead) killEnemy(e, false);
    const bonus = 1000 * g.level;
    g.score += bonus;
    g.bosses++;
    floatText(b.x, b.y + b.r + 30 * U, '+' + bonus.toLocaleString('en-US'), COL.shard, 28);
    banner('BOSS DOWN', COL.shard, b.name);
    g.phase = 'clear'; g.phaseT = 0;
    hitstop = 0.15;
    Sound.stopMusic();
    Sound.bossDie();
    haptic('heavy');
  }

  function nextLevel() {
    if (g.weapon.kind !== 'blaster') floatText(P.x, P.y - 46 * U, 'WEAPON RESET', COL.dim, 15);
    g.weapon = { kind: 'blaster', tier: 1 };
    g.beam = null;
    g.level++;
    zoneFrom = zoneIdx; zoneIdx = (g.level - 1) % ZONES.length; zoneBlend = 0;
    banner('LEVEL ' + g.level, mixHex(ZONES[zoneIdx].grid, '#ffffff', 0.5), 'boss: ' + BOSSES[(g.level - 1) % 3].name);
    Sound.zone();
    g.phase = 'run'; g.phaseT = 0; g.runLen = levelLen();
    g.cursor = 0; g.need = H * 0.3;
    g.enemyT = 3; g.dropT = 8.01;
    Sound.startMusic();
  }

  // Drives the level flow. Returns false if the player died this frame.
  function updateCombat(dt, rdt, playing, c1) {
    if (playing) {
      g.phaseT += dt;
      if (g.phase === 'run') {
        g.rt += dt;
        g.enemyT -= dt;
        if (g.enemyT <= 0) { spawnEnemy(); g.enemyT = lerp(3.6, 1.7, diff()) * rand(0.8, 1.2); }
        g.dropT += dt;
        // nobody shot anything for a while: a weapon floats in anyway
        if (g.dropT > 15) dropWeapon(rand(W * 0.2, W * 0.8), -30 * U);
        if (g.phaseT >= g.runLen) {
          g.phase = 'warn'; g.phaseT = 0;
          banner('WARNING', COL.hazard, 'boss approaching');
          Sound.alarm();
        }
      } else if (g.phase === 'warn') {
        if (g.phaseT > 3.2) { g.phase = 'boss'; g.phaseT = 0; spawnBoss(); }
      } else if (g.phase === 'clear') {
        if (g.phaseT > 3.2 && !boss) nextLevel();
      }
      const list = liveTargets();
      fireWeapon(rdt, list, c1);
      updatePlayerBullets(dt, list);
    } else {
      g.beam = null;
    }
    if (boss && !updateBoss(dt, playing)) return false;
    if (!updateEnemies(dt, playing)) return false;
    if (!updateEnemyBullets(dt, playing)) return false;
    for (const d of drops) {
      d.y += (g.speed * 0.3 + 60 * U) * dt; d.t += dt;
      if (playing && Math.hypot(P.x - d.x, P.y - d.y) < P.r + 24 * U) { d.dead = true; pickUpWeapon(d); continue; }
      if (d.y > H + 40 * U) d.dead = true;
    }
    compact(drops);
    return true;
  }

  // ---- combat rendering ----
  function drawCombatBack() {
    for (const e of enemies) drawEnemy(e);
    if (boss) drawBoss(boss);
    for (const d of drops) drawDrop(d);
  }

  function drawCombatFront(c1) {
    ctx.globalCompositeOperation = 'lighter';
    if (g.beam && state.mode === 'play') {
      const bw = g.beam.w, top = g.beam.y, bot = P.y - P.r * 1.1, col = WEAPONS.beam.color;
      const wob = 1 + 0.15 * Math.sin(clock * 50);
      ctx.fillStyle = rgba(col, 0.25); ctx.fillRect(P.x - bw * 1.2 * wob, top, bw * 2.4 * wob, bot - top);
      ctx.fillStyle = col; ctx.fillRect(P.x - bw / 2, top, bw, bot - top);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(P.x - bw / 6, top, bw / 3, bot - top);
      glow(P.x, top, bw * 2.5, col, 0.9);
    }
    for (const b of pbullets) {
      if (b.kind === 'plasma') {
        glow(b.x, b.y, b.r * 3, b.color, 0.85);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.55, 0, TAU); ctx.fill();
      } else if (b.kind === 'missile') {
        glow(b.x, b.y, 14 * U, b.color, 0.7);
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(Math.atan2(b.vy, b.vx));
        ctx.fillStyle = b.color;
        ctx.beginPath(); ctx.moveTo(7 * U, 0); ctx.lineTo(-5 * U, 3.5 * U); ctx.lineTo(-5 * U, -3.5 * U); ctx.closePath(); ctx.fill();
        ctx.restore();
      } else {
        const a = Math.atan2(b.vy, b.vx);
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(a);
        ctx.fillStyle = rgba(b.color, 0.8); ctx.fillRect(-12 * U, -b.r, 18 * U, b.r * 2);
        ctx.fillStyle = '#ffffff'; ctx.fillRect(-7 * U, -b.r * 0.4, 12 * U, b.r * 0.8);
        ctx.restore();
      }
    }
    for (const b of ebullets) glow(b.x, b.y, b.r * 2.8, b.color, 0.75);
    ctx.globalCompositeOperation = 'source-over';
    for (const b of ebullets) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.62, 0, TAU); ctx.fill();
    }
  }

  // One icon per weapon. Used on drops and repeated in the pickup text colour.
  function weaponIcon(kind, s, col) {
    ctx.strokeStyle = col; ctx.fillStyle = col;
    ctx.lineWidth = 2.6 * U; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    if (kind === 'spread') {
      // three full arrows fanning upward from one point
      const px = 0, py = s * 0.9;
      for (const a of [-0.6, 0, 0.6]) {
        const dx = Math.sin(a), dy = -Math.cos(a);
        ctx.moveTo(px + dx * s * 0.2, py + dy * s * 0.2); ctx.lineTo(px + dx * s * 1.25, py + dy * s * 1.25);
      }
      ctx.stroke();
      ctx.beginPath();
      for (const a of [-0.6, 0, 0.6]) {
        const dx = Math.sin(a), dy = -Math.cos(a), tx = px + dx * s * 1.75, ty = py + dy * s * 1.75, h = s * 0.55;
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx - dx * h - dy * h * 0.6, ty - dy * h + dx * h * 0.6);
        ctx.lineTo(tx - dx * h + dy * h * 0.6, ty - dy * h - dx * h * 0.6);
        ctx.closePath();
      }
      ctx.fill();
    } else if (kind === 'rapid') {
      for (const oy of [-0.45, 0.25]) { ctx.moveTo(-s * 0.7, (oy + 0.4) * s); ctx.lineTo(0, oy * s - 0.2 * s); ctx.lineTo(s * 0.7, (oy + 0.4) * s); }
      ctx.stroke();
    } else if (kind === 'homing') {
      ctx.arc(0, 0, s * 0.62, 0, TAU);
      ctx.moveTo(0, -s); ctx.lineTo(0, -s * 0.3); ctx.moveTo(0, s); ctx.lineTo(0, s * 0.3);
      ctx.moveTo(-s, 0); ctx.lineTo(-s * 0.3, 0); ctx.moveTo(s, 0); ctx.lineTo(s * 0.3, 0);
      ctx.stroke();
    } else if (kind === 'beam') {
      ctx.lineWidth = s * 0.5; ctx.moveTo(0, -s * 0.85); ctx.lineTo(0, s * 0.85); ctx.stroke();
    } else {
      ctx.arc(0, 0, s * 0.85, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, s * 0.45, 0, TAU); ctx.fill();
    }
    ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
  }

  function drawDrop(d) {
    const def = WEAPONS[d.kind], R = 17 * U, y = d.y + Math.sin(d.t * 4) * 3 * U;
    const pulse = (d.t * 1.4) % 1;
    ctx.strokeStyle = rgba(def.color, 0.7 * (1 - pulse));
    ctx.lineWidth = 2 * U;
    ctx.beginPath(); ctx.arc(d.x, y, R * (1.1 + pulse * 0.9), 0, TAU); ctx.stroke();
    glow(d.x, y, R * 2.8, def.color, 0.75);
    ctx.beginPath(); ctx.arc(d.x, y, R, 0, TAU);
    ctx.fillStyle = def.color; ctx.fill();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5 * U; ctx.stroke();
    ctx.save(); ctx.translate(d.x, y);
    weaponIcon(d.kind, R * 0.55, '#0c0622');
    ctx.restore();
    ctx.font = `700 ${11 * U}px "Chakra Petch", sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(12,6,34,0.85)';
    ctx.fillText(def.name.toUpperCase(), d.x + 1 * U, y + R + 15 * U);
    ctx.fillStyle = def.color;
    ctx.fillText(def.name.toUpperCase(), d.x, y + R + 14 * U);
  }

  function drawEnemy(e) {
    const col = e.flash > 0 ? '#ffffff' : e.color, r = e.r;
    if (e.kind === 'diver' && e.state === 'aim') {
      const blink = Math.sin(e.t * 40) > 0;
      ctx.strokeStyle = rgba(e.color, blink ? 0.7 : 0.25);
      ctx.lineWidth = 1.5 * U;
      ctx.setLineDash([8 * U, 6 * U]);
      ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x + Math.cos(e.ang) * 900 * U, e.y + Math.sin(e.ang) * 900 * U); ctx.stroke();
      ctx.setLineDash([]);
    }
    glow(e.x, e.y, r * 2.4, e.color, 0.45);
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.beginPath();
    if (e.kind === 'drone') {
      ctx.rotate(Math.sin(e.t * e.f) * 0.3);
      ctx.moveTo(0, r); ctx.lineTo(r, -r * 0.45); ctx.lineTo(r * 0.35, -r * 0.2); ctx.lineTo(0, -r * 0.7); ctx.lineTo(-r * 0.35, -r * 0.2); ctx.lineTo(-r, -r * 0.45); ctx.closePath();
    } else if (e.kind === 'diver') {
      ctx.rotate(e.ang - Math.PI / 2);
      ctx.moveTo(0, r * 1.3); ctx.lineTo(r * 0.8, -r * 0.8); ctx.lineTo(0, -r * 0.3); ctx.lineTo(-r * 0.8, -r * 0.8); ctx.closePath();
    } else {
      for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + Math.PI / 6; i ? ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
      ctx.closePath();
    }
    ctx.fillStyle = rgba(e.color, 0.25); ctx.fill();
    neonPath(col, 2 * U);
    if (e.kind === 'gunner') {
      const a = aimAt(e.x, e.y);
      ctx.strokeStyle = col; ctx.lineWidth = 5 * U; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * r * 1.1, Math.sin(a) * r * 1.1); ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(0, 0, r * 0.3, 0, TAU); ctx.fill();
    }
    ctx.restore();
    if (e.hp < e.max && e.max > 3) {
      const w = r * 2;
      ctx.fillStyle = 'rgba(243,236,255,0.18)'; ctx.fillRect(e.x - w / 2, e.y - r - 9 * U, w, 3 * U);
      ctx.fillStyle = e.color; ctx.fillRect(e.x - w / 2, e.y - r - 9 * U, w * clamp(e.hp / e.max, 0, 1), 3 * U);
    }
  }

  function drawBoss(b) {
    const col = b.flash > 0 ? '#ffffff' : b.color, r = b.dr;
    const jitter = b.dying > 0 ? rand(-4, 4) * U : 0;
    const x = b.x + jitter, y = b.y + jitter;
    glow(x, y, r * 3.2, b.color, 0.6 + 0.15 * Math.sin(clock * 6));
    ctx.save();
    ctx.translate(x, y);
    if (b.idx === 0) {
      // Warden: armoured hexagon with wings and a tracking eye
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * r * 0.8, -r * 0.35); ctx.lineTo(s * r * 1.75, -r * 0.1); ctx.lineTo(s * r * 1.55, r * 0.45); ctx.lineTo(s * r * 0.8, r * 0.35); ctx.closePath();
        ctx.fillStyle = rgba(b.color, 0.18); ctx.fill(); neonPath(col, 2 * U);
      }
      ctx.beginPath();
      for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; i ? ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
      ctx.closePath();
      ctx.fillStyle = 'rgba(26,10,20,0.92)'; ctx.fill(); neonPath(col, 3 * U);
      const a = aimAt(b.x, b.y);
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3, r * 0.26, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(Math.cos(a) * r * 0.38, Math.sin(a) * r * 0.38, r * 0.09, 0, TAU); ctx.fill();
    } else if (b.idx === 1) {
      // Hydra: a core diamond with two orbiting cannon heads
      const sway = Math.sin(clock * 2) * 0.2;
      for (const s of [-1, 1]) {
        const hx = s * r * 1.25, hy = r * 0.15 + Math.sin(clock * 3 + s) * 6 * U;
        ctx.strokeStyle = rgba(b.color, 0.5); ctx.lineWidth = 4 * U;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(hx, hy); ctx.stroke();
        ctx.beginPath(); ctx.arc(hx, hy, r * 0.42, 0, TAU);
        ctx.fillStyle = 'rgba(26,10,20,0.92)'; ctx.fill(); neonPath(col, 2.2 * U);
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(hx, hy + r * 0.12, r * 0.13, 0, TAU); ctx.fill();
      }
      ctx.rotate(sway);
      ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * 0.8, 0); ctx.lineTo(0, r); ctx.lineTo(-r * 0.8, 0); ctx.closePath();
      ctx.fillStyle = 'rgba(26,10,20,0.92)'; ctx.fill(); neonPath(col, 3 * U);
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(0, 0, r * 0.2 + Math.sin(clock * 8) * 2 * U, 0, TAU); ctx.fill();
    } else {
      // Rift Core: counter-rotating rings around a pulsing core
      const rings = [[0.98, 1.1, 6], [0.72, -1.7, 4]];
      for (const [k, spd, seg] of rings) {
        for (let i = 0; i < seg; i++) {
          const a0 = clock * spd * (1 + (b.phase - 1) * 0.5) + (i / seg) * TAU;
          ctx.beginPath(); ctx.arc(0, 0, r * k, a0, a0 + (TAU / seg) * 0.6);
          neonPath(i % 2 && b.phase === 3 ? '#ffffff' : col, 3.5 * U);
        }
      }
      const pr = r * (0.4 + 0.05 * Math.sin(clock * (6 + b.phase * 3)));
      ctx.fillStyle = b.phase === 3 ? '#ffffff' : col;
      ctx.beginPath(); ctx.arc(0, 0, pr, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(26,10,20,0.9)';
      ctx.beginPath(); ctx.arc(0, 0, pr * 0.45, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  // ---------- update ----------
  const keys = new Set();

  function update(rdt) {
    clock += rdt;
    flash = Math.max(0, flash - rdt * 2.2);
    shake *= Math.exp(-rdt * 9);
    if (shake < 0.2) shake = 0;
    zoneBlend = Math.min(1, zoneBlend + rdt * 0.8);

    if (hitstop > 0) { hitstop -= rdt; return; }

    if (state.mode === 'paused') return;

    if (state.mode !== 'play' && state.mode !== 'dying') {
      // ambient menu motion
      const sp = 120 * U;
      bgScroll += sp * rdt;
      for (const s of stars) { s.y += sp * s.z * rdt; if (s.y > H) { s.y -= H; s.x = Math.random() * W; } }
      if (state.mode !== 'over') {
        P.x = W / 2 + Math.sin(clock * 0.9) * 26 * U;
        P.y = menuShipY + Math.sin(clock * 1.7) * 6 * U;
        P.vx = Math.cos(clock * 0.9) * 26 * U * 0.9;
        pushTrail(sp * rdt);
      }
      updateParticles(rdt, sp * rdt);
      return;
    }

    let dt;
    if (state.mode === 'dying') {
      dt = rdt * 0.3;
      g.dying -= rdt;
      if (g.dying <= 0) { gameOver(); return; }
    } else {
      tsDip = Math.max(0, tsDip - rdt);
      const ts = (g.slow > 0 ? 0.55 : 1) * (tsDip > 0 ? 0.4 : 1);
      dt = rdt * ts;
    }

    const playing = state.mode === 'play';
    const d = diff();
    if (playing) {
      g.t += dt;
      g.speed = U * (340 + 520 * d + 380 * late()) * (g.overdrive > 0 ? 1.4 : 1);
    }
    const scroll = g.speed * dt;
    bgScroll += scroll;
    for (const s of stars) { s.y += scroll * s.z * 0.6; if (s.y > H) { s.y -= H; s.x = Math.random() * W; } }

    if (playing) {
      g.score += (scroll / U) * 0.05 * g.mult;
      g.invuln = Math.max(0, g.invuln - rdt);
      g.magnet = Math.max(0, g.magnet - rdt);
      g.slow = Math.max(0, g.slow - rdt);
      g.tutorial = Math.max(0, g.tutorial - rdt);
      g.odCool = Math.max(0, g.odCool - rdt);
      if (g.overdrive > 0) { g.overdrive -= rdt; if (g.overdrive <= 0) { g.invuln = 0.5; g.odCool = OD_COOL; floatText(P.x, P.y - 40 * U, 'OVERDRIVE OVER', COL.dim, 14); } }
      if (g.comboT > 0) { g.comboT -= dt; if (g.comboT <= 0) { g.combo = 0; g.mult = 1; } }
      if (g.banner) { g.banner.t += rdt; if (g.banner.t > 1.6) g.banner = null; }

      Sound.setIntensity(g.phase === 'boss' ? 1 : Math.min(1, g.rt / 45), g.overdrive > 0 ? 5 : g.phase === 'boss' ? -2 : 0);

      // player steering
      const ks = 560 * U * rdt;
      if (keys.has('ArrowLeft') || keys.has('a')) P.tx -= ks;
      if (keys.has('ArrowRight') || keys.has('d')) P.tx += ks;
      if (keys.has('ArrowUp') || keys.has('w')) P.ty -= ks;
      if (keys.has('ArrowDown') || keys.has('s')) P.ty += ks;
      P.tx = clamp(P.tx, P.r, W - P.r);
      P.ty = clamp(P.ty, H * 0.3, H - P.r * 3);
      const k = 1 - Math.exp(-rdt * 24);
      const nx = P.x + (P.tx - P.x) * k;
      P.vx = (nx - P.x) / Math.max(rdt, 1e-4);
      P.x = nx;
      P.y += (P.ty - P.y) * k;
      pushTrail(scroll);

      // engine sparks
      const [c1, c2] = skinColors(save.skin, clock);
      if (Math.random() < 0.8) {
        particles.push({ x: P.x + rand(-3, 3) * U, y: P.y + P.r * 0.9, vx: rand(-30, 30) * U, vy: rand(160, 300) * U, life: 0.28, max: 0.28, color: g.overdrive > 0 ? c1 : c2, size: rand(1.5, 3) * U });
      }

      // spawn
      g.cursor += scroll;
      if (g.phase === 'run' && g.cursor >= g.need) spawnPattern();
    }

    // obstacles
    for (const o of obstacles) {
      if (o.dead) continue;
      if (o.type === 'laser') {
        o.age += dt;
        if (!o.fired && o.age >= o.warn) { o.fired = true; Sound.laserFire(); addShake(5); haptic('light'); }
        if (o.age >= o.warn + o.dur) {
          o.dead = true;
          if (playing && o.near && !o.nearDone && g.overdrive <= 0) nearMiss(o);
          continue;
        }
      } else {
        o.y += scroll;
        if (o.type === 'rect') {
          if (o.osc) o.x = o.x0 + o.osc.amp * Math.sin(o.osc.ph + g.t * o.osc.f);
          else if (o.vx) {
            o.x += o.vx * dt;
            if (o.x < 0) { o.x = 0; o.vx = Math.abs(o.vx); }
            if (o.x + o.w > W) { o.x = W - o.w; o.vx = -Math.abs(o.vx); }
          }
        } else if (o.type === 'spin') {
          o.ang += o.av * dt;
        } else if (o.type === 'mine') {
          o.x += o.vx * dt; o.spin += dt * 3;
          if (o.x < o.r) { o.x = o.r; o.vx = Math.abs(o.vx); }
          if (o.x > W - o.r) { o.x = W - o.r; o.vx = -Math.abs(o.vx); }
        }
        if (bottomOf(o) > H + 40 * U) { o.dead = true; continue; }
      }
      if (!playing) continue;

      const dd = distTo(o, P.x, P.y, P.r * 0.84);
      if (dd < 0) {
        if (g.overdrive > 0) { smash(o); continue; }
        if (g.invuln > 0) continue;
        if (g.shield) {
          g.shield = false; g.invuln = 1.1;
          smash(o);
          flash = 0.5; flashColor = COL.shield;
          Sound.shieldBreak();
          floatText(P.x, P.y - 40 * U, 'SHIELD BROKE', COL.shield, 16);
          continue;
        }
        die();
        return;
      }
      const nk = o.group || o;
      if (dd < 24 * U) { nk.near = true; o.near = true; }
      if (o.type !== 'laser' && nk.near && !nk.nearDone && passed(o)) {
        nk.nearDone = true;
        if (g.overdrive <= 0 && g.invuln <= 0) nearMiss(o);
      }
    }
    compact(obstacles);

    if (!updateCombat(dt, rdt, playing, skinColors(save.skin, clock)[0])) return;

    // shards
    const pull = playing && (g.magnet > 0 || g.overdrive > 0);
    for (const s of shards) {
      s.y += scroll; s.a += dt * 4;
      if (playing) {
        const dx = P.x - s.x, dy = P.y - s.y, dist = Math.hypot(dx, dy);
        if (pull && dist < 190 * U) { const v = 950 * U * rdt / Math.max(dist, 1); s.x += dx * Math.min(1, v); s.y += dy * Math.min(1, v); }
        if (dist < P.r + 14 * U) { s.dead = true; collectShard(s); continue; }
      }
      if (s.y > H + 20 * U) s.dead = true;
    }
    compact(shards);

    for (const p of powerups) {
      p.y += scroll; p.t += rdt;
      if (playing && Math.hypot(P.x - p.x, P.y - p.y) < P.r + 20 * U) { p.dead = true; collectPower(p); continue; }
      if (p.y > H + 30 * U) p.dead = true;
    }
    compact(powerups);

    updateParticles(rdt, scroll);
    for (const t of texts) { t.y -= 46 * U * rdt; t.life -= rdt; }
    for (let i = texts.length - 1; i >= 0; i--) if (texts[i].life <= 0) texts.splice(i, 1);
  }

  function pushTrail(scroll) {
    for (const t of P.trail) t.y += scroll * 0.55;
    P.trail.unshift({ x: P.x, y: P.y + P.r * 0.6 });
    if (P.trail.length > 16) P.trail.pop();
  }
  function updateParticles(rdt, scroll) {
    for (const p of particles) {
      p.x += p.vx * rdt; p.y += p.vy * rdt + scroll * 0.3;
      p.vx *= 1 - 2.2 * rdt; p.vy *= 1 - 2.2 * rdt;
      p.life -= rdt;
    }
    for (let i = particles.length - 1; i >= 0; i--) if (particles[i].life <= 0) particles.splice(i, 1);
  }
  function compact(arr) {
    let j = 0;
    for (let i = 0; i < arr.length; i++) if (!arr[i].dead) arr[j++] = arr[i];
    arr.length = j;
  }

  // ---------- render ----------
  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const zA = ZONES[zoneFrom], zB = ZONES[zoneIdx];
    const bg = zoneBlend >= 1 ? zB.bg : mixHex(zA.bg, zB.bg, zoneBlend);
    const gridC = zoneBlend >= 1 ? zB.grid : mixHex(zA.grid, zB.grid, zoneBlend);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    if (shake > 0) ctx.translate(rand(-shake, shake), rand(-shake, shake));

    drawGrid(gridC, bg);
    drawStars();

    const inRun = g && (state.mode === 'play' || state.mode === 'dying' || state.mode === 'paused' || state.mode === 'over');
    const [c1, c2] = skinColors(save.skin, clock);

    if (inRun) {
      for (const o of obstacles) if (o.type === 'laser') drawLaser(o);
      ctx.globalCompositeOperation = 'lighter';
      for (const s of shards) drawShard(s);
      ctx.globalCompositeOperation = 'source-over';
      for (const p of powerups) drawPower(p);
      for (const o of obstacles) {
        if (o.type === 'rect') drawRect(o);
        else if (o.type === 'spin') drawSpin(o);
        else if (o.type === 'mine') drawMine(o);
      }
      drawCombatBack();
    }

    if (state.mode !== 'dying' && state.mode !== 'over') drawPlayer(c1, c2);
    if (inRun) drawCombatFront(c1);

    ctx.globalCompositeOperation = 'lighter';
    for (const p of particles) {
      const a = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    for (const t of texts) {
      const a = clamp(t.life / t.max, 0, 1);
      ctx.globalAlpha = a;
      ctx.font = `700 ${t.size}px "Chakra Petch", "Arial Narrow", sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(12,6,34,0.7)';
      ctx.fillText(t.text, t.x + 2 * U, t.y + 2 * U);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    if (inRun && g) {
      if (g.overdrive > 0) {
        const a = 0.18 + 0.08 * Math.sin(clock * 20);
        const gr = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
        gr.addColorStop(0, 'rgba(255,255,255,0)');
        gr.addColorStop(1, rgba(c1, a * 2));
        ctx.fillStyle = gr;
        ctx.fillRect(0, 0, W, H);
      }
      if (g.slow > 0) {
        ctx.fillStyle = rgba(COL.slow, 0.05 + 0.02 * Math.sin(clock * 6));
        ctx.fillRect(0, 0, W, H);
      }
      if (g.banner && state.mode === 'play') drawBanner(g.banner);
      if (g.tutorial > 0 && state.mode === 'play') drawTutorial();
    }

    if (flash > 0) {
      ctx.globalAlpha = Math.min(1, flash) * 0.45;
      ctx.fillStyle = flashColor;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  }

  function drawGrid(gridC, bg) {
    const step = 64 * U;
    ctx.lineWidth = 1;
    ctx.strokeStyle = rgba(gridC, 0.45);
    ctx.beginPath();
    const off = bgScroll % step;
    for (let y = off - step; y < H + step; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    for (let x = W / 2 % step; x < W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    ctx.stroke();
    // fade the grid toward the horizon so hazards read clearly as they enter
    const gr = ctx.createLinearGradient(0, 0, 0, H * 0.45);
    gr.addColorStop(0, rgba(bg, 0.92));
    gr.addColorStop(1, rgba(bg, 0));
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, W, H * 0.45);
  }

  function drawStars() {
    const fast = g && state.mode === 'play' ? g.speed / U : 120;
    ctx.fillStyle = '#ffffff';
    for (const s of stars) {
      ctx.globalAlpha = 0.25 + s.z * 0.55;
      const len = Math.max(1.2, fast * s.z * 0.035) * U;
      ctx.fillRect(s.x, s.y - len, 1.3 * U * s.z + 0.4, len);
    }
    ctx.globalAlpha = 1;
  }

  function neonPath(color, width) {
    ctx.strokeStyle = rgba(color, 0.22);
    ctx.lineWidth = width * 4;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  function drawRect(o) {
    const x = Math.max(o.x, -10), w = Math.min(o.x + o.w, W + 10) - x;
    if (w <= 0) return;
    ctx.fillStyle = rgba(o.color, 0.16);
    ctx.fillRect(x, o.y, w, o.h);
    // hazard stripes
    ctx.save();
    ctx.beginPath(); ctx.rect(x, o.y, w, o.h); ctx.clip();
    ctx.strokeStyle = rgba(o.color, 0.35);
    ctx.lineWidth = 4 * U;
    ctx.beginPath();
    const st = 16 * U, sx = x - ((x - o.x) % st);
    for (let i = sx - o.h; i < x + w + o.h; i += st) { ctx.moveTo(i, o.y + o.h); ctx.lineTo(i + o.h, o.y); }
    ctx.stroke();
    ctx.restore();
    ctx.beginPath(); ctx.rect(x, o.y, w, o.h);
    neonPath(o.color, 2 * U);
  }

  function drawSpin(o) {
    const c = Math.cos(o.ang) * o.len / 2, s = Math.sin(o.ang) * o.len / 2;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(o.x - c, o.y - s); ctx.lineTo(o.x + c, o.y + s);
    ctx.strokeStyle = rgba(o.color, 0.2); ctx.lineWidth = o.th * 2.4; ctx.stroke();
    ctx.strokeStyle = o.color; ctx.lineWidth = o.th; ctx.stroke();
    ctx.strokeStyle = '#ffe2c2'; ctx.lineWidth = o.th * 0.3; ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.fillStyle = '#1a0a14';
    ctx.beginPath(); ctx.arc(o.x, o.y, o.th * 0.9, 0, TAU); ctx.fill();
    neonPath(o.color, 2 * U);
  }

  function drawMine(o) {
    glow(o.x, o.y, o.r * 3, o.color, 0.5 + 0.2 * Math.sin(clock * 8 + o.spin));
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = o.spin + (i / 16) * TAU, rr = i % 2 ? o.r * 0.8 : o.r * 1.35;
      const x = o.x + Math.cos(a) * rr, y = o.y + Math.sin(a) * rr;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = rgba(o.color, 0.25);
    ctx.fill();
    neonPath(o.color, 1.8 * U);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(o.x, o.y, o.r * 0.28, 0, TAU); ctx.fill();
  }

  function drawLaser(o) {
    if (o.age < o.warn) {
      const blink = Math.sin(o.age * 28) > 0;
      const p = o.age / o.warn;
      ctx.strokeStyle = rgba(o.color, blink ? 0.75 : 0.3);
      ctx.lineWidth = 1.5 * U;
      ctx.setLineDash([10 * U, 8 * U]);
      ctx.lineDashOffset = -clock * 80;
      ctx.beginPath(); ctx.moveTo(o.x, 0); ctx.lineTo(o.x, H); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = rgba(o.color, 0.08 + p * 0.12);
      ctx.fillRect(o.x - o.w / 2 * p, 0, o.w * p, H);
      // warning chevron
      const y = 92 * U;
      ctx.fillStyle = blink ? o.color : rgba(o.color, 0.5);
      ctx.beginPath(); ctx.moveTo(o.x, y - 14 * U); ctx.lineTo(o.x + 13 * U, y + 9 * U); ctx.lineTo(o.x - 13 * U, y + 9 * U); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#1a0414';
      ctx.font = `700 ${14 * U}px "Chakra Petch", sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('!', o.x, y + 6 * U);
    } else {
      const t = (o.age - o.warn) / o.dur;
      const w = o.w * (t < 0.15 ? t / 0.15 : t > 0.8 ? (1 - t) / 0.2 : 1);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(o.color, 0.3);
      ctx.fillRect(o.x - w * 1.6, 0, w * 3.2, H);
      ctx.fillStyle = o.color;
      ctx.fillRect(o.x - w / 2, 0, w, H);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(o.x - w / 6, 0, w / 3, H);
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  function drawShard(s) {
    const r = 8 * U;
    glow(s.x, s.y, r * 2.8, COL.shard, 0.55);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(Math.sin(s.a) * 0.5);
    ctx.scale(Math.abs(Math.cos(s.a * 0.7)) * 0.6 + 0.4, 1);
    ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * 0.7, 0); ctx.lineTo(0, r); ctx.lineTo(-r * 0.7, 0); ctx.closePath();
    ctx.fillStyle = COL.shard; ctx.fill();
    ctx.restore();
  }

  function drawPower(p) {
    const c = COL[p.kind];
    const y = p.y + Math.sin(p.t * 4) * 4 * U, r = 16 * U;
    glow(p.x, y, r * 3, c, 0.6);
    ctx.beginPath(); ctx.arc(p.x, y, r, 0, TAU);
    ctx.fillStyle = 'rgba(12,6,34,0.85)'; ctx.fill();
    neonPath(c, 2 * U);
    ctx.strokeStyle = c; ctx.lineWidth = 2.2 * U; ctx.lineCap = 'round';
    ctx.beginPath();
    if (p.kind === 'shield') {
      ctx.moveTo(p.x, y - r * 0.55); ctx.lineTo(p.x + r * 0.45, y - r * 0.35); ctx.lineTo(p.x + r * 0.4, y + r * 0.1);
      ctx.quadraticCurveTo(p.x + r * 0.3, y + r * 0.45, p.x, y + r * 0.58);
      ctx.quadraticCurveTo(p.x - r * 0.3, y + r * 0.45, p.x - r * 0.4, y + r * 0.1);
      ctx.lineTo(p.x - r * 0.45, y - r * 0.35); ctx.closePath();
    } else if (p.kind === 'magnet') {
      ctx.arc(p.x, y, r * 0.42, 0, Math.PI);
      ctx.moveTo(p.x - r * 0.42, y); ctx.lineTo(p.x - r * 0.42, y - r * 0.45);
      ctx.moveTo(p.x + r * 0.42, y); ctx.lineTo(p.x + r * 0.42, y - r * 0.45);
    } else {
      ctx.arc(p.x, y, r * 0.5, 0, TAU);
      ctx.moveTo(p.x, y); ctx.lineTo(p.x, y - r * 0.35);
      ctx.moveTo(p.x, y); ctx.lineTo(p.x + r * 0.25, y + r * 0.1);
    }
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  function drawShip(c, x, y, r, tilt, c1, c2, flame) {
    c.save();
    c.translate(x, y);
    c.rotate(tilt);
    if (flame) {
      const fl = r * (0.9 + Math.random() * 0.7);
      c.globalCompositeOperation = 'lighter';
      c.fillStyle = rgba(c2, 0.85);
      c.beginPath(); c.moveTo(-r * 0.38, r * 0.62); c.lineTo(0, r * 0.62 + fl); c.lineTo(r * 0.38, r * 0.62); c.closePath(); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.8)';
      c.beginPath(); c.moveTo(-r * 0.15, r * 0.62); c.lineTo(0, r * 0.62 + fl * 0.5); c.lineTo(r * 0.15, r * 0.62); c.closePath(); c.fill();
      c.globalCompositeOperation = 'source-over';
    }
    c.beginPath();
    c.moveTo(0, -r * 1.3); c.lineTo(r, r * 0.9); c.lineTo(0, r * 0.45); c.lineTo(-r, r * 0.9); c.closePath();
    c.fillStyle = rgba(c1, 0.28); c.fill();
    c.lineJoin = 'round';
    c.strokeStyle = rgba(c1, 0.3); c.lineWidth = r * 0.45; c.stroke();
    c.strokeStyle = c1; c.lineWidth = r * 0.16; c.stroke();
    c.fillStyle = '#ffffff';
    c.beginPath(); c.moveTo(0, -r * 0.55); c.lineTo(r * 0.22, r * 0.15); c.lineTo(-r * 0.22, r * 0.15); c.closePath(); c.fill();
    c.restore();
  }

  function drawPlayer(c1, c2) {
    const od = g && g.overdrive > 0 && state.mode !== 'menu';
    const tc1 = od ? hslHex((clock * 600) % 360, 100, 62) : c1;
    // trail
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let i = 1; i < P.trail.length; i++) {
      const a = P.trail[i - 1], b = P.trail[i], t = 1 - i / P.trail.length;
      ctx.strokeStyle = rgba(i < 4 ? tc1 : c2, t * 0.55);
      ctx.lineWidth = P.r * 1.1 * t;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.lineCap = 'butt';
    glow(P.x, P.y, P.r * (od ? 5 : 3.4), tc1, od ? 0.9 : 0.6);
    ctx.globalCompositeOperation = 'source-over';

    const blink = g && state.mode === 'play' && g.invuln > 0 && g.overdrive <= 0 && Math.sin(clock * 40) > 0;
    ctx.globalAlpha = blink ? 0.35 : 1;
    drawShip(ctx, P.x, P.y, P.r, clamp(P.vx / (900 * U), -0.45, 0.45), tc1, c2, true);
    ctx.globalAlpha = 1;

    if (!g || state.mode === 'menu' || state.mode === 'shop') return;
    // overdrive ring
    const R = P.r * 2.15;
    ctx.lineWidth = 3 * U;
    ctx.strokeStyle = 'rgba(243,236,255,0.12)';
    ctx.beginPath(); ctx.arc(P.x, P.y, R, 0, TAU); ctx.stroke();
    if (g.odCool > 0 && g.overdrive <= 0) {
      ctx.strokeStyle = 'rgba(243,236,255,0.22)';
      ctx.beginPath(); ctx.arc(P.x, P.y, R, -Math.PI / 2, -Math.PI / 2 + (1 - g.odCool / OD_COOL) * TAU); ctx.stroke();
    }
    const v = g.overdrive > 0 ? g.overdrive / OD_TIME : g.meter;
    if (v > 0) {
      ctx.strokeStyle = g.overdrive > 0 ? '#ffffff' : rgba(c1, 0.55 + 0.45 * g.meter);
      ctx.beginPath(); ctx.arc(P.x, P.y, R, -Math.PI / 2, -Math.PI / 2 + v * TAU); ctx.stroke();
    }
    if (g.shield) {
      ctx.beginPath(); ctx.arc(P.x, P.y, R + 6 * U + Math.sin(clock * 6) * 1.5 * U, 0, TAU);
      neonPath(COL.shield, 2 * U);
    }
    if (g.magnet > 0) {
      ctx.strokeStyle = rgba(COL.magnet, 0.18);
      ctx.lineWidth = 1.5 * U;
      ctx.beginPath(); ctx.arc(P.x, P.y, 190 * U * (0.6 + 0.4 * ((clock * 1.5) % 1)), 0, TAU); ctx.stroke();
    }
  }

  function drawBanner(b) {
    const t = b.t;
    const scale = t < 0.15 ? 1.6 - (t / 0.15) * 0.6 : 1;
    const a = t > 1.2 ? 1 - (t - 1.2) / 0.4 : 1;
    ctx.save();
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.translate(W / 2, H * 0.33);
    ctx.scale(scale, scale);
    ctx.transform(1, 0, -0.12, 1, 0, 0);
    ctx.textAlign = 'center';
    ctx.font = `italic 700 ${44 * U}px "Chakra Petch", "Arial Narrow", sans-serif`;
    ctx.fillStyle = COL.hazard;
    ctx.fillText(b.text, 3 * U, 3 * U);
    ctx.fillStyle = b.color;
    ctx.fillText(b.text, 0, 0);
    if (b.sub) {
      ctx.font = `700 ${13 * U}px "Chakra Petch", sans-serif`;
      ctx.fillStyle = COL.dim;
      ctx.fillText(b.sub.toUpperCase().split('').join(' '), 0, 26 * U);
    }
    ctx.restore();
  }

  function drawTutorial() {
    const a = Math.min(1, g.tutorial);
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.font = `700 ${15 * U}px "Chakra Petch", sans-serif`;
    ctx.fillStyle = COL.ink;
    ctx.fillText('DRAG ANYWHERE TO STEER', W / 2, H * 0.92);
    ctx.font = `700 ${12 * U}px "Chakra Petch", sans-serif`;
    ctx.fillStyle = COL.dim;
    ctx.fillText('YOUR SHIP FIRES ON ITS OWN · GRAB WEAPON DROPS', W / 2, H * 0.92 + 20 * U);
    const hx = W / 2 + Math.sin(clock * 3) * 60 * U, hy = H * 0.92 - 34 * U;
    ctx.strokeStyle = COL.ink; ctx.lineWidth = 2 * U;
    ctx.beginPath(); ctx.arc(hx, hy, 10 * U, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W / 2 - 80 * U, hy); ctx.lineTo(W / 2 + 80 * U, hy);
    ctx.strokeStyle = rgba(COL.ink, 0.25); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ---------- UI ----------
  const ui = {
    hud: $('hud'), score: $('hudScore'), multWrap: $('hudMultWrap'), mult: $('hudMult'), combo: $('hudCombo'),
    shards: $('hudShards'), fx: $('hudFx'), weapon: $('hudWeapon'),
    bar: $('hudBar'), barLabel: $('hudBarLabel'), barFill: $('hudBarFill'),
    menu: $('menu'), over: $('over'), pause: $('pause'), shop: $('shop'),
  };
  const screens = ['menu', 'over', 'pause', 'shop'];
  let shopReturn = 'menu';
  function show(name) {
    for (const s of screens) ui[s].hidden = s !== name;
    if (name === 'menu') placeMenuShip();
  }
  function showHud(v) { ui.hud.hidden = !v; }

  const last = { score: -1, mult: -1, shards: -1, fx: '', bar: '', barBoss: null, weapon: '' };
  function syncHud() {
    if (!g || ui.hud.hidden) return;
    const sc = Math.floor(g.score);
    if (sc !== last.score) { ui.score.textContent = sc.toLocaleString('en-US'); last.score = sc; }
    if (g.mult !== last.mult) {
      ui.multWrap.hidden = g.mult <= 1;
      ui.mult.textContent = 'x' + g.mult;
      last.mult = g.mult;
    }
    ui.combo.style.transform = `scaleX(${clamp(g.comboT / 2.3, 0, 1).toFixed(3)})`;
    if (g.shards !== last.shards) { ui.shards.textContent = g.shards; last.shards = g.shards; }
    let label, fill, isBoss = false;
    if (g.phase === 'run') { label = `Level ${g.level} · Boss ahead`; fill = g.phaseT / g.runLen; }
    else if (g.phase === 'warn') { label = 'Warning'; fill = 1; isBoss = true; }
    else if (g.phase === 'boss' && boss) { label = boss.name; fill = boss.entering ? 1 - (boss.y - boss.ty) / (-140 * U - boss.ty) : boss.hp / boss.max; isBoss = true; }
    else { label = 'Boss down'; fill = 0; }
    if (label !== last.bar) { ui.barLabel.textContent = label; last.bar = label; }
    if (isBoss !== last.barBoss) { ui.bar.classList.toggle('boss', isBoss); last.barBoss = isBoss; }
    ui.barFill.style.transform = `scaleX(${clamp(fill, 0, 1).toFixed(3)})`;
    const wk = g.weapon.kind + g.weapon.tier;
    if (wk !== last.weapon) {
      const def = WEAPONS[g.weapon.kind];
      ui.weapon.textContent = def.name + (g.weapon.kind === 'blaster' ? '' : ' Lv' + g.weapon.tier);
      ui.weapon.style.color = def.color || COL.ink;
      ui.weapon.style.borderColor = def.color || '';
      last.weapon = wk;
    }
    const fx = [];
    if (g.overdrive > 0) fx.push(['#ffffff', 'Overdrive ' + Math.ceil(g.overdrive)]);
    if (g.shield) fx.push([COL.shield, 'Shield']);
    if (g.magnet > 0) fx.push([COL.magnet, 'Magnet ' + Math.ceil(g.magnet)]);
    if (g.slow > 0) fx.push([COL.slow, 'Slow-mo ' + Math.ceil(g.slow)]);
    const key = fx.map((f) => f[1]).join('|');
    if (key !== last.fx) {
      ui.fx.innerHTML = '';
      for (const [c, txt] of fx) { const s = document.createElement('span'); s.style.color = c; s.textContent = txt; ui.fx.appendChild(s); }
      last.fx = key;
    }
  }

  function refreshMenu() {
    $('menuBest').textContent = save.best.toLocaleString('en-US');
    $('menuCoins').textContent = save.coins.toLocaleString('en-US');
    $('btnSound').textContent = Sound.muted ? 'Sound off' : 'Sound on';
  }

  function startRun() {
    Sound.init();
    Sound.click();
    newRun();
    state.mode = 'play';
    show(null);
    showHud(true);
    last.score = last.mult = last.shards = -1; last.fx = null; last.bar = ''; last.barBoss = null; last.weapon = '';
    Sound.startMusic();
  }

  function gameOver() {
    state.mode = 'over';
    const score = Math.floor(g.score);
    const isBest = score > save.best;
    if (isBest) save.best = score;
    save.coins += g.shards - g.banked;
    g.banked = g.shards;
    save.games++;
    persist();
    $('overScore').textContent = score.toLocaleString('en-US');
    $('overNew').hidden = !isBest;
    $('overTitle').textContent = isBest ? 'Record run' : pick(['Run over', 'Wrecked', 'Clipped', 'Out of the rift']);
    $('overBest').textContent = save.best.toLocaleString('en-US');
    $('overShards').textContent = g.shards;
    $('overBosses').textContent = g.bosses;
    $('overLevel').textContent = 'Level ' + g.level;
    const rv = $('btnRevive');
    rv.hidden = g.revived;
    rv.disabled = save.coins < 50;
    show('over');
  }

  function revive() {
    if (!g || g.revived || save.coins < 50) return;
    save.coins -= 50;
    persist();
    g.revived = true;
    for (const o of obstacles) if (o.type !== 'laser' && bottomOf(o) > -60 * U) smash(o);
    for (const o of obstacles) if (o.type === 'laser') o.dead = true;
    compact(obstacles);
    ebullets.length = 0;
    for (const e of enemies) if (e.y > -40 * U) killEnemy(e, false);
    compact(enemies);
    if (boss) { boss.atk = Math.max(boss.atk, 2); boss.spiral = null; }
    g.invuln = 2.2;
    g.cursor = 0; g.need = H * 0.2;
    state.mode = 'play';
    flash = 0.6; flashColor = '#ffffff';
    floatText(P.x, P.y - 40 * U, 'BACK IN THE RIFT', COL.ink, 18);
    show(null);
    showHud(true);
    Sound.power();
    Sound.startMusic();
  }

  function pause() {
    if (state.mode !== 'play') return;
    state.mode = 'paused';
    Sound.stopMusic();
    show('pause');
  }
  function resume() {
    if (state.mode !== 'paused') return;
    state.mode = 'play';
    g.invuln = Math.max(g.invuln, 0.8);
    show(null);
    Sound.click();
    Sound.startMusic();
  }
  function goMenu() {
    Sound.stopMusic();
    state.mode = 'menu';
    g = null;
    obstacles.length = shards.length = powerups.length = texts.length = 0;
    resetCombat();
    showHud(false);
    refreshMenu();
    show('menu');
    zoneIdx = zoneFrom = 0; zoneBlend = 1;
  }

  function openShop(from) {
    shopReturn = from;
    state.mode = from === 'over' ? 'over' : 'shop';
    buildShop();
    show('shop');
  }

  function buildShop() {
    $('shopCoins').textContent = save.coins.toLocaleString('en-US');
    const grid = $('skinGrid');
    grid.innerHTML = '';
    SKINS.forEach((s, i) => {
      const owned = save.owned.includes(i);
      const b = document.createElement('button');
      b.className = 'skin' + (save.skin === i ? ' equipped' : '') + (owned ? '' : ' locked') + (!owned && save.coins < s.cost ? ' poor' : '');
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const cx = c.getContext('2d');
      const [c1, c2] = skinColors(i, i * 0.7);
      cx.setTransform(2, 0, 0, 2, 0, 0);
      const gs = glowSprite(c1);
      cx.globalAlpha = 0.6; cx.drawImage(gs, 4, 4, 56, 56); cx.globalAlpha = 1;
      drawShip(cx, 32, 30, 14, 0, c1, c2, true);
      const name = document.createElement('span');
      name.textContent = s.name;
      const sub = document.createElement('small');
      if (save.skin === i) sub.textContent = 'Equipped';
      else if (owned) sub.textContent = 'Equip';
      else { sub.innerHTML = '<i class="gem"></i>'; sub.append(String(s.cost)); }
      b.append(c, name, sub);
      b.setAttribute('aria-label', `${s.name}: ${sub.textContent || s.cost + ' shards'}`);
      b.addEventListener('click', () => {
        Sound.init();
        if (owned) { save.skin = i; Sound.click(); }
        else if (save.coins >= s.cost) {
          save.coins -= s.cost; save.owned.push(i); save.skin = i; Sound.buy(); haptic('medium');
        } else { Sound.click(); b.animate([{ transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'none' }], { duration: 160 }); return; }
        persist();
        buildShop();
      });
      grid.appendChild(b);
    });
  }

  // ---------- input ----------
  let drag = null;
  const SENS = 1.3;
  cvs.addEventListener('pointerdown', (e) => {
    Sound.init();
    if (state.mode !== 'play' || e.pointerType === 'mouse') return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    try { cvs.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  });
  cvs.addEventListener('pointermove', (e) => {
    if (state.mode !== 'play') return;
    if (e.pointerType === 'mouse' && !drag) {
      // desktop: the ship follows the cursor directly
      P.tx = e.clientX; P.ty = e.clientY;
      return;
    }
    if (!drag || drag.id !== e.pointerId) return;
    P.tx += (e.clientX - drag.x) * SENS;
    P.ty += (e.clientY - drag.y) * SENS;
    drag.x = e.clientX; drag.y = e.clientY;
  });
  const endDrag = (e) => { if (drag && drag.id === e.pointerId) drag = null; };
  cvs.addEventListener('pointerup', endDrag);
  cvs.addEventListener('pointercancel', endDrag);

  window.addEventListener('keydown', (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    keys.add(k);
    if (k === ' ' || k === 'Enter') {
      if (state.mode === 'menu' || state.mode === 'over') { e.preventDefault(); startRun(); }
      else if (state.mode === 'paused') { e.preventDefault(); resume(); }
    }
    if ((k === 'Escape' || k === 'p') && state.mode === 'play') pause();
    else if ((k === 'Escape' || k === 'p') && state.mode === 'paused') resume();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
  window.addEventListener('blur', () => { keys.clear(); pause(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('resize', resize);

  $('btnPlay').addEventListener('click', startRun);
  $('btnRetry').addEventListener('click', startRun);
  $('btnRevive').addEventListener('click', () => { Sound.init(); revive(); });
  $('btnHome').addEventListener('click', () => { Sound.click(); goMenu(); });
  $('btnSkins').addEventListener('click', () => { Sound.init(); Sound.click(); openShop('menu'); });
  $('btnSkins2').addEventListener('click', () => { Sound.click(); openShop('over'); });
  $('btnShopBack').addEventListener('click', () => {
    Sound.click();
    if (shopReturn === 'over') { show('over'); $('btnRevive').disabled = save.coins < 50; }
    else { state.mode = 'menu'; refreshMenu(); show('menu'); }
  });
  $('btnSound').addEventListener('click', () => { Sound.init(); Sound.setMuted(!Sound.muted); Sound.click(); refreshMenu(); });
  $('btnPause').addEventListener('click', pause);
  $('btnResume').addEventListener('click', resume);
  $('btnQuit').addEventListener('click', () => { state.mode = 'dying'; g.dying = 0; Sound.stopMusic(); showHud(false); gameOver(); });

  // ---------- main loop ----------
  let prev = performance.now();
  function frame(now) {
    const rdt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    update(rdt);
    render();
    syncHud();
    requestAnimationFrame(frame);
  }

  resize();
  refreshMenu();
  show('menu');
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(placeMenuShip);
  requestAnimationFrame(frame);

  // test hook (harmless in production)
  window.__rift = {
    get state() { return state.mode; }, get run() { return g; }, get boss() { return boss; }, start: startRun,
    showcase() { DROP_POOL.forEach((k, i) => drops.push({ x: W * (0.14 + i * 0.18), y: H * 0.45 + (i % 2) * 70 * U, kind: k, t: i })); },
  };
})();
