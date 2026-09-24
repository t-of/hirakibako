// 箱の持ち方と回し方。描画から切り離してあり、node test.mjs で確かめられる。
//
// マスは 6n² 個。マス k の立体での位置 pos[k] は固定で、盤は「マス k が何色か」の配列。
// 座標は x 右・y 上・z 手前。面の上のマスは 1 つの軸が ±n、ほかの 2 軸が −(n−1)〜n−1 の 2 おき。
// 面を回すのは「どのマスがどこへ行くか」の表（perm）で表し、表は位置を 90° 回して作る。

// 面の並び: 上・左・前・右・下・裏。axis と sign は外向きの向き、at は画面の上での面の中心（ρ 単位）。
// dir は立体の位置 → 画面の上での向き（画面は y 下向き）。裏は全体を囲む大きな輪で、中心は画面のまん中。
export const FACES = [
  { name: '上', axis: 1, sign: 1, at: [0, -2.5], dir: (p) => [p[0], p[2]] },
  { name: '左', axis: 0, sign: -1, at: [-2.5, 0], dir: (p) => [p[2], -p[1]] },
  { name: '前', axis: 2, sign: 1, at: [0, 0], dir: (p) => [p[0], -p[1]] },
  { name: '右', axis: 0, sign: 1, at: [2.5, 0], dir: (p) => [-p[2], -p[1]] },
  { name: '下', axis: 1, sign: -1, at: [0, 2.5], dir: (p) => [p[0], -p[2]] },
  { name: '裏', axis: 2, sign: -1, at: [0, 0], dir: (p) => [p[0], -p[1]] },
];
export const BACK = 5;
export const RING = 4; // 裏の輪の半径（ρ 単位）

// 軸 a 以外の 2 軸 (i, j)。+90°（右ねじ）で p[i] → -p[j]、p[j] → p[i]
const IJ = [[1, 2], [2, 0], [0, 1]];
const cache = {};

export function geometry(n) {
  if (cache[n]) return cache[n];
  const grid = Array.from({ length: n }, (_, i) => 2 * i - (n - 1));
  const pos = [], face = [], screen = [];
  FACES.forEach((F, f) => {
    const [i, j] = IJ[F.axis];
    for (const u of grid) for (const v of grid) {
      const p = [0, 0, 0];
      p[F.axis] = F.sign * n; p[i] = u; p[j] = v;
      pos.push(p); face.push(f);
      // 画面の上の位置（ρ 単位）。面の中心のマス（3×3）は面の中心、ほかは輪の上
      const [dx, dy] = F.dir(p), len = Math.hypot(dx, dy), r = f === BACK ? RING : 1;
      screen.push(len ? [F.at[0] + r * dx / len, F.at[1] + r * dy / len] : [...F.at]);
    }
  });
  const key = (p) => p.join(',');
  const index = new Map(pos.map((p, k) => [key(p), k]));

  // 面 f を画面の上で時計回りに 90°: マス k の色は perm[k] へ動く。
  // 外から見て時計回り = 外向きの軸で −90°。裏は画面の上での向きなので、前と同じ −90°（z 軸）で、外から見ると反時計回り
  const turns = FACES.map((F, f) => {
    const [i, j] = IJ[F.axis];
    const s = f === BACK ? -1 : -F.sign; // +1 なら +z などの軸で +90°
    return pos.map((p, k) => {
      if (p[F.axis] * F.sign < n - 1) return k; // この面の層にない
      const q = [...p];
      q[i] = -s * p[j]; q[j] = s * p[i];
      return index.get(key(q));
    });
  });
  const inverse = (perm) => { const r = []; perm.forEach((t, k) => { r[t] = k; }); return r; };
  const perms = turns.map((cw) => ({ 1: cw, [-1]: inverse(cw) }));

  return (cache[n] = { n, count: pos.length, pos, face, screen, perms });
}

// そろった盤: マスの色 = 面の番号
export const solved = (g) => Int8Array.from(g.face);

// 手 { face, dir }（dir 1 = 画面の上で時計回り、−1 = 反時計回り）
export function turn(g, board, m) {
  const perm = g.perms[m.face][m.dir], out = new Int8Array(board.length);
  for (let k = 0; k < board.length; k++) out[perm[k]] = board[k];
  return out;
}

// 面 f が 1 色か
export function faceDone(g, board, f) {
  const n2 = g.n * g.n, c = board[f * n2];
  for (let k = f * n2 + 1; k < (f + 1) * n2; k++) if (board[k] !== c) return false;
  return true;
}

// 6 面がそれぞれ 1 色ならクリア（どの面が何色かは問わない。2×2 は箱ごと向きが変わった形もある）
export const isSolved = (g, board) => FACES.every((_, f) => faceDone(g, board, f));

export const SCRAMBLE = { easy: { 2: 3, 3: 3 }, normal: { 2: 6, 3: 6 }, hard: { 2: 11, 3: 25 } };

// そろった形から count 回ランダムに回す。同じ面を続けない。そろって見えたらやり直す
export function scramble(g, count, rng = Math.random) {
  for (;;) {
    let b = solved(g), last = -1;
    const moves = [];
    for (let t = 0; t < count; t++) {
      let f;
      do f = Math.floor(rng() * 6); while (f === last);
      const m = { face: f, dir: rng() < 0.5 ? 1 : -1 };
      b = turn(g, b, m); moves.push(m); last = f;
    }
    if (!isSolved(g, b)) return { board: b, moves };
  }
}
