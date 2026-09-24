// 遊びの中身の確かめ。node test.mjs
import assert from 'node:assert/strict';
import { geometry, solved, turn, isSolved, faceDone, scramble, SCRAMBLE, FACES, BACK } from './game.js';

const same = (a, b) => a.every((v, k) => v === b[k]);
const run = (g, b, moves) => moves.reduce((x, m) => turn(g, x, m), b);
const inv = (m) => ({ face: m.face, dir: -m.dir });
const allMoves = [0, 1, 2, 3, 4, 5].flatMap((face) => [{ face, dir: 1 }, { face, dir: -1 }]);
// 立体の位置で見分けられる盤（マス k の中身 = k）
const ids = (g) => Int16Array.from({ length: g.count }, (_, k) => k);
const turnAny = (g, b, m) => { const p = g.perms[m.face][m.dir], o = new Int16Array(b.length); b.forEach((v, k) => { o[p[k]] = v; }); return o; };

for (const n of [2, 3]) {
  const g = geometry(n), S = solved(g);
  assert.equal(g.count, 6 * n * n);

  for (const m of allMoves) {
    const perm = g.perms[m.face][m.dir];
    // 表が置換になっている
    assert.equal(new Set(perm).size, g.count, `${n} ${m.face} 置換`);
    // 動くマスの数: 面の n² −（中心）+ となりの 4 面の n マスずつ
    const moved = perm.filter((t, k) => t !== k).length;
    assert.equal(moved, n * n - (n % 2) + 4 * n, `${n} ${FACES[m.face].name} 動く数`);
    // 動くのは回した面と、裏以外なら裏を含むとなりの 4 面（向かいの面は動かない）
    const opp = { 0: 4, 4: 0, 1: 3, 3: 1, 2: 5, 5: 2 }[m.face];
    assert.ok(perm.every((t, k) => t === k || g.face[k] !== opp), `${n} ${m.face} 向かいの面は動かない`);
    // 4 回で元に戻る、逆回しで元に戻る
    let b = ids(g);
    for (let t = 0; t < 4; t++) b = turnAny(g, b, m);
    assert.ok(same(b, ids(g)), `${n} ${m.face} 4 回`);
    assert.ok(same(turnAny(g, turnAny(g, ids(g), m), inv(m)), ids(g)), `${n} ${m.face} 逆回し`);
    // 画面の上で、回した面の点が面の中心のまわりに時計回り（dir=1）に 90° 動く（画面は y 下向き）
    const c = m.face === BACK ? [0, 0] : FACES[m.face].at;
    const ang = (k) => Math.atan2(g.screen[k][1] - c[1], g.screen[k][0] - c[0]);
    for (let k = 0; k < g.count; k++) {
      if (g.face[k] !== m.face || perm[k] === k) continue;
      let d = (ang(perm[k]) - ang(k)) * 180 / Math.PI;
      d = ((d % 360) + 540) % 360 - 180;
      assert.ok(Math.abs(d - 90 * m.dir) < 1e-6, `${n} ${FACES[m.face].name} 画面の向き ${d}`);
    }
  }

  // となりどうしの 2 面で「X → Y → X 逆 → Y 逆」を 6 回で元に戻る
  const adj = [[3, 0], [2, 0], [2, 3], [1, 2], [5, 0], [4, 5], [3, 4]];
  for (const [x, y] of adj) {
    const seq = [{ face: x, dir: 1 }, { face: y, dir: 1 }, { face: x, dir: -1 }, { face: y, dir: -1 }];
    let b = ids(g);
    for (let t = 0; t < 6; t++) b = seq.reduce((z, m) => turnAny(g, z, m), b);
    assert.ok(same(b, ids(g)), `${n} ${x},${y} 6 回`);
    // 1 回だけでは戻らない
    assert.ok(!same(seq.reduce((z, m) => turnAny(g, z, m), ids(g)), ids(g)));
  }

  // 立体で同じかけらのマスは、画面の上でも近い（向きを取り違えると図の反対側へ離れる）
  const piece = (p) => p.map((v) => (Math.abs(v) === n ? Math.sign(v) * (n - 1) : v)).join(',');
  for (let a = 0; a < g.count; a++) for (let b = a + 1; b < g.count; b++) {
    if (g.face[a] === g.face[b] || piece(g.pos[a]) !== piece(g.pos[b])) continue;
    const d = Math.hypot(g.screen[a][0] - g.screen[b][0], g.screen[a][1] - g.screen[b][1]);
    assert.ok(d < 3.6, `${n} ${a},${b} が遠い ${d}`);
  }

  // クリア判定
  assert.ok(isSolved(g, S));
  for (const m of allMoves) assert.ok(!isSolved(g, turn(g, S, m)), `${n} 1 手で崩れる`);
  // 向かいの 2 面を同じ向きに回すと、2×2 は箱ごと回したのと同じ形（クリア）、3×3 は崩れたまま
  const whole = run(g, S, [{ face: 3, dir: 1 }, { face: 1, dir: -1 }]);
  assert.equal(isSolved(g, whole), n === 2);
  assert.ok(faceDone(g, whole, 2) === (n === 2));

  // 崩した盤は、逆の順に戻せばそろう。崩した結果がそろっていることはない
  for (const level of ['easy', 'normal', 'hard']) {
    for (let t = 0; t < 200; t++) {
      const { board, moves } = scramble(g, SCRAMBLE[level][n]);
      assert.equal(moves.length, SCRAMBLE[level][n]);
      assert.ok(!isSolved(g, board));
      assert.ok(moves.every((m, i) => i === 0 || m.face !== moves[i - 1].face), '同じ面を続けない');
      assert.ok(same(run(g, S, moves), board));
      assert.ok(isSolved(g, run(g, board, moves.map(inv).reverse())), `${n} ${level} 解ける`);
    }
  }
}

console.log('ok');
