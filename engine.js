// やねうら王 (WASM) を USI で操作する薄いラッパー
(function (global) {
  'use strict';

  async function fetchBytes(url, onProgress) {
    const r = await fetch(url);
    if (!r.ok) throw new Error('ダウンロード失敗: ' + url + ' (' + r.status + ')');
    const total = +r.headers.get('content-length') || 0;
    if (!r.body || !total || !onProgress) return new Uint8Array(await r.arrayBuffer());
    const reader = r.body.getReader(); const chunks = []; let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length; onProgress(got / total);
    }
    const out = new Uint8Array(got); let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }

  class Engine {
    constructor(opts) {
      this.base = (opts && opts.base) || 'engine/';
      this.evalBase = (opts && opts.evalBase) || 'eval/';
      this.worker = null; this.waiters = []; this.lineHandlers = [];
    }
    async load(onProgress) {
      if (!global.crossOriginIsolated) throw new Error('NOT_ISOLATED');
      const p = (x) => onProgress && onProgress(x);
      p(0.02);
      const [nn, prog] = await Promise.all([
        fetchBytes(this.evalBase + 'nn.bin', (f) => p(0.05 + f * 0.7)),
        fetchBytes(this.evalBase + 'progress.bin'),
      ]);
      p(0.8);
      const abs = (x) => new URL(x, location.href).href;
      this.worker = new Worker(abs('engine-worker.js'));
      await new Promise((res, rej) => {
        this.worker.onmessage = (e) => {
          const d = e.data;
          if (d.type === 'line') this._onLine(d.line);
          else if (d.type === 'ready') res();
          else if (d.type === 'error') rej(new Error(d.message));
        };
        this.worker.onerror = (e) => rej(new Error(e.message || 'ワーカーの起動に失敗しました'));
        this.worker.postMessage({ type: 'init', base: abs(this.base), nn: nn.buffer, prog: prog.buffer }, [nn.buffer, prog.buffer]);
      });
      this.send('usi'); await this.waitFor((l) => l === 'usiok');
      [// Threads・USI_Hash は WASM ビルドの既定値（1スレッド・16MB）のまま。ここで変更するとブラウザでは固まる
        'FV_SCALE value 24', 'BookFile value no_book',
        'NetworkDelay value 0', 'NetworkDelay2 value 0', 'MinimumThinkingTime value 1', 'MultiPV value 1',
        'GenerateAllLegalMoves value true', 'ResignValue value 99999'].forEach((o) => this.send('setoption name ' + o));
      p(0.9);
      this.send('isready'); await this.waitFor((l) => l === 'readyok', 60000);
      p(1);
    }
    _onLine(line) {
      for (const h of this.lineHandlers) h(line);
      const w = this.waiters[0];
      if (w && w.test(line)) { this.waiters.shift(); clearTimeout(w.timer); w.res(line); }
    }
    waitFor(test, timeout) {
      return new Promise((res, rej) => {
        const w = { test, res };
        if (timeout) w.timer = setTimeout(() => { const i = this.waiters.indexOf(w); if (i >= 0) this.waiters.splice(i, 1); rej(new Error('エンジンの応答がありません')); }, timeout);
        this.waiters.push(w);
      });
    }
    send(cmd) { this.worker.postMessage({ type: 'cmd', cmd }); }
    newGame() { this.send('usinewgame'); }
    // moves: USI 指し手の配列。候補手（MultiPV）と評価値を返す
    async think(moves, nodes, multipv) {
      const infos = {};
      const handler = (l) => {
        if (!l.startsWith('info ') || l.indexOf(' pv ') < 0) return;
        const mpv = +(l.match(/ multipv (\d+)/) || [0, 1])[1];
        const sm = l.match(/ score (cp|mate) (-?\d+)/);
        const pv = l.split(' pv ')[1].trim().split(/\s+/);
        if (!sm) return;
        let score = +sm[2];
        if (sm[1] === 'mate') score = score >= 0 ? 30000 - score : -30000 - score;
        const bound = / (upperbound|lowerbound)/.test(l);
        const prev = infos[mpv];
        if (!prev || !bound || prev.bound) infos[mpv] = { move: pv[0], score, mate: sm[1] === 'mate', bound, pv };
      };
      this.lineHandlers.push(handler);
      this.send('setoption name MultiPV value ' + multipv);
      this.send('position startpos' + (moves.length ? ' moves ' + moves.join(' ') : ''));
      this.send('go nodes ' + nodes);
      const best = await this.waitFor((l) => l.startsWith('bestmove'), 120000);
      this.lineHandlers.splice(this.lineHandlers.indexOf(handler), 1);
      const bestmove = best.split(/\s+/)[1];
      const cands = Object.keys(infos).map((k) => infos[k]).filter((c) => c.move);
      return { bestmove, candidates: cands };
    }
  }
  global.YEngine = Engine;
})(window);
