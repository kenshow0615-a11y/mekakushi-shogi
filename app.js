(function () {
  'use strict';
  const S = window.Shogi, L = window.Levels;
  const $ = (id) => document.getElementById(id);

  // ---------- 設定 ----------
  const DEFAULTS = { color: '0', level: 'beginner', tune: '0', hints: '3', hintSec: '10', confirm: '1', auto: '1', check: '1', showText: '1', rate: '1.0' };
  let settings = Object.assign({}, DEFAULTS);
  try { Object.assign(settings, JSON.parse(localStorage.getItem('mekakushi-settings') || '{}')); } catch (e) { /* 使えない環境 */ }
  const saveSettings = () => { try { localStorage.setItem('mekakushi-settings', JSON.stringify(settings)); } catch (e) { /* 無視 */ } };

  document.querySelectorAll('.seg').forEach((seg) => {
    const name = seg.dataset.name;
    const sync = () => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === settings[name]));
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      settings[name] = b.dataset.v; sync(); saveSettings();
    });
    sync();
  });
  $('rate').value = settings.rate; $('rateVal').textContent = (+settings.rate).toFixed(1);
  $('rate').addEventListener('input', () => { settings.rate = $('rate').value; $('rateVal').textContent = (+settings.rate).toFixed(1); saveSettings(); });

  // ---------- 環境チェック ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const warns = [];
  if (!SR) warns.push('このブラウザは音声認識に対応していません（Chrome・Edge・Safari を推奨）。文字入力では指せます。');
  if (!('speechSynthesis' in window)) warns.push('このブラウザは読み上げに対応していません。');
  if (warns.length) { $('envWarn').innerHTML = warns.join('<br>'); $('envWarn').hidden = false; }

  // ---------- エンジン ----------
  const engine = new window.YEngine();
  let engineReady = false;
  engine.load((f) => { $('loadBar').style.width = Math.round(f * 100) + '%'; })
    .then(() => { engineReady = true; $('loadBar').style.width = '100%'; $('loadText').textContent = 'エンジン準備完了（つようら王11micro × やねうら王）'; $('startBtn').disabled = false; })
    .catch((e) => {
      console.error(e);
      if (e.message === 'NOT_ISOLATED') {
        $('loadText').innerHTML = 'エンジンを起動できません：このページを https のサーバー（GitHub Pages など）か、付属の serve.py から開いてください。ファイルを直接開くと動きません。';
      } else $('loadText').textContent = 'エンジンの読み込みに失敗しました：' + e.message;
    });

  // ---------- 音 ----------
  let audioCtx = null;
  function beep(freq, ms) {
    try {
      if (!audioCtx) return;
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = freq; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.2, audioCtx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + ms / 1000);
      o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + ms / 1000 + 0.02);
    } catch (e) { /* 無視 */ }
  }

  // ---------- 読み上げ ----------
  let jaVoice = null;
  function pickVoice() {
    if (!('speechSynthesis' in window)) return;
    const vs = speechSynthesis.getVoices().filter((v) => /^ja/i.test(v.lang));
    jaVoice = vs.find((v) => /google|kyoko|o-ren|siri|nanami/i.test(v.name)) || vs[0] || null;
  }
  if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
  let speakToken = 0;
  function speak(text) {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window) || !text) return resolve();
      const my = ++speakToken;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ja-JP'; if (jaVoice) u.voice = jaVoice; u.rate = +settings.rate;
      let done = false;
      const fin = () => { if (done) return; done = true; clearTimeout(t); resolve(my === speakToken); };
      const t = setTimeout(fin, 1500 + text.length * 260 / u.rate);
      u.onend = fin; u.onerror = fin;
      speechSynthesis.speak(u);
    });
  }

  // ---------- 状態 ----------
  let G = null; // 対局状態
  function newState() {
    let userColor = settings.color === 'r' ? (Math.random() < 0.5 ? 0 : 1) : +settings.color;
    const base = L.LEVELS[settings.level];
    const k = +settings.tune;
    const level = Object.assign({}, base, { nodes: Math.max(1, Math.round(base.nodes * Math.pow(2.5, k))), margin: Math.round(base.margin * Math.pow(0.75, k)) });
    return {
      pos: S.Position.initial(), moves: [], records: [], seen: {}, userColor, level,
      hintsLeft: +settings.hints, phase: 'idle', pending: null, over: false, startedAt: new Date(),
    };
  }
  const sideName = (c) => (c === 0 ? '先手' : '後手');
  const sideKana = (c) => (c === 0 ? 'せんて' : 'ごて');
  const mark = (c) => (c === 0 ? '▲' : '△');
  const prevTo = () => (G.records.length ? G.records[G.records.length - 1].move.to : null);

  function setStatus(text, ring) {
    $('status').textContent = text;
    $('micRing').className = 'mic-ring' + (ring ? ' ' + ring : '');
  }
  function showLast() {
    const r = G.records[G.records.length - 1];
    $('lastMove').textContent = settings.showText === '1' && r ? mark(r.side) + r.text : '';
    $('plyLabel').textContent = G.records.length + '手目';
    $('hintLeft').textContent = +settings.hints >= 99 ? '∞' : String(G.hintsLeft);
    $('hintBtn').disabled = G.hintsLeft <= 0 || G.over;
  }
  function showChoice(yes, no) {
    $('choice').hidden = !yes;
    if (yes) { $('yesBtn').textContent = yes; $('noBtn').textContent = no; }
  }

  // ---------- 音声認識 ----------
  let rec = null, listening = false;
  function stopListening() { if (rec) { try { rec.abort(); } catch (e) { /* 無視 */ } } listening = false; }
  function listen() {
    if (!SR || listening || !G || G.over || G.phase === 'thinking' || G.phase === 'idle') return;
    rec = new SR();
    rec.lang = 'ja-JP'; rec.interimResults = true; rec.maxAlternatives = 5; rec.continuous = false;
    let finalAlts = null;
    rec.onstart = () => { listening = true; beep(880, 90); setStatus('聞いています…', 'listening'); $('heard').textContent = ''; };
    rec.onresult = (e) => {
      const res = e.results[e.results.length - 1];
      $('heard').textContent = '「' + res[0].transcript + '」';
      if (res.isFinal) { finalAlts = []; for (let i = 0; i < res.length; i++) finalAlts.push(res[i].transcript); }
    };
    rec.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { $('heard').textContent = 'マイクが許可されていません。ブラウザの設定で許可してください。'; } };
    rec.onend = () => {
      listening = false;
      if (finalAlts && finalAlts.length) { beep(520, 70); handleInput(finalAlts); }
      else if (G && !G.over && G.phase !== 'thinking') { beep(330, 120); setStatus(promptText(), ''); }
    };
    listening = true;
    try { rec.start(); } catch (e) { listening = false; }
  }
  function promptText() {
    if (G.phase === 'confirm') return 'よろしいですか？';
    if (G.phase === 'promote') return '成りますか？（成る／成らない）';
    if (G.phase === 'resign') return '投了しますか？';
    return 'あなたの番です（タップして話す）';
  }
  async function say(text, thenListen) {
    stopListening();
    const ok = await speak(text);
    if (ok && thenListen && settings.auto === '1') listen();
  }
  function cancelSpeech() { speakToken++; try { speechSynthesis.cancel(); } catch (e) { /* 無視 */ } }

  // ---------- 入力の処理 ----------
  async function handleInput(alts) {
    if (!G || G.over || G.phase === 'thinking' || G.phase === 'idle') return;
    const all = alts.join(' ');
    const cmd = S.parseCommand(all);
    const modsOf = (t) => S.tokenize(S.normalize(t)).filter((x) => x.k === 'mod').map((x) => x.v);

    if (G.phase === 'confirm' || G.phase === 'resign') {
      if (cmd === 'YES') { const ph = G.phase; G.phase = 'user'; showChoice(null); return ph === 'resign' ? endGame('lose', 'あなたが投了しました') : commitUser(G.pending); }
      if (cmd === 'NO') { G.phase = 'user'; G.pending = null; showChoice(null); setStatus(promptText()); return say('取り消しました。どうぞ。', true); }
      if (G.phase === 'resign') return say('はい、か、いいえ、でお答えください。', true);
      // 別の手を言い直した場合は、その手で確認し直す
    }
    if (G.phase === 'promote') {
      const mods = alts.flatMap(modsOf);
      const [pro, non] = G.pending.moves[0].promote ? G.pending.moves : [G.pending.moves[1], G.pending.moves[0]];
      let pick = null;
      if (mods.includes('不成') || cmd === 'NO') pick = non; else if (mods.includes('成') || cmd === 'YES') pick = pro;
      if (pick) { G.phase = 'user'; showChoice(null); return proposeMove(pick); }
    }

    const r = S.interpret(G.pos, alts, prevTo());
    if (r.status === 'ok') return proposeMove(r.move);
    if (r.status === 'ask_promote') {
      G.phase = 'promote'; G.pending = { moves: r.moves };
      showChoice('成る', '成らない'); setStatus(promptText());
      return say('成りますか。成る、か、成らない、でお答えください。', true);
    }
    if (r.status === 'ambiguous') {
      return say('その場所に行ける駒が複数あります。右、左、あがる、ひく、などを付けて言い直してください。', true);
    }
    if (G.phase === 'user' || G.phase === 'confirm' || G.phase === 'promote') {
      if (cmd === 'HINT') return useHint();
      if (cmd === 'REPEAT') return repeatLast();
      if (cmd === 'UNDO') return undo();
      if (cmd === 'RESIGN') return askResign();
    }
    if (G.phase === 'confirm') return say('はい、か、いいえ、でお答えください。', true);
    if (r.status === 'illegal') return say('その手は指せません。', true);
    return say('聞き取れませんでした。もう一度どうぞ。', true);
  }

  function proposeMove(m) {
    const ja = S.moveToJa(G.pos, m, prevTo());
    if (settings.confirm === '1') {
      G.phase = 'confirm'; G.pending = m;
      $('heard').textContent = '→ ' + mark(G.pos.turn) + ja.text;
      showChoice('はい', 'いいえ'); setStatus(promptText());
      return say(ja.kana + '。よろしいですか。', true);
    }
    return commitUser(m);
  }

  async function commitUser(m) {
    G.pending = null; showChoice(null);
    const ja = S.moveToJa(G.pos, m, prevTo());
    pushMove(m, ja);
    $('heard').textContent = '';
    if (settings.confirm !== '1') await say(ja.kana);
    if (await checkEnd()) return;
    aiTurn();
  }

  function pushMove(m, ja) {
    G.records.push({ move: m, text: ja.text, kana: ja.kana, side: G.pos.turn });
    G.moves.push(S.moveToUsi(m));
    G.pos = G.pos.afterMove(m);
    const k = G.pos.key(); G.seen[k] = (G.seen[k] || 0) + 1;
    showLast();
  }

  // 終局判定。終わっていれば true
  async function checkEnd() {
    if (G.pos.legalMoves().length === 0) {
      const loserIsUser = G.pos.turn === G.userColor;
      await endGame(loserIsUser ? 'lose' : 'win', '詰みです。' + (loserIsUser ? 'あなたの負けです。' : 'あなたの勝ちです。'));
      return true;
    }
    if (G.seen[G.pos.key()] >= 4) { await endGame('draw', '千日手です。引き分けです。'); return true; }
    if (G.records.length >= 400) { await endGame('draw', '400手に達したので引き分けです。'); return true; }
    return false;
  }

  async function aiTurn() {
    G.phase = 'thinking'; stopListening(); setStatus('考えています…', 'thinking');
    const t0 = Date.now();
    let r;
    try { r = await engine.think(G.moves, G.level.nodes, G.level.multipv); }
    catch (e) { setStatus('エンジンエラー：' + e.message); return; }
    if (!G || G.over) return;
    if (r.bestmove === 'resign') return endGame('win', '相手が投了しました。あなたの勝ちです。');
    if (r.bestmove === 'win') return endGame('lose', '相手の入玉宣言勝ちです。');
    let usi = L.chooseMove(r, G.level);
    const legal = G.pos.legalMoves();
    let m = legal.find((x) => S.moveToUsi(x) === usi);
    if (!m) m = legal.find((x) => S.moveToUsi(x) === r.bestmove) || legal[0];
    const wait = 700 - (Date.now() - t0); if (wait > 0) await new Promise((res) => setTimeout(res, wait));
    if (!G || G.over) return;
    const ja = S.moveToJa(G.pos, m, prevTo());
    const side = G.pos.turn;
    pushMove(m, ja);
    G.lastAiSpeech = sideKana(side) + '、' + ja.kana;
    const check = settings.check === '1' && G.pos.inCheck(G.pos.turn);
    G.phase = 'user';
    setStatus(promptText());
    if (G.pos.legalMoves().length === 0) { await speak(G.lastAiSpeech); await checkEnd(); return; }
    if (G.seen[G.pos.key()] >= 4) { await speak(G.lastAiSpeech); await checkEnd(); return; }
    await say(G.lastAiSpeech + (check ? '。王手です。' : ''), true);
  }

  // ---------- コマンド ----------
  async function repeatLast() {
    if (!G) return;
    if (!G.lastAiSpeech) return say('まだ相手は指していません。', true);
    return say(G.lastAiSpeech, true);
  }
  async function undo() {
    if (!G || G.over || G.phase === 'thinking') return;
    // 自分の直前の手まで戻す（相手の手と自分の手の2手）
    let back = G.records.length && G.records[G.records.length - 1].side !== G.userColor ? 2 : 0;
    if (back === 0 || G.records.length < back) return say('戻せる手がありません。', true);
    const keep = G.records.slice(0, -back);
    G.pos = S.Position.initial(); G.moves = []; G.records = []; G.seen = {};
    for (const r of keep) pushMove(r.move, r);
    G.phase = 'user'; G.pending = null; showChoice(null);
    const last = G.records[G.records.length - 1];
    G.lastAiSpeech = last && last.side !== G.userColor ? sideKana(last.side) + '、' + last.kana : null;
    showLast(); setStatus(promptText());
    return say('待った。2手戻しました。' + (G.lastAiSpeech ? '直前の手は、' + G.lastAiSpeech + '。' : '') + 'どうぞ。', true);
  }
  function askResign() {
    if (!G || G.over || G.phase === 'thinking') return;
    G.phase = 'resign'; showChoice('はい', 'いいえ'); setStatus(promptText());
    return say('投了しますか。', true);
  }

  // ---------- 盤面表示 ----------
  function renderBoard(pos, lastTo) {
    const flip = G.userColor === 1;
    const v = $('boardView'); v.innerHTML = '';
    const handEl = (c) => {
      const d = document.createElement('div'); d.className = 'hand';
      const who = c === G.userColor ? 'あなた' : '相手';
      d.innerHTML = '<span class="who">' + mark(c) + who + 'の持ち駒</span>';
      let any = false;
      for (const t of S.HAND_ORDER) {
        const n = pos.hands[c][t]; if (!n) continue; any = true;
        const s = document.createElement('span');
        s.innerHTML = (c !== G.userColor ? '<span class="opp-piece">' + S.NAME[t] + '</span>' : S.NAME[t]) + (n > 1 ? n : '');
        d.appendChild(s);
      }
      if (!any) d.insertAdjacentHTML('beforeend', '<span class="who">なし</span>');
      return d;
    };
    v.appendChild(handEl(1 - G.userColor));
    const wrap = document.createElement('div'); wrap.className = 'board-wrap';
    const files = document.createElement('div'); files.className = 'files';
    const fileOrder = flip ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : [9, 8, 7, 6, 5, 4, 3, 2, 1];
    const rankOrder = flip ? [9, 8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8, 9];
    files.innerHTML = fileOrder.map((f) => '<span>' + f + '</span>').join('');
    const board = document.createElement('div'); board.className = 'board';
    for (const r of rankOrder) for (const f of fileOrder) {
      const i = S.sq(f, r), x = pos.board[i];
      const c = document.createElement('div'); c.className = 'cell';
      if (i === lastTo) c.classList.add('last');
      if (x) {
        if (x.c !== G.userColor) c.classList.add('opp');
        if (x.p) c.classList.add('pro');
        c.innerHTML = '<span>' + (x.p ? S.BOARD_CHAR_PRO[x.t] : (x.t === 'K' && x.c === 1 ? '王' : S.BOARD_CHAR[x.t])) + '</span>';
      }
      board.appendChild(c);
    }
    const ranks = document.createElement('div'); ranks.className = 'ranks';
    ranks.innerHTML = rankOrder.map((r) => '<span>' + S.NUM_KANJI[r] + '</span>').join('');
    wrap.appendChild(files); wrap.appendChild(document.createElement('span'));
    wrap.appendChild(board); wrap.appendChild(ranks);
    v.appendChild(wrap);
    v.appendChild(handEl(G.userColor));
  }

  let hintTimer = null;
  function openBoard(title) {
    renderBoard(G.pos, prevTo());
    $('overlayTitle').textContent = title;
    $('boardOverlay').hidden = false;
  }
  function closeBoard() {
    clearInterval(hintTimer); hintTimer = null;
    $('boardOverlay').hidden = true; $('overlayTimer').textContent = '';
    if (G && !G.over && G.phase !== 'thinking') { setStatus(promptText()); if (settings.auto === '1') listen(); }
  }
  async function useHint() {
    if (!G || G.over) return;
    if (G.hintsLeft <= 0) return say('ヒントはもう使えません。', true);
    if (+settings.hints < 99) G.hintsLeft--;
    showLast();
    stopListening();
    $('endPanel').hidden = true; $('closeOverlay').hidden = false;
    openBoard('現在の局面（' + (G.records.length) + '手目）');
    const sec = +settings.hintSec;
    if (sec > 0) {
      let left = sec; $('overlayTimer').textContent = left + '秒';
      hintTimer = setInterval(() => { left--; $('overlayTimer').textContent = left + '秒'; if (left <= 0) closeBoard(); }, 1000);
    }
    await speak(+settings.hints >= 99 ? 'ヒント。' : 'ヒント。残り' + G.hintsLeft + '回です。');
  }

  // ---------- 終局 ----------
  async function endGame(kind, message) {
    G.over = true; G.phase = 'over'; stopListening(); showChoice(null);
    releaseWake();
    setStatus(message, '');
    const resultLine = /投了/.test(message) ? '投了' : /入玉/.test(message) ? '入玉勝ち' : /400手/.test(message) ? '持将棋' : kind === 'draw' ? '千日手' : '詰み';
    G.kif = S.toKif(G.records, {
      date: G.startedAt.toLocaleString('ja-JP'),
      sente: G.userColor === 0 ? 'あなた' : 'やねうら王（' + L.LEVELS[settings.level].label + '）',
      gote: G.userColor === 1 ? 'あなた' : 'やねうら王（' + L.LEVELS[settings.level].label + '）',
      result: resultLine,
    });
    $('resultText').textContent = message;
    $('kifuText').textContent = G.records.map((r, i) => (i + 1) + ' ' + mark(r.side) + r.text).join('　');
    $('endPanel').hidden = false; $('closeOverlay').hidden = false;
    openBoard('終局（' + G.records.length + '手）');
    await speak(message);
  }

  // ---------- 画面の操作 ----------
  let wakeLock = null;
  async function holdWake() { try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* 無視 */ } }
  function releaseWake() { try { wakeLock && wakeLock.release(); } catch (e) { /* 無視 */ } wakeLock = null; }

  async function startGame() {
    if (!engineReady) return;
    try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch (e) { /* 無視 */ }
    if ('speechSynthesis' in window) { const u = new SpeechSynthesisUtterance(''); speechSynthesis.speak(u); }
    G = newState();
    engine.newGame();
    $('setup').classList.remove('active'); $('play').classList.add('active');
    $('boardOverlay').hidden = true;
    $('sideLabel').textContent = 'あなた：' + sideName(G.userColor) + '　' + L.LEVELS[settings.level].label.replace(/（.*/, '');
    $('lastMove').textContent = ''; $('heard').textContent = '';
    showLast(); holdWake();
    const intro = '対局開始。あなたは' + sideName(G.userColor) + 'です。';
    if (G.userColor === 0) { G.phase = 'user'; setStatus(promptText()); await say(intro + 'どうぞ。', true); }
    else { G.phase = 'thinking'; await speak(intro); aiTurn(); }
  }

  $('startBtn').addEventListener('click', startGame);
  $('tapArea').addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    if (listening) { stopListening(); return; }
    if (G && !G.over && G.phase !== 'thinking') { cancelSpeech(); listen(); }
  });
  $('yesBtn').addEventListener('click', (e) => { e.stopPropagation(); handleInput([G.phase === 'promote' ? '成る' : 'はい']); });
  $('noBtn').addEventListener('click', (e) => { e.stopPropagation(); handleInput([G.phase === 'promote' ? '成らない' : 'いいえ']); });
  $('typeForm').addEventListener('submit', (e) => {
    e.preventDefault(); const v = $('typeInput').value.trim(); if (!v) return;
    $('typeInput').value = ''; $('heard').textContent = '「' + v + '」'; handleInput([v]);
  });
  $('hintBtn').addEventListener('click', useHint);
  $('repeatBtn').addEventListener('click', repeatLast);
  $('undoBtn').addEventListener('click', undo);
  $('resignBtn').addEventListener('click', askResign);
  $('closeOverlay').addEventListener('click', () => { if (G && G.over) { $('boardOverlay').hidden = true; } else closeBoard(); });
  $('newGame').addEventListener('click', () => { $('boardOverlay').hidden = true; $('play').classList.remove('active'); $('setup').classList.add('active'); G = null; });
  $('copyKif').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(G.kif); $('copyKif').textContent = 'コピーしました'; } catch (e) { $('copyKif').textContent = 'コピーできませんでした'; }
  });
  $('saveKif').addEventListener('click', () => {
    const blob = new Blob([G.kif], { type: 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'mekakushi-' + G.startedAt.toISOString().slice(0, 16).replace(/[:T]/g, '') + '.kif';
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  document.addEventListener('keydown', (e) => {
    if (!G || document.activeElement === $('typeInput')) return;
    if (e.code === 'Space') { e.preventDefault(); if (!$('boardOverlay').hidden && !G.over) return closeBoard(); if (listening) stopListening(); else if (!G.over && G.phase !== 'thinking') { cancelSpeech(); listen(); } }
    else if (e.key === 'h' || e.key === 'H') useHint();
    else if (e.key === 'r' || e.key === 'R') repeatLast();
    else if (e.key === 'Escape' && !$('boardOverlay').hidden && !G.over) closeBoard();
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && G && !G.over) holdWake(); });

  // テスト用に公開
  window.__app = { get G() { return G; }, handleInput, engine };
})();
