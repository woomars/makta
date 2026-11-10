// 화면 그리기. 방장이 보내 준 view만 보고 그린다.
(function (root) {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const SCREENS = ['start', 'rules', 'join', 'lobby', 'game', 'result'];
  const handlers = {};
  const emit = (event, arg) => (handlers[event] || []).forEach((fn) => fn(arg));
  const { Cards } = root;

  const RULES = [
    ['stack', '폭격·융단폭격 쌓기', '받을 장수를 같은 공격 카드로 다음 사람에게 넘겨요'],
    ['drawUntil', '낼 때까지 뽑기', '낼 수 있는 카드가 나올 때까지 뽑아요'],
    ['sevenZero', '7과 0', '7은 고른 사람과 손패 교환, 0은 모두 손패를 옆으로 넘겨요'],
    ['jumpIn', '끼어들기', '맨 위와 똑같은 카드가 있으면 차례가 아니어도 내요'],
    ['multi', '같은 숫자 여러 장 내기', '같은 숫자를 한 번에 여러 장 내요'],
    ['challenge', '융단폭격 의심하기', '융단폭격을 받으면 낼 수 있는 색이 있었는지 의심해요'],
    ['turnTimer', '차례 시간 제한 20초', '20초가 지나면 자동으로 한 장 뽑아요'],
    ['score', '점수 모드 (500점)', '남은 카드 점수를 모아 먼저 500점이면 우승'],
  ];
  const ATTACKS = [
    [{ kind: 'skip', color: 'b' }, '다음 사람 한 번 쉬기'],
    [{ kind: 'rev', color: 'y' }, '방향 바꾸기'],
    [{ kind: 'draw2', color: 'r' }, '다음 사람 2장'],
    [{ kind: 'wild', color: null }, '색 바꾸기'],
    [{ kind: 'wild4', color: null }, '색 바꾸기 + 다음 사람 4장'],
  ];
  const BOT_TAG = { low: '하수', mid: '중수', high: '고수' };

  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

  // 받침이 있으면 앞의 조사, 없으면 뒤의 조사. 예: josa('아빠', '이', '가') → '아빠가'
  function hasBatchim(word) {
    const last = String(word).charCodeAt(String(word).length - 1);
    if (last >= 0xac00 && last <= 0xd7a3) return (last - 0xac00) % 28 !== 0;
    if (last >= 0x30 && last <= 0x39) return '013678'.includes(String.fromCharCode(last));
    return false;
  }
  function josa(word, withB, withoutB) {
    return word + (hasBatchim(word) ? withB : withoutB);
  }
  // '으로/로'는 ㄹ 받침도 '로'를 쓴다.
  function ro(word) {
    const last = String(word).charCodeAt(String(word).length - 1);
    const jong = last >= 0xac00 && last <= 0xd7a3 ? (last - 0xac00) % 28 : 0;
    return word + (jong && jong !== 8 ? '으로' : '로');
  }

  function setRole(view) {
    const isHost = view.me === view.hostId;
    document.body.classList.toggle('is-host', isHost);
    document.body.classList.toggle('is-guest', !isHost);
  }

  function show(screen) {
    for (const s of SCREENS) $('#screen-' + s).hidden = s !== screen;
  }

  // ---- 대기실 ----

  let lastQr = null;
  let lobbyRules = null;
  function renderLobby(view, code, qrUrl) {
    setRole(view);
    lobbyRules = view.rules;
    if (code) $('#lobby-code').textContent = code;
    if (qrUrl && qrUrl !== lastQr && root.qrcode) {
      const q = root.qrcode(0, 'M');
      q.addData(qrUrl);
      q.make();
      $('#qr').innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
      lastQr = qrUrl;
    }
    const isHost = view.me === view.hostId;
    const rows = view.players.map((p) => {
      let right;
      if (p.bot) right = `<span class="tag-bot">봇</span>${isHost ? `<button class="x" data-act="remove-bot" data-id="${esc(p.id)}" aria-label="${esc(p.name)} 빼기">✕</button>` : ''}`;
      else right = `<small>${p.id === view.hostId ? '방장' : '준비됨'}</small>`;
      return `<li><span>${esc(p.name)}${p.id === view.me ? ' (나)' : ''}</span>${right}</li>`;
    });
    for (let i = view.players.length; i < 10; i++) rows.push('<li class="empty">빈자리</li>');
    $('#lobby-players').innerHTML = rows.join('');
    const n = view.players.length;
    const start = $('#start-btn');
    start.textContent = `시작하기 (${n}명)`;
    start.disabled = n < 2;
    $('#bot-add').disabled = n >= 10;

    const on = RULES.filter(([k]) => view.rules[k]);
    $('#rule-summary').textContent = `변형 규칙 (${on.length}개 켜짐)`;
    $('#rule-switches').innerHTML = RULES.map(([k, title, desc]) => `<label class="switch"><span class="txt"><b>${title}</b><small>${desc}</small></span>`
      + `<input type="checkbox" data-rule="${k}"${view.rules[k] ? ' checked' : ''}><span class="sw"></span></label>`).join('');
    $('#guest-rules').innerHTML = on.length
      ? on.map(([, title]) => `<li>${title}</li>`).join('')
      : '<li>변형 규칙 없이 기본 규칙으로 해요</li>';
  }

  // ---- 결과 ----

  function renderResult(view) {
    setRole(view);
    const r = view.result;
    const nameOf = (id) => (view.players.find((p) => p.id === id) || { name: '?' }).name;
    const over = view.phase === 'matchover';
    const winner = over && view.rules.score ? view.matchWinnerId : r && r.winnerId;
    $('#result-title').textContent = winner ? `${josa(nameOf(winner), '이', '가')} ${over ? '이겼다!' : '막타!'}` : '결과';
    $('#ranking').innerHTML = r ? r.ranking.map((row, i) => {
      const right = view.rules.score
        ? (row.id === r.winnerId ? `+${r.gained}점` : `${row.count}장 · ${row.points}점`)
        : `${row.count}장`;
      return `<li class="${row.id === r.winnerId ? 'win' : ''}"><span class="rank">${i + 1}</span>${esc(nameOf(row.id))}<small>${right}</small></li>`;
    }).join('') : '';
    const totals = $('#totals');
    totals.hidden = !view.rules.score;
    if (view.rules.score) {
      const sorted = view.players.slice().sort((a, b) => b.score - a.score);
      totals.innerHTML = `<h3>누적 점수 (500점 우승)</h3>${sorted.map((p) => `<div><span>${esc(p.name)}</span><b>${p.score}점</b></div>`).join('')}`;
    }
    $('#next-btn').hidden = over;
    $('#again-btn').hidden = !over;
  }

  // ---- 게임 화면 ----

  const CARD_W = 52;
  const MIN_STEP = 38; // 겹쳐도 카드마다 이만큼은 보인다
  const ONE_ROW_MAX = 9;
  let gv = null; // 지금 그린 view
  let roomCode = '';
  let sel = []; // 고른 카드 id (누른 순서)
  let selKey = '';
  let lastSeq = null;
  let gotAt = 0;
  let peekTimer = null;
  let fxTimer = null;

  const nameOf = (view, id) => (view.players.find((p) => p.id === id) || { name: '?' }).name;
  const colorName = (c) => (Cards.COLOR[c] ? Cards.COLOR[c].name : '');

  function logLine(view, e) {
    const n = (id) => esc(nameOf(view, id));
    const subj = (id) => esc(josa(nameOf(view, id), '이', '가'));
    switch (e.type) {
      case 'play': {
        const last = e.cards[e.cards.length - 1];
        const what = e.cards.length > 1 ? `${Cards.spoken(e.cards[0])} 외 ${e.cards.length - 1}장` : Cards.spoken(last);
        return `${subj(e.by)} ${esc(josa(what, '을', '를'))} 냈어요`;
      }
      case 'jump': return `${n(e.by)} 끼어들기!`;
      case 'draw': return e.count ? `${subj(e.by)} ${e.count}장 뽑았어요` : `${n(e.by)} 뽑을 카드가 없어요`;
      case 'attack': return `${n(e.by)} → ${n(e.target)} +${e.count} ${e.kind === 'wild4' ? '융단폭격' : '폭격'}!`;
      case 'skip': return `${n(e.target)} 기절!`;
      case 'reverse': return '반사! 방향이 바뀌었어요';
      case 'color': return `${subj(e.by)} ${esc(ro(colorName(e.color)))} 조준!`;
      case 'swap': return `${n(e.a)} ⇄ ${n(e.b)} 손패 교환`;
      case 'rotate': return '모두 손패를 넘겼어요';
      case 'call': return `${n(e.by)} 막타!`;
      case 'caught': return `${subj(e.by)} ${esc(josa(nameOf(view, e.target), '을', '를'))} 잡았다! +2`;
      case 'challenge': return e.success ? `의심 성공! ${n(e.target)} +4` : `의심 실패! ${n(e.by)} +6`;
      case 'win': return `${n(e.by)} 막타! 승리`;
      default: return '';
    }
  }

  function setRoom(code) {
    roomCode = code || '';
  }

  function chipHtml(view, p, hit) {
    const me = p.id === view.me;
    const badges = [];
    if (p.count === 1 && p.called) badges.push('<span class="badge call">막타!</span>');
    if (p.catchable) badges.push('<span class="badge warn">막타 안 외침</span>');
    if (hit !== undefined) badges.push(`<span class="badge dmg">+${hit}</span>`);
    const sub = p.proxy ? '<small class="proxy">봇이 대신 하는 중</small>' : p.bot ? '<small class="bot">봇</small>' : '';
    const pickable = view.await && view.await.kind === 'swap' && view.await.playerId === view.me && !me;
    const cls = ['chip', p.isTurn ? 'turn' : '', me ? 'me' : '', hit !== undefined ? 'hit' : '', pickable ? 'pickable' : ''].filter(Boolean).join(' ');
    const boom = hit !== undefined ? Cards.icon('i-boom', 'burst') : '';
    const tag = pickable ? 'button' : 'div';
    return `<${tag} class="${cls}" data-id="${esc(p.id)}"${pickable ? ` data-swap="${esc(p.id)}" type="button"` : ''}>`
      + `<b>${me ? '나' : esc(p.name)}</b><span class="n">${p.count}장</span>${sub}${badges.join('')}${boom}</${tag}>`;
  }

  // 나부터 진행 방향 순서로 놓는다. 차례가 바뀔 때만 지금 차례가 보이게 민다(골라야 할 때 밀어 둔 자리를 지킨다).
  let ribbonTurn = null;
  function renderRibbon(view, hits) {
    const i = view.players.findIndex((p) => p.id === view.me);
    const n = view.players.length;
    const order = Array.from({ length: n }, (_, k) => view.players[(((i + k * view.dir) % n) + n) % n]);
    const arrow = '<span class="arrow" aria-hidden="true">›</span>';
    const ribbon = $('#ribbon');
    const keep = ribbon.scrollLeft;
    ribbon.innerHTML = order.map((p) => chipHtml(view, p, hits[p.id])).join(arrow);
    const turn = ribbon.querySelector('.chip.turn');
    if (turn && view.turnId !== ribbonTurn) ribbon.scrollLeft = Math.max(0, turn.offsetLeft - (ribbon.clientWidth - turn.offsetWidth) / 2);
    else ribbon.scrollLeft = keep;
    ribbonTurn = view.turnId;
  }

  function myTurn(view) {
    return view.phase === 'playing' && view.turnId === view.me && !view.await;
  }

  function cardMode(view) {
    if (view.phase !== 'playing' || view.await) return null;
    if (view.turnId === view.me) return 'play';
    return view.rules.jumpIn ? 'jump' : null;
  }

  function resetSelection(view) {
    const key = `${view.topVersion}|${view.turnId}|${view.phase}|${view.drewId}|${view.hand.length}`;
    if (key !== selKey) sel = [];
    selKey = key;
    sel = sel.filter((id) => view.hand.some((c) => c.id === id));
    if (sel.length && !view.playableIds.includes(sel[0])) sel = [];
  }

  function layoutRow(row, cards) {
    row.replaceChildren(...cards);
    const avail = row.clientWidth || 358;
    const k = cards.length;
    let step = k > 1 ? Math.min(CARD_W + 6, (avail - CARD_W) / (k - 1)) : 0;
    const scroll = k > 1 && step < MIN_STEP;
    if (scroll) step = MIN_STEP;
    cards.forEach((el, i) => { el.style.marginLeft = i ? `${step - CARD_W}px` : '0'; });
    row.classList.toggle('scroll', scroll);
  }

  function isSameNumber(view, id) {
    const a = view.hand.find((c) => c.id === sel[0]);
    const b = view.hand.find((c) => c.id === id);
    return !!(a && b && a.kind === 'num' && b.kind === 'num' && a.value === b.value);
  }

  function renderHand(view) {
    const mode = cardMode(view);
    const els = view.hand.map((c) => {
      const el = Cards.face(c);
      const playable = mode && view.playableIds.includes(c.id);
      const addable = mode === 'play' && view.rules.multi && sel.length && isSameNumber(view, c.id);
      el.classList.add('hc');
      el.setAttribute('role', 'button');
      if (!playable && !addable) el.classList.add('dim');
      else el.tabIndex = 0;
      if (sel.includes(c.id)) el.classList.add('sel');
      if (sel.length && c.id === sel[sel.length - 1]) el.classList.add('last');
      return el;
    });
    // 한 줄에 9장까지는 카드마다 38px 넘게 보인다. 그보다 많으면 두 줄로 나눈다.
    const half = els.length <= ONE_ROW_MAX ? els.length : Math.ceil(els.length / 2);
    layoutRow($('#hrow1'), els.slice(0, half));
    layoutRow($('#hrow2'), els.slice(half));
    $('#hrow2').hidden = half === els.length;
  }

  function onCardTap(id) {
    const view = gv;
    const mode = view && cardMode(view);
    if (!mode || !view.hand.some((c) => c.id === id)) return;
    const multiAdd = mode === 'play' && view.rules.multi && sel.length > 0 && isSameNumber(view, id);
    if (sel.includes(id)) {
      if (mode === 'play') emit('play', sel.slice());
      else emit('jump', id);
      sel = [];
    } else if (multiAdd) {
      sel.push(id);
    } else if (view.playableIds.includes(id)) {
      sel = [id];
    } else {
      return;
    }
    renderHand(view);
  }

  function hazardState(view) {
    const me = view.players.find((p) => p.id === view.me);
    if (!me || (view.phase !== 'playing' && view.phase !== 'judging')) return { label: '막타!', act: null };
    const n = view.hand.length;
    if ((n === 2 && view.turnId === view.me && !view.await && !me.called) || (n === 1 && !me.called)) return { label: '막타!', act: 'call' };
    if (view.players.some((p) => p.id !== view.me && p.catchable)) return { label: '잡았다!', act: 'catch' };
    return { label: '막타!', act: null };
  }

  function renderButtons(view) {
    const draw = $('#draw-btn');
    const mine = myTurn(view);
    if (view.pending && mine) { draw.textContent = `받기 (${view.pending.count}장)`; draw.dataset.do = 'draw'; }
    else if (view.drewId !== null && mine) { draw.textContent = '그만 (카드 갖기)'; draw.dataset.do = 'pass'; }
    else { draw.textContent = '뽑기'; draw.dataset.do = 'draw'; }
    draw.disabled = !mine;
    $('#challenge-btn').hidden = !(view.canChallenge && mine);
    const h = hazardState(view);
    const hz = $('#hazard-btn');
    hz.firstElementChild.textContent = h.label;
    hz.dataset.do = h.act || '';
    hz.disabled = !h.act;
    hz.classList.toggle('urgent', h.act === 'catch');
  }

  function renderOverlays(view) {
    const mineAwait = view.await && view.await.playerId === view.me && view.phase === 'playing';
    $('#color-pick').hidden = !(mineAwait && view.await.kind === 'color');
    $('#swap-hint').hidden = !(mineAwait && view.await.kind === 'swap');
    if (view.peek) {
      const ch = view.log.find((e) => e.type === 'challenge');
      $('#peek-title').textContent = ch ? `${nameOf(view, ch.target)}의 손패` : '상대 손패';
      $('#peek-cards').replaceChildren(...view.peek.map((c) => Cards.face(c)));
      $('#peek').hidden = false;
      clearTimeout(peekTimer);
      peekTimer = setTimeout(() => { $('#peek').hidden = true; }, 3000);
    }
  }

  function drawClock() {
    const v = gv;
    if (!v) return;
    const sec = $('#now-sec');
    const fuse = $('#fuse');
    if (v.phase === 'judging' || v.turnMsLeft === null) { sec.textContent = ''; fuse.hidden = true; return; }
    const ms = Math.max(0, v.turnMsLeft - (performance.now() - gotAt));
    sec.textContent = `${Math.ceil(ms / 1000)}초`;
    fuse.hidden = false;
    fuse.firstElementChild.style.width = `${(ms / 20000) * 100}%`;
  }
  setInterval(drawClock, 250);

  function playFx(kind) {
    const fx = $('#fx');
    fx.className = 'fx';
    void fx.offsetWidth;
    fx.classList.add(kind);
    fx.innerHTML = Cards.icon('i-boom', 'fx-boom');
    clearTimeout(fxTimer);
    fxTimer = setTimeout(() => { fx.className = 'fx'; fx.innerHTML = ''; }, 1000);
  }

  function renderGame(view) {
    setRole(view);
    const fresh = lastSeq === null || view.seq < lastSeq ? [] : view.log.slice(0, Math.min(3, view.seq - lastSeq));
    lastSeq = view.seq;
    gv = view;
    gotAt = performance.now();
    resetSelection(view);

    const hits = {};
    for (const e of fresh) if (e.type === 'attack' || e.type === 'caught') hits[e.target] = e.type === 'caught' ? 2 : e.count;
    if (fresh.some((e) => e.type === 'win')) playFx('win');

    $('#g-info').textContent = `${roomCode ? `방 ${roomCode} · ` : ''}${view.dir === 1 ? '시계 방향' : '반대 방향'}`;
    renderRibbon(view, hits);
    const turnName = view.phase === 'judging' ? '끼어들기 판정 중' : view.turnId === view.me ? '나' : nameOf(view, view.turnId);
    $('#now-name').textContent = turnName;
    $('#screen-game').classList.toggle('my-turn', myTurn(view));
    $('#log').innerHTML = view.log.map((e) => `<div>${logLine(view, e)}</div>`).join('');

    $('#pile').replaceChildren(Cards.back({ big: true }));
    $('#pile').insertAdjacentHTML('beforeend', `<span class="pile-n">${view.drawCount}장</span>`);
    $('#top-slot').replaceChildren(...(view.top ? [Cards.face(view.top, { big: true })] : []));
    const ci = Cards.COLOR[view.color];
    $('#color-info').innerHTML = ci
      ? `지금 색: <b>${ci.name}</b> <svg style="color:var(--c-${view.color})" aria-hidden="true"><use href="#${ci.icon}"/></svg> ${ci.bomb}`
        + (view.pending ? ` · <b class="owe">받을 카드 ${view.pending.count}장</b>` : '')
      : '';
    renderHand(view);
    renderButtons(view);
    renderOverlays(view);
    drawClock();
  }

  function bindGame() {
    $('#hand').addEventListener('click', (e) => {
      const el = e.target.closest('.hc');
      if (el) onCardTap(Number(el.dataset.id));
    });
    $('#hand').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const el = e.target.closest('.hc');
      if (el) { e.preventDefault(); onCardTap(Number(el.dataset.id)); }
    });
    $('#draw-btn').addEventListener('click', (e) => { const d = e.currentTarget.dataset.do; if (d) emit(d); });
    $('#challenge-btn').addEventListener('click', () => emit('challenge'));
    $('#hazard-btn').addEventListener('click', (e) => { const d = e.currentTarget.dataset.do; if (d) emit(d); });
    $('#ribbon').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-swap]');
      if (chip) emit('swap', chip.dataset.swap);
    });
    $('#color-grid').innerHTML = Object.entries(Cards.COLOR).map(([id, c]) => `<button class="cpick c-${id}" data-color="${id}" type="button">`
      + `<svg aria-hidden="true"><use href="#${c.icon}"/></svg><b>${c.name}</b><small>${c.bomb}</small></button>`).join('');
    $('#color-grid').addEventListener('click', (e) => {
      const b = e.target.closest('[data-color]');
      if (b) { $('#color-pick').hidden = true; emit('color', b.dataset.color); }
    });
    $('#peek').addEventListener('click', () => { $('#peek').hidden = true; });
  }

  // ---- 알림 ----

  let toastTimer = null;
  function toast(text, ms = 2000) {
    const t = $('#toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }

  let retryFn = null;
  function error(text, opts = {}) {
    $('#error-text').textContent = text;
    retryFn = opts.retry || null;
    $('#error-retry').hidden = !retryFn;
    $('#error').hidden = false;
  }

  function on(event, fn) {
    (handlers[event] = handlers[event] || []).push(fn);
  }

  function setMessage(screen, text) {
    const el = $(screen === 'join' ? '#join-msg' : '#start-msg');
    if (el) el.textContent = text || '';
  }

  // ---- 입력 ----

  function codeValue() {
    return $('#code').value.replace(/\D/g, '').slice(0, 4);
  }

  function drawDigits() {
    const v = codeValue();
    $('#code').value = v;
    document.querySelectorAll('.boxes span').forEach((s, i) => {
      s.textContent = v[i] || '';
      s.classList.toggle('cur', i === Math.min(v.length, 3));
    });
  }

  function fillRules() {
    $('#attack-list').innerHTML = '';
    for (const [card, text] of ATTACKS) {
      const li = document.createElement('li');
      li.appendChild(Cards.face({ id: -1, value: null, ...card }));
      li.insertAdjacentHTML('beforeend', `<span><b>${Cards.NAME[card.kind]}</b> · ${text}</span>`);
      $('#attack-list').appendChild(li);
    }
    $('#bomb-list').innerHTML = Object.values(Cards.COLOR).map((c, i) => {
      const id = Object.keys(Cards.COLOR)[i];
      return `<li><svg style="color:var(--c-${id})" aria-hidden="true"><use href="#${c.icon}"/></svg><b>${c.name}</b> ${c.bomb}</li>`;
    }).join('');
  }

  function bind() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn || btn.disabled) return;
      const act = btn.dataset.act;
      if (act === 'join-submit') emit('join-submit', codeValue());
      else if (act === 'bot-menu') $('#bot-menu').hidden = !$('#bot-menu').hidden;
      else if (act === 'add-bot') { $('#bot-menu').hidden = true; emit('add-bot', btn.dataset.level); }
      else if (act === 'remove-bot') emit('remove-bot', btn.dataset.id);
      else emit(act);
    });
    $('#rule-switches').addEventListener('change', (e) => {
      const k = e.target.dataset.rule;
      if (!k || !lobbyRules) return;
      emit('rules', { ...lobbyRules, [k]: e.target.checked });
    });
    $('#name').addEventListener('input', (e) => emit('name-change', e.target.value));
    const code = $('#code');
    code.addEventListener('input', drawDigits);
    code.addEventListener('focus', () => code.parentElement.classList.add('focus'));
    code.addEventListener('blur', () => code.parentElement.classList.remove('focus'));
    code.addEventListener('keydown', (e) => { if (e.key === 'Enter') emit('join-submit', codeValue()); });
    $('#error-ok').addEventListener('click', () => { $('#error').hidden = true; });
    $('#error-retry').addEventListener('click', () => {
      $('#error').hidden = true;
      if (retryFn) retryFn();
    });
    fillRules();
    bindGame();
    drawDigits();
  }

  function clearCode() {
    $('#code').value = '';
    drawDigits();
  }

  bind();

  root.UI = {
    show, renderLobby, renderGame, renderResult, setRoom, toast, error, on, setMessage, clearCode,
    josa, ro, esc, emit,
    focusCode: () => $('#code').focus(),
    setName: (name) => { $('#name').value = name; },
    getName: () => $('#name').value,
  };
})(this);
