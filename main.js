// 画面・操作・音。盤とルールは game.js。
import { geometry, solved, turn, isSolved, faceDone, scramble, SCRAMBLE, FACES, BACK, RING } from './game.js';

// localStorage はほかのアプリと共有される（同じ t-of.github.io のため）。
// キーは必ず 'hirakibako.' で始める。
const STORE = 'hirakibako.';

function load(key, fallback) {
  try {
    const v = localStorage.getItem(STORE + key);
    return v == null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(STORE + key, JSON.stringify(value)); } catch { /* 保存できなくても遊べる */ }
}

WebAppKit.init({ title: 'ひらきばこ', text: '箱を開いて平らにした図の上で、面を回して六つの面の色をそろえるパズル。' });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}

// 音を使うときは、鳴らす前と音の設定を切り替えたときにこれを呼ぶ（RULES.md §5「音」）。
function setAudioSession(soundOn) {
  try { if (navigator.audioSession) navigator.audioSession.type = soundOn ? 'playback' : 'auto'; } catch { /* 対応していない */ }
}

// ---- ここからアプリ本体 ----

// 面の色（上・左・前・右・下・裏）。山吹・浅葱・桜・若葉・藤・墨
const COLORS = ['#e3a21a', '#1f9a96', '#ee8aa9', '#8cb83a', '#7f62c4', '#3b3a46'];
const LINE = 'rgba(45, 42, 38, 0.13)';
const INK = '#2d2a26';
const LEVELS = { easy: 'やさしい', normal: 'ふつう', hard: '本気' };
const TURN_MS = 200;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

// 保存: 知らない値ははじめの値に戻す
const s0 = load('settings', null) || {};
const settings = {
  v: 1,
  size: s0.size === 2 ? 2 : 3,
  level: LEVELS[s0.level] ? s0.level : 'normal',
  sound: s0.sound !== false,
};
const b0 = load('best', null);
const best = b0 && b0.v === 1 && b0.records && typeof b0.records === 'object' ? b0.records : {};
const saveSettings = () => save('settings', settings);

const $ = (id) => document.getElementById(id);

