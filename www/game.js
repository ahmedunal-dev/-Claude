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
    { name: 'Ember', cost: 150, c1: '#ff9a3c', c2: '#ffd23f' },
    { name: 'Toxin', cost: 300, c1: '#9dff3c', c2: '#2ef2ff' },
    { name: 'Royal', cost: 600, c1: '#c08cff', c2: '#ff4fd8' },
    { name: 'Ghost', cost: 1000, c1: '#ffffff', c2: '#8aa0ff' },
    { name: 'Prism', cost: 2000, c1: null, c2: null },
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
      meter: 0, overdrive: 0, shield: false, magnet: 0, slow: 0, invuln: 0.6,
      near: 0, revived: false, zone: 0, lastLaser: -99, lastPower: 0,
      tutorial: save.games < 3 ? 3.2 : 0, dying: 0, banner: null,
    };
    obstacles.length = shards.length = powerups.length = particles.length = texts.length = 0;
    P.r = 13 * U;
    P.x = P.tx = W / 2; P.y = P.ty = H * 0.78; P.trail.length = 0; P.vx = 0;
    zoneIdx = 0; zoneFrom = 0; zoneBlend = 1;
  }

  const diff = () => 1 - Math.exp(-g.t / 70);

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
    if (g.t > 3) opts.push(['wall', 0.9]);
    if (g.t > 10) opts.push(['spinner', 0.75]);
    if (g.t > 18) opts.push(['mines', 0.6]);
    if (g.t > 26 && g.t - g.lastLaser > 7) opts.push(['laser', 0.55]);
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
      const gapW = lerp(140, 88, d) * U;
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
      const count = d > 0.55 && Math.random() < 0.5 ? 2 : 1;
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

    const gap = lerp(270, 150, d) * U;
    if (kind !== 'laser') g.need = extent + gap;
    g.cursor = 0;

    // reward in the space before the next pattern
    const midY = top - extent - gap / 2;
    if (kind !== 'laser') {
      if (g.t > 8 && g.t - g.lastPower > 14 && Math.random() < 0.18) {
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
    g.meter = Math.min(1, g.meter + 0.14);
    tsDip = 0.09;
    const words = ['CLOSE!', 'NEAR MISS', 'WHOA', 'SKIM!', 'RAZOR'];
    floatText(P.x, P.y - 34 * U, pick(words) + ' +' + pts, COL.ink, 17);
    burst(P.x, P.y, 10, skinColors(save.skin, clock)[0], 260, 2.2, 0.4);
    Sound.near();
    haptic('light');
    if (g.meter >= 1) startOverdrive();
  }

  function startOverdrive() {
    g.overdrive = 5;
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
    g.meter = Math.min(1, g.meter + 0.03);
    burst(s.x, s.y, 7, COL.shard, 200, 2.4, 0.35);
    Sound.shard(g.combo);
    if (g.meter >= 1 && g.overdrive <= 0) startOverdrive();
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
      g.speed = U * (360 + 440 * d) * (g.overdrive > 0 ? 1.4 : 1);
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
      if (g.overdrive > 0) { g.overdrive -= rdt; if (g.overdrive <= 0) { g.invuln = 0.8; floatText(P.x, P.y - 40 * U, 'OVERDRIVE OVER', COL.dim, 14); } }
      if (g.comboT > 0) { g.comboT -= dt; if (g.comboT <= 0) { g.combo = 0; g.mult = 1; } }
      if (g.banner) { g.banner.t += rdt; if (g.banner.t > 1.6) g.banner = null; }

      const z = Math.floor(g.t / 30);
      if (z !== g.zone) {
        g.zone = z;
        zoneFrom = zoneIdx; zoneIdx = z % ZONES.length; zoneBlend = 0;
        banner('ZONE ' + (z + 1), mixHex(ZONES[zoneIdx].grid, '#ffffff', 0.5), 'speed up');
        Sound.zone();
      }
      Sound.setIntensity(Math.min(1, g.t / 45), g.overdrive > 0 ? 5 : 0);

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
      if (g.cursor >= g.need) spawnPattern();
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

      const dd = distTo(o, P.x, P.y, P.r * 0.78);
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
    }

    if (state.mode !== 'dying' && state.mode !== 'over') drawPlayer(c1, c2);

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
    const v = g.overdrive > 0 ? g.overdrive / 5 : g.meter;
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
    shards: $('hudShards'), fx: $('hudFx'),
    menu: $('menu'), over: $('over'), pause: $('pause'), shop: $('shop'),
  };
  const screens = ['menu', 'over', 'pause', 'shop'];
  let shopReturn = 'menu';
  function show(name) {
    for (const s of screens) ui[s].hidden = s !== name;
    if (name === 'menu') placeMenuShip();
  }
  function showHud(v) { ui.hud.hidden = !v; }

  const last = { score: -1, mult: -1, shards: -1, fx: '' };
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
    last.score = last.mult = last.shards = -1; last.fx = null;
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
    $('overNear').textContent = g.near;
    $('overTime').textContent = g.t.toFixed(1) + 's';
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
  window.__rift = { get state() { return state.mode; }, get run() { return g; }, start: startRun };
})();
