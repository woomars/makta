// 화면 그리기. 방장이 보내 준 view만 보고 그린다.
(function (root) {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const SCREENS = ['start', 'rules', 'join', 'lobby', 'game', 'result'];
  const handlers = {};
  const emit = (event, arg) => (handlers[event] || []).forEach((fn) => fn(arg));
  const { Cards, I18n } = root;
  const t = (key, params) => I18n.t(key, params);
  const { josa, ro } = I18n;

  // 규칙 이름과 설명은 사전의 'rule.<키>', 'rule.<키>.desc'
  const RULES = ['stack', 'drawUntil', 'sevenZero', 'jumpIn', 'multi', 'challenge', 'turnTimer', 'score'];
  const ATTACKS = [
    { kind: 'skip', color: 'b' },
    { kind: 'rev', color: 'y' },
    { kind: 'draw2', color: 'r' },
    { kind: 'wild', color: null },
    { kind: 'wild4', color: null },
  ];

  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

  // 방장이 정한 이름을 지금 언어로 보여 준다. 봇 이름은 방장 쪽에서 '고수1'처럼 한국어로 만들어지므로
  // 등급 부분만 바꿔 끼운다. 사람이 고른 이름은 그대로 둔다.
  function displayName(p) {
    if (!p) return '?';
    if (p.bot) {
      for (const level of ['low', 'mid', 'high']) {
        const ko = I18n.tr('ko', 'bot.' + level);
        const rest = p.name.startsWith(ko) ? p.name.slice(ko.length) : null;
        if (rest !== null && /^\d+$/.test(rest)) return t('bot.name', { label: t('bot.' + level), n: rest });
      }
    } else if (p.name === I18n.tr('ko', 'noName')) {
      return t('noName');
    }
    return p.name;
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
      const name = displayName(p);
      if (p.bot) right = `<span class="tag-bot">${esc(t('bot'))}</span>${isHost ? `<button class="x" data-act="remove-bot" data-id="${esc(p.id)}" aria-label="${esc(t('lobby.remove', { name }))}">✕</button>` : ''}`;
      else right = `<small>${esc(t(p.id === view.hostId ? 'lobby.host' : 'lobby.ready'))}</small>`;
      return `<li><span>${esc(name)}${p.id === view.me ? esc(t('lobby.me')) : ''}</span>${right}</li>`;
    });
    for (let i = view.players.length; i < 10; i++) rows.push(`<li class="empty">${esc(t('lobby.empty'))}</li>`);
    $('#lobby-players').innerHTML = rows.join('');
    const n = view.players.length;
    const start = $('#start-btn');
    start.textContent = t('lobby.startN', { n });
    start.disabled = n < 2;
    $('#bot-add').disabled = n >= 10;

    const on = RULES.filter((k) => view.rules[k]);
    $('#rule-summary').textContent = t('lobby.rulesOn', { n: on.length });
    $('#rule-switches').innerHTML = RULES.map((k) => `<label class="switch"><span class="txt"><b>${esc(t('rule.' + k))}</b><small>${esc(t('rule.' + k + '.desc'))}</small></span>`
      + `<input type="checkbox" data-rule="${k}"${view.rules[k] ? ' checked' : ''}><span class="sw"></span></label>`).join('');
    $('#guest-rules').innerHTML = on.length
      ? on.map((k) => `<li>${esc(t('rule.' + k))}</li>`).join('')
      : `<li>${esc(t('lobby.noRules'))}</li>`;
  }

  // ---- 결과 ----

  function renderResult(view) {
    setRole(view);
    const r = view.result;
    const nameOf = (id) => displayName(view.players.find((p) => p.id === id));
    const over = view.phase === 'matchover';
    const winner = over && view.rules.score ? view.matchWinnerId : r && r.winnerId;
    $('#result-title').textContent = winner ? t(over ? 'result.matchWin' : 'result.roundWin', { name: nameOf(winner) }) : t('result.title');
    $('#ranking').innerHTML = r ? r.ranking.map((row, i) => {
      const right = esc(view.rules.score
        ? (row.id === r.winnerId ? t('result.gained', { n: r.gained }) : t('result.left', { count: row.count, points: row.points }))
        : t('cards', { n: row.count }));
      return `<li class="${row.id === r.winnerId ? 'win' : ''}"><span class="rank">${i + 1}</span>${esc(nameOf(row.id))}<small>${right}</small></li>`;
    }).join('') : '';
    const totals = $('#totals');
    totals.hidden = !view.rules.score;
    if (view.rules.score) {
      const sorted = view.players.slice().sort((a, b) => b.score - a.score);
      totals.innerHTML = `<h3>${esc(t('result.totals'))}</h3>${sorted.map((p) => `<div><span>${esc(displayName(p))}</span><b>${esc(t('pts', { n: p.score }))}</b></div>`).join('')}`;
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

  const nameOf = (view, id) => displayName(view.players.find((p) => p.id === id));
  const colorName = (c) => (Cards.COLOR[c] ? Cards.COLOR[c].name : '');

  // 기록 한 줄(글자만). 넣을 때 통째로 esc 한다.
  function logText(view, e) {
    const n = (id) => nameOf(view, id);
    switch (e.type) {
      case 'play': {
        const last = e.cards[e.cards.length - 1];
        const what = e.cards.length > 1 ? t('log.playMany', { card: Cards.spoken(e.cards[0]), n: e.cards.length - 1 }) : Cards.spoken(last);
        return t('log.play', { name: n(e.by), what });
      }
      case 'jump': return t('log.jump', { name: n(e.by) });
      case 'draw': return e.count ? t('log.draw', { name: n(e.by), n: e.count }) : t('log.drawNone', { name: n(e.by) });
      case 'attack': return t('log.attack', { by: n(e.by), target: n(e.target), n: e.count, kind: Cards.NAME[e.kind === 'wild4' ? 'wild4' : 'draw2'] });
      case 'skip': return t('log.skip', { name: n(e.target) });
      case 'reverse': return t('log.reverse');
      case 'color': return t('log.color', { name: n(e.by), color: colorName(e.color) });
      case 'swap': return t('log.swap', { a: n(e.a), b: n(e.b) });
      case 'rotate': return t('log.rotate');
      case 'call': return t('log.call', { name: n(e.by) });
      case 'caught': return t('log.caught', { by: n(e.by), target: n(e.target) });
      case 'challenge': return e.success ? t('log.challengeOk', { name: n(e.target) }) : t('log.challengeFail', { name: n(e.by) });
      case 'win': return t('log.win', { name: n(e.by) });
      default: return '';
    }
  }
  const logLine = (view, e) => esc(logText(view, e));

  function setRoom(code) {
    roomCode = code || '';
  }

  function chipHtml(view, p, hit) {
    const me = p.id === view.me;
    const badges = [];
    if (p.count === 1 && p.called) badges.push(`<span class="badge call">${esc(t('game.call'))}</span>`);
    if (p.catchable) badges.push(`<span class="badge warn">${esc(t('game.notCalled'))}</span>`);
    if (hit !== undefined) badges.push(`<span class="badge dmg">+${hit}</span>`);
    const sub = p.proxy ? `<small class="proxy">${esc(t('game.proxy'))}</small>` : p.bot ? `<small class="bot">${esc(t('bot'))}</small>` : '';
    const pickable = view.await && view.await.kind === 'swap' && view.await.playerId === view.me && !me;
    const cls = ['chip', p.isTurn ? 'turn' : '', me ? 'me' : '', hit !== undefined ? 'hit' : '', pickable ? 'pickable' : ''].filter(Boolean).join(' ');
    const boom = hit !== undefined ? Cards.icon('i-boom', 'burst') : '';
    const tag = pickable ? 'button' : 'div';
    return `<${tag} class="${cls}" data-id="${esc(p.id)}"${pickable ? ` data-swap="${esc(p.id)}" type="button"` : ''}>`
      + `<b>${esc(me ? t('game.me') : displayName(p))}</b><span class="n">${esc(t('cards', { n: p.count }))}</span>${sub}${badges.join('')}${boom}</${tag}>`;
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
    if (!me || (view.phase !== 'playing' && view.phase !== 'judging')) return { label: t('game.call'), act: null };
    const n = view.hand.length;
    if ((n === 2 && view.turnId === view.me && !view.await && !me.called) || (n === 1 && !me.called)) return { label: t('game.call'), act: 'call' };
    if (view.players.some((p) => p.id !== view.me && p.catchable)) return { label: t('game.catch'), act: 'catch' };
    return { label: t('game.call'), act: null };
  }

  function renderButtons(view) {
    const draw = $('#draw-btn');
    const mine = myTurn(view);
    if (view.pending && mine) { draw.textContent = t('game.take', { n: view.pending.count }); draw.dataset.do = 'draw'; }
    else if (view.drewId !== null && mine) { draw.textContent = t('game.keep'); draw.dataset.do = 'pass'; }
    else { draw.textContent = t('game.draw'); draw.dataset.do = 'draw'; }
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
      $('#peek-title').textContent = ch ? t('game.peekOf', { name: nameOf(view, ch.target) }) : t('game.peek');
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
    sec.textContent = t('game.sec', { n: Math.ceil(ms / 1000) });
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

    $('#g-info').textContent = `${roomCode ? t('game.room', { code: roomCode }) : ''}${t(view.dir === 1 ? 'game.cw' : 'game.ccw')}`;
    renderRibbon(view, hits);
    const turnName = view.phase === 'judging' ? t('game.judging') : view.turnId === view.me ? t('game.me') : nameOf(view, view.turnId);
    $('#now-name').textContent = turnName;
    $('#screen-game').classList.toggle('my-turn', myTurn(view));
    $('#log').innerHTML = view.log.map((e) => `<div>${logLine(view, e)}</div>`).join('');

    $('#pile').replaceChildren(Cards.back({ big: true }));
    $('#pile').insertAdjacentHTML('beforeend', `<span class="pile-n">${esc(t('cards', { n: view.drawCount }))}</span>`);
    $('#top-slot').replaceChildren(...(view.top ? [Cards.face(view.top, { big: true })] : []));
    const ci = Cards.COLOR[view.color];
    $('#color-info').innerHTML = ci
      ? `${esc(t('game.colorNow'))} <b>${esc(ci.name)}</b> <svg style="color:var(--c-${view.color})" aria-hidden="true"><use href="#${ci.icon}"/></svg> ${esc(ci.bomb)}`
        + (view.pending ? ` · <b class="owe">${esc(t('game.owe', { n: view.pending.count }))}</b>` : '')
      : '';
    renderHand(view);
    renderButtons(view);
    renderOverlays(view);
    drawClock();
  }

  function fillColorGrid() {
    $('#color-grid').innerHTML = Object.entries(Cards.COLOR).map(([id, c]) => `<button class="cpick c-${id}" data-color="${id}" type="button">`
      + `<svg aria-hidden="true"><use href="#${c.icon}"/></svg><b>${esc(c.name)}</b><small>${esc(c.bomb)}</small></button>`).join('');
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
    fillColorGrid();
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
    for (const card of ATTACKS) {
      const li = document.createElement('li');
      li.appendChild(Cards.face({ id: -1, value: null, ...card }));
      li.insertAdjacentHTML('beforeend', `<span><b>${esc(Cards.NAME[card.kind])}</b> · ${esc(t('rules.' + card.kind))}</span>`);
      $('#attack-list').appendChild(li);
    }
    $('#bomb-list').innerHTML = Object.values(Cards.COLOR).map((c, i) => {
      const id = Object.keys(Cards.COLOR)[i];
      return `<li><svg style="color:var(--c-${id})" aria-hidden="true"><use href="#${c.icon}"/></svg><b>${esc(c.name)}</b> ${esc(c.bomb)}</li>`;
    }).join('');
  }

  // 시작 화면 구석의 언어 고르기: 작은 국기 버튼 셋(한국 · 미국 · 일본). 이름은 aria-label·title 로.
  // 국기는 woomars-hub/flags.js 의 LANG_FLAGS 를 그대로 복사한 것(모든 게임이 같은 그림).
  const LANG_FLAGS = {
    "ko": "<svg viewBox=\"-36 -24 72 48\" aria-hidden=\"true\"><rect x=\"-36\" y=\"-24\" width=\"72\" height=\"48\" fill=\"#fff\"/><g transform=\"rotate(-56.31)\"><path d=\"M-6-25H6M-6-22H6M-6-19H6M-6 19H6M-6 22H6M-6 25H6\" stroke=\"#000\" stroke-width=\"2\"/><path d=\"M0 17v10\" stroke=\"#fff\"/><circle r=\"12\" fill=\"#cd2e3a\"/><path d=\"M0-12A6 6 0 0 0 0 0A6 6 0 0 1 0 12A12 12 0 0 1 0-12Z\" fill=\"#0047a0\"/></g><g transform=\"rotate(-123.69)\"><path d=\"M-6-25H6M-6-22H6M-6-19H6M-6 19H6M-6 22H6M-6 25H6\" stroke=\"#000\" stroke-width=\"2\"/><path d=\"M0-23.5v3M0 17v3.5M0 23.5v3\" stroke=\"#fff\"/></g></svg>",
    "en": "<svg viewBox=\"0 0 30 20\" aria-hidden=\"true\"><rect width=\"30\" height=\"20\" fill=\"#b22234\"/><path d=\"M0 2.31H30M0 5.38H30M0 8.46H30M0 11.54H30M0 14.62H30M0 17.69H30\" stroke=\"#fff\" stroke-width=\"1.54\"/><rect width=\"12\" height=\"10.77\" fill=\"#3c3b6e\"/><g fill=\"#fff\"><circle cx=\"2\" cy=\"1.8\" r=\".55\"/><circle cx=\"6\" cy=\"1.8\" r=\".55\"/><circle cx=\"10\" cy=\"1.8\" r=\".55\"/><circle cx=\"4\" cy=\"4.1\" r=\".55\"/><circle cx=\"8\" cy=\"4.1\" r=\".55\"/><circle cx=\"2\" cy=\"6.4\" r=\".55\"/><circle cx=\"6\" cy=\"6.4\" r=\".55\"/><circle cx=\"10\" cy=\"6.4\" r=\".55\"/><circle cx=\"4\" cy=\"8.7\" r=\".55\"/><circle cx=\"8\" cy=\"8.7\" r=\".55\"/></g></svg>",
    "ja": "<svg viewBox=\"0 0 30 20\" aria-hidden=\"true\"><rect width=\"30\" height=\"20\" fill=\"#fff\"/><circle cx=\"15\" cy=\"10\" r=\"6\" fill=\"#bc002d\"/></svg>"
  };
  function renderLangPick() {
    $('#lang-pick').innerHTML = I18n.LANGS.map((l) => `<button type="button" lang="${l}" data-lang="${l}" aria-pressed="${l === I18n.lang}"`
      + ` aria-label="${esc(I18n.LANG_NAMES[l])}" title="${esc(I18n.LANG_NAMES[l])}">${LANG_FLAGS[l]}</button>`).join('');
  }

  // 고정 문구와 미리 채워 둔 부분을 지금 언어로 다시 그린다.
  function relocalize() {
    I18n.apply(document);
    renderLangPick();
    fillRules();
    fillColorGrid();
    emit('lang-change', I18n.lang);
  }

  function bind() {
    I18n.apply(document);
    renderLangPick();
    $('#lang-pick').addEventListener('click', (e) => {
      const b = e.target.closest('[data-lang]');
      if (b) I18n.setLang(b.dataset.lang);
    });
    I18n.onChange(relocalize);
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
    josa, ro, esc, emit, displayName,
    focusCode: () => $('#code').focus(),
    setName: (name) => { $('#name').value = name; },
    getName: () => $('#name').value,
  };
})(this);
