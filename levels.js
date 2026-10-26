// 難易度の設定と、候補手からの選び方
// nodes: 1手あたりの探索局面数 / multipv: 候補手の数
// margin: 最善手からこの評価値差(cp)以内の手を候補にする / temp: 小さいほど最善手を選びやすい
(function (global) {
  'use strict';
  const LEVELS = {
    beginner: { label: '初級（アマ1級くらい）', nodes: 60, multipv: 6, margin: 300, temp: 110 },
    intermediate: { label: '中級（アマ初段くらい）', nodes: 300, multipv: 4, margin: 160, temp: 60 },
    advanced: { label: '上級（アマ2〜3段くらい）', nodes: 2500, multipv: 3, margin: 70, temp: 28 },
  };
  function chooseMove(result, lv, rand) {
    rand = rand || Math.random;
    const cands = result.candidates.slice().sort((a, b) => b.score - a.score);
    if (!cands.length) return result.bestmove;
    const best = cands[0].score;
    if (best >= 20000) return cands[0].move;            // 詰みが見えたら逃さない
    let pool = cands.filter((c) => c.score >= best - lv.margin && c.score > -20000);
    if (!pool.length) pool = [cands[0]];
    const w = pool.map((c) => Math.exp((c.score - best) / lv.temp));
    let x = rand() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < pool.length; i++) { x -= w[i]; if (x <= 0) return pool[i].move; }
    return pool[0].move;
  }
  const api = { LEVELS, chooseMove };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.Levels = api;
})(typeof window !== 'undefined' ? window : globalThis);
