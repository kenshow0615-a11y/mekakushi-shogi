// 将棋のルール・棋譜表記・音声入力の解析
// 盤面のマスは idx = 筋*10 + 段 （筋・段とも 1〜9）。先手=0, 後手=1。
(function (global) {
  'use strict';

  const HAND_ORDER = ['R', 'B', 'G', 'S', 'N', 'L', 'P'];
  const PROMOTABLE = { P: 1, L: 1, N: 1, S: 1, B: 1, R: 1 };
  const NAME = { P: '歩', L: '香', N: '桂', S: '銀', G: '金', B: '角', R: '飛', K: '玉' };
  const NAME_PRO = { P: 'と', L: '成香', N: '成桂', S: '成銀', B: '馬', R: '竜' };
  const BOARD_CHAR = { P: '歩', L: '香', N: '桂', S: '銀', G: '金', B: '角', R: '飛', K: '玉' };
  const BOARD_CHAR_PRO = { P: 'と', L: '杏', N: '圭', S: '全', B: '馬', R: '龍' };
  const KANA = { P: 'ふ', L: 'きょう', N: 'けい', S: 'ぎん', G: 'きん', B: 'かく', R: 'ひしゃ', K: 'ぎょく' };
  const KANA_PRO = { P: 'と', L: 'なりきょう', N: 'なりけい', S: 'なりぎん', B: 'うま', R: 'りゅう' };
  const NUM_KANJI = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const NUM_FW = ['', '１', '２', '３', '４', '５', '６', '７', '８', '９'];
  const NUM_KANA = ['', 'いち', 'に', 'さん', 'よん', 'ご', 'ろく', 'なな', 'はち', 'きゅう'];
  const MOD_KANA = { '右': 'みぎ', '左': 'ひだり', '上': 'あがる', '引': 'ひく', '寄': 'よる', '直': 'すぐ', '打': 'うつ', '成': 'なり', '不成': 'ならず' };

  const fileOf = (i) => Math.floor(i / 10);
  const rankOf = (i) => i % 10;
  const sq = (f, r) => f * 10 + r;
  const onBoard = (f, r) => f >= 1 && f <= 9 && r >= 1 && r <= 9;

  // 先手から見た動き [筋の変化, 段の変化]（段が減る=前進）
  const GOLD = [[0, -1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1]];
  const STEPS = {
    P: [[0, -1]],
    N: [[1, -2], [-1, -2]],
    S: [[0, -1], [1, -1], [-1, -1], [1, 1], [-1, 1]],
    G: GOLD,
    K: [[0, -1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [1, 1], [-1, 1]],
    B: [], R: [], L: [],
  };
  const SLIDES = { L: [[0, -1]], B: [[1, 1], [1, -1], [-1, 1], [-1, -1]], R: [[1, 0], [-1, 0], [0, 1], [0, -1]] };

  function pieceSteps(t, pro) {
    if (pro) {
      if (t === 'B') return [[1, 0], [-1, 0], [0, 1], [0, -1]];
      if (t === 'R') return [[1, 1], [1, -1], [-1, 1], [-1, -1]];
      return GOLD;
    }
    return STEPS[t];
  }
  function pieceSlides(t, pro) {
    if (pro) return (t === 'B' || t === 'R') ? SLIDES[t] : [];
    return SLIDES[t] || [];
  }
  const inZone = (c, r) => (c === 0 ? r <= 3 : r >= 7);
  const fwdRank = (c, r) => (c === 0 ? r : 10 - r); // 自分から見て何段目か（1が敵陣最奥）

  class Position {
    constructor() {
      this.board = new Array(100).fill(null);
      this.hands = [{}, {}];
      for (const h of this.hands) for (const t of HAND_ORDER) h[t] = 0;
      this.turn = 0;
    }
    static initial() {
      const p = new Position();
      const back = ['L', 'N', 'S', 'G', 'K', 'G', 'S', 'N', 'L'];
      for (let f = 1; f <= 9; f++) {
        p.board[sq(f, 9)] = { t: back[f - 1], p: false, c: 0 };
        p.board[sq(f, 1)] = { t: back[f - 1], p: false, c: 1 };
        p.board[sq(f, 7)] = { t: 'P', p: false, c: 0 };
        p.board[sq(f, 3)] = { t: 'P', p: false, c: 1 };
      }
      p.board[sq(8, 8)] = { t: 'B', p: false, c: 0 };
      p.board[sq(2, 8)] = { t: 'R', p: false, c: 0 };
      p.board[sq(2, 2)] = { t: 'B', p: false, c: 1 };
      p.board[sq(8, 2)] = { t: 'R', p: false, c: 1 };
      return p;
    }
    clone() {
      const p = new Position();
      for (let i = 0; i < 100; i++) { const x = this.board[i]; p.board[i] = x ? { t: x.t, p: x.p, c: x.c } : null; }
      p.hands = [Object.assign({}, this.hands[0]), Object.assign({}, this.hands[1])];
      p.turn = this.turn;
      return p;
    }
    key() {
      let s = '';
      for (let r = 1; r <= 9; r++) for (let f = 9; f >= 1; f--) {
        const x = this.board[sq(f, r)];
        s += x ? (x.c ? 'w' : 'b') + (x.p ? '+' : '') + x.t : '.';
      }
      for (const c of [0, 1]) for (const t of HAND_ORDER) s += this.hands[c][t];
      return s + this.turn;
    }
    sfen() {
      let rows = [];
      for (let r = 1; r <= 9; r++) {
        let row = '', empty = 0;
        for (let f = 9; f >= 1; f--) {
          const x = this.board[sq(f, r)];
          if (!x) { empty++; continue; }
          if (empty) { row += empty; empty = 0; }
          const ch = x.c === 0 ? x.t : x.t.toLowerCase();
          row += (x.p ? '+' : '') + ch;
        }
        if (empty) row += empty;
        rows.push(row);
      }
      let hand = '';
      for (const c of [0, 1]) for (const t of HAND_ORDER) {
        const n = this.hands[c][t];
        if (n) hand += (n > 1 ? n : '') + (c === 0 ? t : t.toLowerCase());
      }
      return rows.join('/') + ' ' + (this.turn === 0 ? 'b' : 'w') + ' ' + (hand || '-') + ' 1';
    }
    findKing(c) {
      for (let i = 11; i < 100; i++) { const x = this.board[i]; if (x && x.t === 'K' && x.c === c) return i; }
      return -1;
    }
    // マス target が手番 by の駒に利かされているか
    isAttacked(target, by) {
      const tf = fileOf(target), tr = rankOf(target);
      for (let i = 11; i < 100; i++) {
        const x = this.board[i];
        if (!x || x.c !== by) continue;
        const f = fileOf(i), r = rankOf(i), dir = by === 0 ? 1 : -1;
        for (const [df, dr] of pieceSteps(x.t, x.p)) {
          if (f + df === tf && r + dr * dir === tr) return true;
        }
        for (const [df, dr0] of pieceSlides(x.t, x.p)) {
          const dr = dr0 * dir;
          let nf = f + df, nr = r + dr;
          while (onBoard(nf, nr)) {
            if (nf === tf && nr === tr) return true;
            if (this.board[sq(nf, nr)]) break;
            nf += df; nr += dr;
          }
        }
      }
      return false;
    }
    inCheck(c) { const k = this.findKing(c); return k >= 0 && this.isAttacked(k, 1 - c); }

    pseudoMoves() {
      const c = this.turn, dir = c === 0 ? 1 : -1, moves = [];
      const add = (from, to, x) => {
        const tr = rankOf(to), fr = rankOf(from);
        const can = PROMOTABLE[x.t] && !x.p && (inZone(c, fr) || inZone(c, tr));
        const fwd = fwdRank(c, tr);
        const must = !x.p && (((x.t === 'P' || x.t === 'L') && fwd === 1) || (x.t === 'N' && fwd <= 2));
        if (can) moves.push({ from, to, piece: x.t, promote: true, drop: false });
        if (!must) moves.push({ from, to, piece: x.t, promote: false, drop: false });
      };
      for (let i = 11; i < 100; i++) {
        const x = this.board[i];
        if (!x || x.c !== c) continue;
        const f = fileOf(i), r = rankOf(i);
        for (const [df, dr0] of pieceSteps(x.t, x.p)) {
          const nf = f + df, nr = r + dr0 * dir;
          if (!onBoard(nf, nr)) continue;
          const y = this.board[sq(nf, nr)];
          if (y && y.c === c) continue;
          add(i, sq(nf, nr), x);
        }
        for (const [df, dr0] of pieceSlides(x.t, x.p)) {
          const dr = dr0 * dir;
          let nf = f + df, nr = r + dr;
          while (onBoard(nf, nr)) {
            const y = this.board[sq(nf, nr)];
            if (y && y.c === c) break;
            add(i, sq(nf, nr), x);
            if (y) break;
            nf += df; nr += dr;
          }
        }
      }
      // 打つ手
      const pawnFiles = {};
      for (let i = 11; i < 100; i++) { const x = this.board[i]; if (x && x.c === c && x.t === 'P' && !x.p) pawnFiles[fileOf(i)] = true; }
      for (const t of HAND_ORDER) {
        if (!this.hands[c][t]) continue;
        for (let f = 1; f <= 9; f++) for (let r = 1; r <= 9; r++) {
          const to = sq(f, r);
          if (this.board[to]) continue;
          const fwd = fwdRank(c, r);
          if ((t === 'P' || t === 'L') && fwd === 1) continue;
          if (t === 'N' && fwd <= 2) continue;
          if (t === 'P' && pawnFiles[f]) continue;
          moves.push({ from: null, to, piece: t, promote: false, drop: true });
        }
      }
      return moves;
    }
    applyMove(m) {
      const c = this.turn;
      if (m.drop) {
        this.board[m.to] = { t: m.piece, p: false, c };
        this.hands[c][m.piece]--;
      } else {
        const x = this.board[m.from];
        const cap = this.board[m.to];
        if (cap) this.hands[c][cap.t]++;
        this.board[m.to] = { t: x.t, p: x.p || m.promote, c };
        this.board[m.from] = null;
      }
      this.turn = 1 - c;
    }
    afterMove(m) { const p = this.clone(); p.applyMove(m); return p; }
    legalMoves(skipUchifuzume) {
      const c = this.turn, out = [];
      for (const m of this.pseudoMoves()) {
        const p = this.afterMove(m);
        if (p.inCheck(c)) continue;
        if (!skipUchifuzume && m.drop && m.piece === 'P' && p.inCheck(1 - c)) {
          if (p.legalMoves(true).length === 0) continue; // 打ち歩詰め
        }
        out.push(m);
      }
      return out;
    }
    pieceAt(i) { return this.board[i]; }
  }

  // ---- USI 変換 ----
  const RANK_CH = 'abcdefghi';
  function sqToUsi(i) { return fileOf(i) + RANK_CH[rankOf(i) - 1]; }
  function usiToSq(s) { return sq(+s[0], RANK_CH.indexOf(s[1]) + 1); }
  function moveToUsi(m) {
    if (m.drop) return m.piece + '*' + sqToUsi(m.to);
    return sqToUsi(m.from) + sqToUsi(m.to) + (m.promote ? '+' : '');
  }
  function usiToMove(pos, u) {
    if (u[1] === '*') return { from: null, to: usiToSq(u.slice(2, 4)), piece: u[0], promote: false, drop: true };
    const from = usiToSq(u.slice(0, 2)), to = usiToSq(u.slice(2, 4));
    const x = pos.board[from];
    return { from, to, piece: x ? x.t : '?', promote: u[4] === '+', drop: false };
  }
  const sameMove = (a, b) => a.to === b.to && a.from === b.from && a.piece === b.piece && !!a.promote === !!b.promote && !!a.drop === !!b.drop;

  // ---- 相対位置（右・左・上・引・寄・直） ----
  function geom(c, from, to) {
    const df = fileOf(to) - fileOf(from), dr = rankOf(to) - rankOf(from);
    const fwd = c === 0 ? -dr : dr;          // 前進量
    const lat = c === 0 ? fileOf(from) : 10 - fileOf(from); // 小さいほど自分から見て右
    return { fwd, df, lat };
  }
  // 候補（from の配列）のうち、修飾語 mods に合うものを返す
  function filterByMods(c, froms, to, mods, isRB) {
    let s = froms.slice();
    const motion = mods.find((x) => x === '上' || x === '引' || x === '寄');
    if (motion) s = s.filter((f) => { const g = geom(c, f, to); return motion === '上' ? g.fwd > 0 : motion === '引' ? g.fwd < 0 : g.fwd === 0; });
    if (mods.includes('直')) s = s.filter((f) => { const g = geom(c, f, to); return g.fwd > 0 && g.df === 0; });
    const side = mods.find((x) => x === '右' || x === '左');
    if (side && s.length) {
      const lats = s.map((f) => geom(c, f, to).lat);
      const target = side === '右' ? Math.min(...lats) : Math.max(...lats);
      s = s.filter((f) => geom(c, f, to).lat === target);
    }
    return s;
  }
  function relativeLabel(c, from, froms, to, isRB) {
    const tries = [['上'], ['引'], ['寄']];
    if (!isRB) tries.push(['直']);
    tries.push(['右'], ['左']);
    for (const side of ['右', '左']) for (const mo of ['上', '引', '寄']) tries.push([side, mo]);
    for (const mods of tries) {
      const s = filterByMods(c, froms, to, mods, isRB);
      if (s.length === 1 && s[0] === from) return mods;
    }
    return [];
  }

  // 指し手を日本語表記に。prevTo は直前の手の移動先（「同」判定用）
  function moveToJa(pos, m, prevTo) {
    const c = pos.turn;
    let dest, destKana;
    if (prevTo != null && prevTo === m.to) { dest = '同'; destKana = 'どう'; }
    else { dest = NUM_FW[fileOf(m.to)] + NUM_KANJI[rankOf(m.to)]; destKana = NUM_KANA[fileOf(m.to)] + ' ' + NUM_KANA[rankOf(m.to)]; }
    let name, nameKana, mods = [];
    const legal = pos.legalMoves();
    if (m.drop) {
      name = NAME[m.piece]; nameKana = KANA[m.piece];
      const boardMovers = legal.filter((x) => !x.drop && x.to === m.to && pos.board[x.from].t === m.piece && !pos.board[x.from].p);
      if (boardMovers.length) mods.push('打');
    } else {
      const x = pos.board[m.from];
      name = x.p ? NAME_PRO[x.t] : NAME[x.t];
      nameKana = x.p ? KANA_PRO[x.t] : KANA[x.t];
      const froms = [...new Set(legal.filter((y) => !y.drop && y.to === m.to && pos.board[y.from].t === x.t && pos.board[y.from].p === x.p).map((y) => y.from))];
      if (froms.length > 1) mods = relativeLabel(c, m.from, froms, m.to, x.p && (x.t === 'B' || x.t === 'R'));
      const can = PROMOTABLE[x.t] && !x.p && (inZone(c, rankOf(m.from)) || inZone(c, rankOf(m.to)));
      if (m.promote) mods.push('成');
      else if (can) mods.push('不成');
    }
    const text = dest + name + mods.join('');
    const kana = destKana + ' ' + nameKana + (mods.length ? ' ' + mods.map((x) => MOD_KANA[x]).join(' ') : '');
    return { text, kana };
  }

  // ---- 音声・テキスト入力の解析 ----
  function toHira(s) { return s.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60)); }
  const DICT = [];
  function addWords(words, tok) { for (const w of words) DICT.push([w, tok]); }
  // 駒（成駒を先に長い語で）
  addWords(['なりきょう', '成香', '成り香', '成京', '成きょう', 'なり香'], { k: 'piece', v: '+L' });
  addWords(['なりけい', '成桂', '成り桂', '成けい', 'なり桂'], { k: 'piece', v: '+N' });
  addWords(['なりぎん', '成銀', '成り銀', '成ぎん', 'なり銀'], { k: 'piece', v: '+S' });
  addWords(['ときん', 'と金', 'と', '戸', '都'], { k: 'piece', v: '+P' });
  addWords(['うま', '馬', '午'], { k: 'piece', v: '+B' });
  addWords(['りゅう', '竜', '龍', '流', '留', '隆'], { k: 'piece', v: '+R' });
  addWords(['ふ', '歩', '步', '府', '婦', '符', '負', '夫', '譜', '布', '附', 'fu'], { k: 'piece', v: 'P' });
  addWords(['きょうしゃ', '香車', 'きょう', '香', '今日', '京', '強', '興', '教', '共', '凶', '鏡', 'kyo'], { k: 'piece', v: 'L' });
  addWords(['けいま', '桂馬', 'けい', '桂', '系', '計', '敬', '刑', '経', '景', '恵', 'kei', 'k'], { k: 'piece', v: 'N' });
  addWords(['ぎん', '銀', '吟', 'gin'], { k: 'piece', v: 'S' });
  addWords(['きん', '金', '菌', 'kin'], { k: 'piece', v: 'G' });
  addWords(['かく', '角', '格', '各', '確', '核', '閣', 'kaku'], { k: 'piece', v: 'B' });
  addWords(['ひしゃ', '飛車', '飛', '火車', 'ひしや', '飛者', 'hisha'], { k: 'piece', v: 'R' });
  addWords(['ぎょく', '玉', '王', 'おう', '王将', '玉将', '王様'], { k: 'piece', v: 'K' });
  // 修飾語
  addWords(['ならず', '不成', '成らず', 'なりません', '成りません', 'ならない', '成らない', 'なりなし', '成りなし', '成なし'], { k: 'mod', v: '不成' });
  addWords(['なる', 'なり', '成る', '成り', '成', '鳴る', '鳴り', '也', 'なります', '成ります'], { k: 'mod', v: '成' });
  addWords(['みぎ', '右'], { k: 'mod', v: '右' });
  addWords(['ひだり', '左'], { k: 'mod', v: '左' });
  addWords(['あがる', 'あがり', '上がる', '上がり', '上る', '上'], { k: 'mod', v: '上' });
  addWords(['ひく', 'ひき', '引く', '引き', '引', '弾く', '退く'], { k: 'mod', v: '引' });
  addWords(['よる', 'より', '寄る', '寄り', '寄'], { k: 'mod', v: '寄' });
  addWords(['まっすぐ', 'すぐ', '直ぐ', '直'], { k: 'mod', v: '直' });
  addWords(['うつ', 'うち', '打つ', '打ち', '打', '撃つ', '討つ'], { k: 'mod', v: '打' });
  addWords(['おなじく', '同じく', '同じ', 'おなじ', 'どう', '同', '銅', '道', '堂', '動'], { k: 'same' });
  // 数字
  const NUMW = [['いち', 1], ['一', 1], ['に', 2], ['二', 2], ['さん', 3], ['三', 3], ['よん', 4], ['し', 4], ['四', 4], ['ご', 5], ['五', 5],
    ['ろく', 6], ['六', 6], ['なな', 7], ['しち', 7], ['七', 7], ['はち', 8], ['八', 8], ['きゅう', 9], ['きゅ', 9], ['く', 9], ['九', 9]];
  for (const [w, n] of NUMW) DICT.push([w, { k: 'num', v: n }]);
  for (let n = 1; n <= 9; n++) DICT.push([String(n), { k: 'num', v: n }]);
  DICT.sort((a, b) => b[0].length - a[0].length);

  const COMMANDS = [
    ['RESIGN', ['投了', 'とうりょう', '負けました', 'まけました', '参りました', 'まいりました']],
    ['UNDO', ['待った', 'まった', '待って', 'まって']],
    ['HINT', ['ヒント', 'ひんと', '盤面', 'ばんめん']],
    ['REPEAT', ['もう一度', 'もういちど', 'もう1度', 'もう1回', 'もう一回', 'もういっかい', '繰り返し', 'くりかえし', 'なんて', '何て', 'もう1回']],
    ['NO', ['いいえ', 'いや', 'ちがう', '違う', 'ちがいます', '違います', 'だめ', 'no', 'のー', 'キャンセル', 'きゃんせる', '取り消し', 'とりけし', 'やめ']],
    ['YES', ['はい', 'うん', 'ええ', 'そう', 'おねがい', 'お願い', 'ok', 'おーけー', 'オッケー', 'おっけー', 'よろしく', 'いいです', 'いいよ', 'yes', 'イエス', 'いえす', 'オーケー']],
  ];

  function normalize(text) {
    let s = toHira(String(text).normalize('NFKC').toLowerCase());
    s = s.replace(/[\s、。,.!！?？・「」『』（）()\-]/g, '');
    // 「七十六」「ななじゅうろく」→「76」
    s = s.replace(/([一二三四五六七八九1-9])十([一二三四五六七八九1-9])/g, '$1$2');
    s = s.replace(/じゅう/g, '');
    return s;
  }
  function tokenize(s) {
    const out = [];
    let i = 0;
    while (i < s.length) {
      let hit = null;
      for (const [w, tok] of DICT) { if (s.startsWith(w, i)) { hit = [w, tok]; break; } }
      if (hit) { out.push(hit[1]); i += hit[0].length; } else i++;
    }
    return out;
  }
  function parseCommand(text) {
    const s = toHira(String(text).normalize('NFKC').toLowerCase()).replace(/\s/g, '');
    for (const [cmd, words] of COMMANDS) for (const w of words) if (s.includes(toHira(w.toLowerCase()))) return cmd;
    return null;
  }
  function parseMoveText(text) {
    const toks = tokenize(normalize(text));
    let same = false, nums = [], piece = null, mods = [];
    for (const t of toks) {
      if (t.k === 'same') same = true;
      else if (t.k === 'num') { if (!piece) nums.push(t.v); }
      else if (t.k === 'piece') { if (!piece) piece = t.v; }
      else if (t.k === 'mod') mods.push(t.v);
    }
    let dest = null;
    if (nums.length >= 2) dest = sq(nums[0], nums[1]);
    return { same: same && nums.length < 2, dest, piece, mods, hasNumbers: nums.length > 0 };
  }

  // 解析結果から合法手を特定する
  const STATUS_RANK = { ok: 5, ask_promote: 4, ambiguous: 3, illegal: 2, unparsed: 1 };
  function resolveMove(pos, parsed, prevTo) {
    let dest = parsed.dest;
    if (dest == null && parsed.same) dest = prevTo;
    if (dest == null) return { status: 'unparsed' };
    const legal = pos.legalMoves();
    let cand = legal.filter((m) => m.to === dest);
    const label = (m) => m.drop ? m.piece : (pos.board[m.from].p ? '+' : '') + pos.board[m.from].t;
    if (parsed.piece) {
      let c2 = cand.filter((m) => label(m) === parsed.piece);
      if (!c2.length && parsed.piece[0] === '+') {
        // 「2三と」のように成った後の名前で言われた場合
        const base = parsed.piece.slice(1);
        c2 = cand.filter((m) => !m.drop && label(m) === base && m.promote);
      }
      cand = c2;
    } else if (!cand.length) return { status: 'illegal' };
    if (!cand.length) return { status: 'illegal' };
    const mods = parsed.mods;
    if (mods.includes('打')) cand = cand.filter((m) => m.drop);
    else if (cand.some((m) => !m.drop)) cand = cand.filter((m) => !m.drop);
    if (!cand.length) return { status: 'illegal' };
    const rel = mods.filter((x) => ['上', '引', '寄', '直', '右', '左'].includes(x));
    if (rel.length && !cand[0].drop) {
      const froms = [...new Set(cand.map((m) => m.from))];
      const keep = filterByMods(pos.turn, froms, dest, rel);
      if (keep.length) cand = cand.filter((m) => keep.includes(m.from));
      else return { status: 'illegal' };
    }
    if (mods.includes('成')) { const c2 = cand.filter((m) => m.promote); if (c2.length) cand = c2; else return { status: 'illegal' }; }
    else if (mods.includes('不成')) { const c2 = cand.filter((m) => !m.promote); if (c2.length) cand = c2; else return { status: 'illegal' }; }
    const groups = [...new Set(cand.map((m) => (m.drop ? 'd' + m.piece : m.from)))];
    if (groups.length > 1) return { status: 'ambiguous', moves: cand };
    if (cand.length === 2) return { status: 'ask_promote', moves: cand };
    return { status: 'ok', move: cand[0] };
  }
  function interpret(pos, texts, prevTo) {
    let best = { status: 'unparsed' };
    for (const t of texts) {
      const r = resolveMove(pos, parseMoveText(t), prevTo);
      r.text = t;
      if (STATUS_RANK[r.status] > STATUS_RANK[best.status]) best = r;
      if (best.status === 'ok') break;
    }
    return best;
  }

  // ---- 棋譜 (KIF) ----
  function toKif(records, meta) {
    const lines = ['# ---- 目隠し将棋 棋譜ファイル ----', '開始日時：' + (meta.date || ''), '手合割：平手',
      '先手：' + meta.sente, '後手：' + meta.gote, '手数----指手---------消費時間--'];
    records.forEach((r, i) => {
      const from = r.move.drop ? '' : '(' + fileOf(r.move.from) + rankOf(r.move.from) + ')';
      let t = r.text.replace(/^同/, '同　');
      lines.push(String(i + 1).padStart(4, ' ') + ' ' + t + from);
    });
    if (meta.result) lines.push(String(records.length + 1).padStart(4, ' ') + ' ' + meta.result);
    return lines.join('\n') + '\n';
  }

  const api = { Position, HAND_ORDER, NAME, NAME_PRO, BOARD_CHAR, BOARD_CHAR_PRO, KANA, NUM_KANJI, NUM_FW, NUM_KANA,
    sq, fileOf, rankOf, moveToUsi, usiToMove, sameMove, moveToJa, parseMoveText, parseCommand, resolveMove, interpret, normalize, tokenize, toKif };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.Shogi = api;
})(typeof window !== 'undefined' ? window : globalThis);