// ---- 音 ----
let actx = null;
function audio() {
  if (!settings.sound) return null;
  setAudioSession(true);
  if (!actx) {
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
function tone(freq, at, dur, type = 'sine', vol = 0.08) {
  const a = audio();
  if (!a) return;
  const o = a.createOscillator(), gain = a.createGain(), t = a.currentTime + at;
  o.type = type; o.frequency.value = freq;
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(gain).connect(a.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
const clack = (f) => { tone(f, 0, 0.03, 'triangle', 0.09); tone(f * 0.8, 0.05, 0.03, 'triangle', 0.07); };
const sfx = {
  click: () => tone(1400, 0, 0.02, 'square', 0.02),
  turn: () => clack(game.n === 2 ? 1500 : 1150),
  undo: () => clack(game.n === 2 ? 1100 : 850),
  shuffle(count) {
    const step = Math.max(0.03, 0.6 / count);
    for (let i = 0; i < count && i * step < 0.6; i++) tone(1300 + (i % 3) * 120, i * step, 0.02, 'triangle', 0.06);
  },
  face: (done) => tone(880 * 2 ** (done / 12), 0, 0.15),
  clear: () => [0, 4, 7].forEach((st, i) => tone(660 * 2 ** (st / 12), i * 0.18, 0.24)),
  best: () => tone(1760, 0.62, 0.25),
};

// ---- 描画 ----
// 図は S×S。ρ（面の輪の半径）= S/9.2 で、裏の輪 4ρ と点がちょうど収まる
function fitCanvas(canvas, S) {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  canvas.width = Math.round(S * dpr); canvas.height = Math.round(S * dpr);
  canvas.style.width = canvas.style.height = `${S}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const circle = (ctx, x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); };
const faceCenter = (f) => (f === BACK ? [0, 0] : FACES[f].at);

function drawBoard(ctx, S, g, board, { anim = null, glows = [], labels = false, now = 0 } = {}) {
  const rho = S / 9.2, c = S / 2, n2 = g.n * g.n;
  const X = (p) => c + p[0] * rho, Y = (p) => c + p[1] * rho;
  const dot = rho * (g.n === 2 ? 0.36 : 0.22); // 3×3 はとなりの面の点と重ならない大きさ
  ctx.clearRect(0, 0, S, S);

  // 面の輪（うすい線）と、そろったときの光
  ctx.lineWidth = 1.5; ctx.strokeStyle = LINE;
  circle(ctx, c, c, RING * rho); ctx.stroke();
  for (let f = 0; f < BACK; f++) { circle(ctx, X(FACES[f].at), Y(FACES[f].at), rho); ctx.stroke(); }
  for (const gl of glows) {
    const t = (now - gl.t0) / 700;
    if (t < 0 || t > 1) continue;
    const at = faceCenter(gl.face);
    ctx.save();
    ctx.globalAlpha = 0.5 * (1 - t); ctx.strokeStyle = COLORS[board[gl.face * n2]]; ctx.lineWidth = dot * 2.4;
    circle(ctx, X(at), Y(at), (gl.face === BACK ? RING : 1) * rho); ctx.stroke();
    ctx.restore();
  }

  // 2×2 は面の中心のマスがないので、押す所だけ示す
  if (g.n === 2) {
    ctx.fillStyle = 'rgba(45, 42, 38, 0.07)';
    for (let f = 0; f < BACK; f++) { circle(ctx, X(FACES[f].at), Y(FACES[f].at), rho * 0.42); ctx.fill(); }
  }

  // 点。回している間は、回す面の中心のまわりを極座標で動かす
  const src = anim ? anim.from : board;
  const k0 = anim ? ease(Math.min(1, (now - anim.t0) / Math.max(1, anim.dur))) : 0;
  const perm = anim && g.perms[anim.m.face][anim.m.dir];
  const pc = anim && faceCenter(anim.m.face);
  for (let k = 0; k < g.count; k++) {
    const center = g.n === 3 && k % n2 === 4;
    if (center && g.face[k] === BACK) continue; // 裏の中心は右下のボタン
    let p = g.screen[k];
    if (perm && perm[k] !== k) {
      const q = g.screen[perm[k]];
      const ra = Math.hypot(p[0] - pc[0], p[1] - pc[1]), rb = Math.hypot(q[0] - pc[0], q[1] - pc[1]);
      const aa = Math.atan2(p[1] - pc[1], p[0] - pc[0]);
      let d = Math.atan2(q[1] - pc[1], q[0] - pc[0]) - aa;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      if (Math.sign(d) !== anim.m.dir) d += anim.m.dir * Math.PI * 2;
      const r = ra + (rb - ra) * k0, th = aa + d * k0;
      p = [pc[0] + r * Math.cos(th), pc[1] + r * Math.sin(th)];
    }
    ctx.fillStyle = COLORS[src[k]];
    circle(ctx, X(p), Y(p), center ? rho * 0.57 : dot); ctx.fill();
  }

  if (labels) {
    ctx.font = `600 ${Math.round(rho * 0.42)}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = g.n === 3 ? '#fffaf2' : INK;
    for (let f = 0; f < BACK; f++) ctx.fillText(FACES[f].name, X(FACES[f].at), Y(FACES[f].at) + 1);
    ctx.fillStyle = INK;
    const th = Math.PI / 8;
    ctx.fillText('裏', c + RING * rho * Math.cos(th), c + RING * rho * Math.sin(th));
  }
}

// ---- 遊ぶ ----
const game = { n: 3, level: 'normal', g: null, start: null, board: null, scrambleCount: 0, history: [], playing: false };
let queue = [], anim = null, glows = [], frameOn = false, boardS = 0, boardCtx = null;
const inv = (m) => ({ face: m.face, dir: -m.dir });

function newGame() {
  game.n = settings.size; game.level = settings.level; game.g = geometry(game.n);
  game.scrambleCount = SCRAMBLE[game.level][game.n];
  game.start = scramble(game.g, game.scrambleCount).board;
  sfx.shuffle(game.scrambleCount);
  restart();
}
function restart() {
  game.board = game.start.slice(); game.history = []; game.playing = true;
  queue = []; anim = null; glows = [];
  $('clear').hidden = true;
  layout(); hud(); requestDraw();
}
function hud() {
  $('moves').textContent = game.history.length;
  $('scrambled').textContent = game.scrambleCount;
  $('undo').disabled = !game.playing || !game.history.length;
  $('backFace').style.background = game.n === 3 ? COLORS[BACK] : '';
  $('backFace').classList.toggle('back-face--plain', game.n === 2);
}

function enqueue(item) {
  if (!game.playing) return;
  queue.push(item); pump();
}
function pump() {
  while (!anim && queue.length) {
    const it = queue.shift();
    let m;
    if (it.undo) {
      if (!game.history.length) continue;
      m = inv(game.history.pop()); sfx.undo();
    } else {
      m = it.m; game.history.push(m); sfx.turn();
    }
    const from = game.board, g = game.g;
    game.board = turn(g, from, m);
    const fresh = FACES.map((_, f) => f).filter((f) => faceDone(g, game.board, f) && !faceDone(g, from, f));
    anim = { m, from, fresh, t0: performance.now(), dur: reduced.matches ? 0 : TURN_MS };
    hud(); requestDraw();
  }
}
function finishAnim(now) {
  const { fresh } = anim;
  anim = null;
  const g = game.g;
  if (isSolved(g, game.board)) return win();
  if (fresh.length) {
    if (!reduced.matches) glows = glows.concat(fresh.map((face) => ({ face, t0: now })));
    sfx.face(FACES.filter((_, f) => faceDone(g, game.board, f)).length);
  }
  pump();
}

function requestDraw() {
  if (frameOn) return;
  frameOn = true;
  requestAnimationFrame(frame);
}
function frame(now) {
  frameOn = false;
  if (anim && now - anim.t0 >= anim.dur) finishAnim(now);
  glows = glows.filter((gl) => now - gl.t0 < 700);
  if (boardCtx && game.g) drawBoard(boardCtx, boardS, game.g, game.board, { anim, glows, now });
  if (anim || glows.length) requestDraw();
}

function win() {
  game.playing = false; queue = [];
  const moves = game.history.length, key = `${game.n}-${game.level}`;
  const isBest = !(best[key] <= moves);
  if (isBest) { best[key] = moves; save('best', { v: 1, records: best }); }
  const now = performance.now();
  if (!reduced.matches) glows = FACES.map((_, face) => ({ face, t0: now }));
  requestDraw();
  sfx.clear(); if (isBest) sfx.best();
  $('clearMoves').textContent = moves;
  $('clearScrambled').textContent = game.scrambleCount;
  $('clearBest').hidden = !isBest;
  const card = $('clear');
  card.hidden = false;
  // 出た直後は押せない（回している指で押してしまわないように）
  const btns = card.querySelectorAll('button');
  btns.forEach((b) => { b.disabled = true; });
  setTimeout(() => btns.forEach((b) => { b.disabled = false; }), 400);
  hud();
}

// ---- 指で回す ----
// 面の中心の近くを押して離す = 時計回り。面の上で中心のまわりを 30° 以上なぞる = その向きに 1 回
const canvas = $('board');
let gesture = null;
function local(e) {
  const r = canvas.getBoundingClientRect(), rho = boardS / 9.2;
  return [(e.clientX - r.left - boardS / 2) / rho, (e.clientY - r.top - boardS / 2) / rho];
}
function hitFace([x, y]) {
  for (let f = 0; f < BACK; f++) if (Math.hypot(x - FACES[f].at[0], y - FACES[f].at[1]) < 1.25) return f;
  const r = Math.hypot(x, y);
  return r > 3.2 && r < 5.3 ? BACK : -1;
}
const angleAt = (p, c) => Math.atan2(p[1] - c[1], p[0] - c[0]);
canvas.addEventListener('pointerdown', (e) => {
  if (!game.playing || gesture) return;
  const p = local(e), face = hitFace(p);
  if (face < 0) return;
  const c = faceCenter(face);
  gesture = { id: e.pointerId, face, c, last: angleAt(p, c), acc: 0, x: e.clientX, y: e.clientY, moved: false, done: false };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  const gs = gesture;
  if (!gs || e.pointerId !== gs.id) return;
  const p = local(e);
  if (Math.hypot(e.clientX - gs.x, e.clientY - gs.y) > 10) gs.moved = true;
  if (Math.hypot(p[0] - gs.c[0], p[1] - gs.c[1]) < 0.25) return; // 中心の真上は向きが定まらない
  const a = angleAt(p, gs.c);
  let d = a - gs.last;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  gs.acc += d; gs.last = a;
  if (!gs.done && Math.abs(gs.acc) >= Math.PI / 6) {
    gs.done = true;
    enqueue({ m: { face: gs.face, dir: gs.acc > 0 ? 1 : -1 } });
  }
});
function endGesture(e, tap) {
  const gs = gesture;
  if (!gs || e.pointerId !== gs.id) return;
  gesture = null;
  if (tap && !gs.done && !gs.moved && gs.face !== BACK) enqueue({ m: { face: gs.face, dir: 1 } });
}
canvas.addEventListener('pointerup', (e) => endGesture(e, true));
canvas.addEventListener('pointercancel', (e) => endGesture(e, false));
$('backFace').addEventListener('click', () => enqueue({ m: { face: BACK, dir: 1 } }));

// ---- 画面 ----
function layout() {
  if ($('game').hidden) return;
  const area = $('area');
  const S = Math.floor(Math.min(area.clientWidth, area.clientHeight, 560));
  if (S <= 0) return;
  $('wrap').style.width = $('wrap').style.height = `${S}px`;
  if (S !== boardS || !boardCtx) { boardS = S; boardCtx = fitCanvas(canvas, S); }
  requestDraw();
}
function drawSample() {
  const el = $('sample'), S = Math.min(240, el.parentElement.clientWidth);
  const g = geometry(settings.size);
  drawBoard(fitCanvas(el, S), S, g, solved(g), { labels: true });
}
function showTitle() {
  $('game').hidden = true; $('title').hidden = false;
  game.playing = false; queue = []; anim = null;
  document.querySelectorAll('[data-size]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.size === settings.size)));
  document.querySelectorAll('[data-level]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.level === settings.level)));
  const rec = best[`${settings.size}-${settings.level}`];
  $('record').hidden = rec == null;
  $('record').textContent = `記録 ${rec} 手（${settings.size}×${settings.size}・${LEVELS[settings.level]}）`;
  $('sound').textContent = settings.sound ? '音 あり' : '音 なし';
  $('sound').setAttribute('aria-pressed', String(settings.sound));
  drawSample();
}
function showGame() {
  $('title').hidden = true; $('game').hidden = false;
  newGame();
}

$('sizeSeg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-size]');
  if (!b) return;
  settings.size = +b.dataset.size; saveSettings(); sfx.click(); showTitle();
});
$('levelSeg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-level]');
  if (!b) return;
  settings.level = b.dataset.level; saveSettings(); sfx.click(); showTitle();
});
$('sound').addEventListener('click', () => {
  settings.sound = !settings.sound; saveSettings();
  setAudioSession(settings.sound);
  sfx.click(); showTitle();
});
$('play').addEventListener('click', showGame);
$('back').addEventListener('click', () => { sfx.click(); showTitle(); });
$('undo').addEventListener('click', () => enqueue({ undo: true }));
$('restart').addEventListener('click', () => { if (game.playing) { sfx.click(); restart(); } });
$('another').addEventListener('click', () => { if (game.playing) newGame(); });
$('again').addEventListener('click', newGame);
$('toTitle').addEventListener('click', () => { sfx.click(); showTitle(); });
$('shareClear').addEventListener('click', () => {
  WebAppKit.share({ text: `ひらきばこ ${game.n}×${game.n}（${LEVELS[game.level]}）を ${game.history.length} 手でそろえた` });
});
addEventListener('resize', () => { layout(); if (!$('title').hidden) drawSample(); });

showTitle();
