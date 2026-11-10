// 막타 규칙. 상태는 평범한 객체이고, 함수가 그 객체를 바꾼다.
// DOM과 네트워크에 기대지 않으므로 Node에서 테스트할 수 있다.
(function (root) {
  'use strict';

  const COLORS = ['r', 'y', 'g', 'b'];
  const HAND = 7;
  const ACTIONS = ['skip', 'rev', 'draw2'];

  function createDeck() {
    const deck = [];
    let id = 0;
    const add = (color, kind, value) => deck.push({ id: id++, color, kind, value });
    for (const color of COLORS) {
      add(color, 'num', 0);
      for (let v = 1; v <= 9; v++) { add(color, 'num', v); add(color, 'num', v); }
      for (const k of ACTIONS) { add(color, k, null); add(color, k, null); }
    }
    for (let i = 0; i < 4; i++) add(null, 'wild', null);
    for (let i = 0; i < 4; i++) add(null, 'wild4', null);
    return deck;
  }

  function shuffle(cards, rng) {
    const a = cards.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // 상태 안에 씨앗을 두고 더미를 다시 섞을 때 쓴다. 같은 상태면 같은 결과가 나온다.
  function stateRng(s) {
    return () => {
      s.seed = (Math.imul(s.seed || 1, 1664525) + 1013904223) >>> 0;
      return s.seed / 4294967296;
    };
  }

  const isWild = (c) => c.kind === 'wild' || c.kind === 'wild4';
  const top = (s) => s.discard[s.discard.length - 1];
  const current = (s) => s.players[s.turn].id;
  const playerOf = (s, id) => s.players.find((p) => p.id === id);
  const seatOf = (s, id) => s.players.findIndex((p) => p.id === id);
  const seatAfter = (s, seat, steps = 1) => {
    const n = s.players.length;
    return (((seat + s.dir * steps) % n) + n) % n;
  };

  function newRound(playerIds, rules, rng, firstTurn) {
    const deck = shuffle(createDeck(), rng);
    const players = playerIds.map((id) => ({ id, hand: deck.splice(0, HAND), called: false }));
    const draw = deck;
    let first = draw.pop();
    while (first.kind !== 'num') {
      draw.splice(Math.floor(rng() * (draw.length + 1)), 0, first);
      first = draw.pop();
    }
    return {
      rules: { ...rules },
      players,
      draw,
      discard: [first],
      color: first.color,
      turn: firstTurn % players.length,
      dir: 1,
      topVersion: 0,
      pending: null,
      wild4: null,
      await: null,
      drewId: null,
      winnerId: null,
      seed: Math.floor(rng() * 4294967296) || 1,
    };
  }

  function matches(s, card) {
    if (isWild(card)) return true;
    if (card.color === s.color) return true;
    const t = top(s);
    if (card.kind === 'num') return t.kind === 'num' && t.value === card.value;
    return card.kind === t.kind;
  }

  // 공격이 쌓여 있을 때 이어서 낼 수 있는 카드인지
  function stackable(pending, card) {
    if (pending.kind === 'draw2') return card.kind === 'draw2' || card.kind === 'wild4';
    return card.kind === 'wild4';
  }

  // 지금 차례인 사람이 이 카드를 낼 수 있는지
  function canPlayCard(s, card) {
    if (s.drewId !== null && card.id !== s.drewId) return false;
    if (s.pending) return s.rules.stack && stackable(s.pending, card);
    return matches(s, card);
  }

  function blocked(s, playerId) {
    if (s.winnerId) return 'over';
    if (current(s) !== playerId) return 'not-turn';
    if (s.await) return 'await';
    return null;
  }

  function playableIds(s, playerId) {
    if (blocked(s, playerId)) return [];
    return playerOf(s, playerId).hand.filter((c) => canPlayCard(s, c)).map((c) => c.id);
  }

  function advance(s, steps) {
    s.turn = seatAfter(s, s.turn, steps);
    s.drewId = null;
  }

  // 더미에서 n장을 준다. 더미가 비면 맨 위 카드만 남기고 버린 더미를 섞어 쓴다. 실제로 준 장수를 돌려준다.
  function drawCards(s, player, n) {
    let given = 0;
    for (let i = 0; i < n; i++) {
      if (s.draw.length === 0) {
        const rest = s.discard.slice(0, -1);
        if (rest.length === 0) break;
        s.discard = [top(s)];
        for (const c of rest) if (isWild(c)) c.color = null;
        s.draw = shuffle(rest, stateRng(s));
      }
      player.hand.push(s.draw.pop());
      given += 1;
    }
    if (player.hand.length >= 2) player.called = false;
    return given;
  }

  // 다음 사람이 count장 받고 차례를 잃는다.
  function attackNext(s, events, by, count, kind) {
    const target = s.players[seatAfter(s, s.turn)];
    const got = drawCards(s, target, count);
    events.push({ type: 'attack', by, target: target.id, count: got, kind });
    advance(s, 2);
  }

  // 쌓기나 의심하기 때문에 공격을 바로 주지 않고 다음 사람에게 걸어 둔다.
  function addPending(s, events, by, count, kind) {
    s.pending = { count: (s.pending ? s.pending.count : 0) + count, kind };
    events.push({ type: 'attack', by, target: s.players[seatAfter(s, s.turn)].id, count: s.pending.count, kind });
    advance(s, 1);
  }

  // 손에서 카드를 내려놓는다. 마지막 카드가 맨 위가 된다.
  function place(s, p, cards) {
    for (const c of cards) p.hand.splice(p.hand.indexOf(c), 1);
    s.discard.push(...cards);
    s.topVersion += 1;
    s.drewId = null;
    const last = cards[cards.length - 1];
    if (!isWild(last)) s.color = last.color;
    return last;
  }

  // 손패를 다 냈으면 판을 끝낸다. 마지막 카드가 공격 카드면 다음 사람이 받는다.
  function finishIfWon(s, events, p, last) {
    if (p.hand.length > 0) return false;
    s.winnerId = p.id;
    const owed = s.pending ? s.pending.count : 0;
    s.pending = null;
    if (last.kind === 'draw2') attackNext(s, events, p.id, owed + 2, 'draw2');
    if (last.kind === 'wild4') attackNext(s, events, p.id, owed + 4, 'wild4');
    events.push({ type: 'win', by: p.id });
    return true;
  }

  function play(s, playerId, cardIds) {
    const why = blocked(s, playerId);
    if (why) return { ok: false, reason: why };
    const p = playerOf(s, playerId);
    if (!Array.isArray(cardIds) || cardIds.length === 0) return { ok: false, reason: 'no-card' };
    if (cardIds.length > 1 && !s.rules.multi) return { ok: false, reason: 'no-card' };
    const cards = cardIds.map((id) => p.hand.find((c) => c.id === id));
    if (cards.some((c) => !c) || new Set(cardIds).size !== cardIds.length) return { ok: false, reason: 'no-card' };
    if (s.drewId !== null && (cards.length > 1 || cards[0].id !== s.drewId)) return { ok: false, reason: 'drew' };
    if (cards.length > 1 && !cards.every((c) => c.kind === 'num' && c.value === cards[0].value)) {
      return { ok: false, reason: 'not-same' };
    }
    if (!canPlayCard(s, cards[0])) return { ok: false, reason: 'no-match' };

    const first = cards[0];
    if (first.kind === 'wild4') {
      const hadColor = p.hand.some((c) => c !== first && c.color === s.color);
      s.wild4 = s.pending ? null : { by: playerId, hadColor, prevColor: s.color };
    }
    const last = place(s, p, cards);
    const events = [{ type: 'play', by: playerId, cards }];
    if (!finishIfWon(s, events, p, last)) applyEffect(s, events, playerId, last);
    return { ok: true, events };
  }

  function applyEffect(s, events, playerId, card) {
    switch (card.kind) {
      case 'skip':
        events.push({ type: 'skip', target: s.players[seatAfter(s, s.turn)].id });
        advance(s, 2);
        break;
      case 'rev':
        events.push({ type: 'reverse', by: playerId });
        if (s.players.length === 2) advance(s, 2);
        else { s.dir = -s.dir; advance(s, 1); }
        break;
      case 'draw2':
        if (s.rules.stack) addPending(s, events, playerId, 2, 'draw2');
        else attackNext(s, events, playerId, 2, 'draw2');
        break;
      case 'wild':
      case 'wild4':
        s.await = { kind: 'color', playerId };
        break;
      default:
        if (s.rules.sevenZero && card.value === 7) {
          s.await = { kind: 'swap', playerId };
        } else if (s.rules.sevenZero && card.value === 0) {
          rotateHands(s);
          events.push({ type: 'rotate' });
          advance(s, 1);
        } else {
          advance(s, 1);
        }
    }
  }

  // 모두 진행 방향의 다음 사람에게 손패를 넘긴다.
  function rotateHands(s) {
    const hands = s.players.map((p) => p.hand);
    hands.forEach((hand, i) => { s.players[seatAfter(s, i)].hand = hand; });
    for (const p of s.players) p.called = false;
  }

  function chooseColor(s, playerId, color) {
    if (!s.await || s.await.kind !== 'color' || s.await.playerId !== playerId) return { ok: false, reason: 'no-await' };
    if (!COLORS.includes(color)) return { ok: false, reason: 'bad-color' };
    s.await = null;
    s.color = color;
    const t = top(s);
    t.color = color;
    const events = [{ type: 'color', by: playerId, color }];
    if (t.kind !== 'wild4') advance(s, 1);
    else if (s.rules.stack || s.rules.challenge) addPending(s, events, playerId, 4, 'wild4');
    else attackNext(s, events, playerId, 4, 'wild4');
    return { ok: true, events };
  }

  function chooseSwap(s, playerId, targetId) {
    if (!s.await || s.await.kind !== 'swap' || s.await.playerId !== playerId) return { ok: false, reason: 'no-await' };
    const a = playerOf(s, playerId);
    const b = playerOf(s, targetId);
    if (!b || b === a) return { ok: false, reason: 'bad-target' };
    [a.hand, b.hand] = [b.hand, a.hand];
    a.called = false;
    b.called = false;
    s.await = null;
    advance(s, 1);
    return { ok: true, events: [{ type: 'swap', a: a.id, b: b.id }] };
  }

  function draw(s, playerId) {
    const why = blocked(s, playerId);
    if (why) return { ok: false, reason: why };
    const p = playerOf(s, playerId);
    if (s.pending) {
      const got = drawCards(s, p, s.pending.count);
      s.pending = null;
      s.wild4 = null;
      advance(s, 1);
      return { ok: true, events: [{ type: 'draw', by: playerId, count: got }] };
    }
    if (s.drewId !== null) return { ok: false, reason: 'drew' };
    let total = 0;
    for (;;) {
      if (!drawCards(s, p, 1)) break;
      total += 1;
      const drawn = p.hand[p.hand.length - 1];
      if (matches(s, drawn)) { s.drewId = drawn.id; break; }
      if (!s.rules.drawUntil) break;
    }
    if (s.drewId === null) advance(s, 1);
    return { ok: true, events: [{ type: 'draw', by: playerId, count: total }] };
  }

  function pass(s, playerId) {
    const why = blocked(s, playerId);
    if (why) return { ok: false, reason: why };
    if (s.drewId === null) return { ok: false, reason: 'not-drawn' };
    advance(s, 1);
    return { ok: true, events: [] };
  }

  // ---- 의심하기 ----

  function canChallenge(s, playerId) {
    return !!(s.rules.challenge && !s.winnerId && !s.await && current(s) === playerId && s.pending
      && s.pending.kind === 'wild4' && s.pending.count === 4 && s.wild4);
  }

  function challenge(s, playerId) {
    if (!canChallenge(s, playerId)) return { ok: false, reason: 'cannot-challenge' };
    const w = s.wild4;
    s.pending = null;
    s.wild4 = null;
    if (w.hadColor) {
      drawCards(s, playerOf(s, w.by), 4);
    } else {
      drawCards(s, playerOf(s, playerId), 6);
      advance(s, 1);
    }
    return { ok: true, events: [{ type: 'challenge', by: playerId, target: w.by, success: w.hadColor }] };
  }

  // ---- 끼어들기 ----

  function canJump(s, playerId, cardId) {
    if (!s.rules.jumpIn || s.winnerId || s.await || current(s) === playerId) return false;
    const p = playerOf(s, playerId);
    const card = p && p.hand.find((c) => c.id === cardId);
    if (!card || isWild(card)) return false;
    const t = top(s);
    return card.color === t.color && card.kind === t.kind && card.value === t.value;
  }

  function jumpIn(s, playerId, cardId) {
    if (!canJump(s, playerId, cardId)) return { ok: false, reason: 'cannot-jump' };
    const p = playerOf(s, playerId);
    const card = p.hand.find((c) => c.id === cardId);
    s.turn = seatOf(s, playerId);
    const last = place(s, p, [card]);
    const events = [{ type: 'jump', by: playerId, card }, { type: 'play', by: playerId, cards: [card] }];
    if (!finishIfWon(s, events, p, last)) applyEffect(s, events, playerId, last);
    return { ok: true, events };
  }

  // ---- 시간이 다 됐을 때 ----

  function mostColor(hand) {
    let best = COLORS[0];
    let bestN = -1;
    for (const c of COLORS) {
      const n = hand.filter((x) => x.color === c).length;
      if (n > bestN) { best = c; bestN = n; }
    }
    return best;
  }

  function fewestOpponent(s, playerId) {
    let best = null;
    for (const p of s.players) {
      if (p.id === playerId) continue;
      if (!best || p.hand.length < best.hand.length) best = p;
    }
    return best.id;
  }

  function autoAction(s) {
    if (s.await && s.await.kind === 'color') return { t: 'color', color: mostColor(playerOf(s, s.await.playerId).hand) };
    if (s.await && s.await.kind === 'swap') return { t: 'swap', target: fewestOpponent(s, s.await.playerId) };
    if (s.drewId !== null) return { t: 'pass' };
    return { t: 'draw' };
  }

  // ---- 막타와 잡기 ----

  function call(s, playerId) {
    const p = playerOf(s, playerId);
    if (!p || s.winnerId) return { ok: false, reason: 'cannot-call' };
    const myTurnWithTwo = p.hand.length === 2 && current(s) === playerId && !s.await;
    const lastUncalled = p.hand.length === 1 && !p.called;
    if (!myTurnWithTwo && !lastUncalled) return { ok: false, reason: 'cannot-call' };
    p.called = true;
    return { ok: true, events: [{ type: 'call', by: playerId }] };
  }

  function catchable(s) {
    if (s.winnerId) return [];
    return s.players.filter((p) => p.hand.length === 1 && !p.called).map((p) => p.id);
  }

  function catchPlayer(s, catcherId, targetId) {
    if (catcherId === targetId || !playerOf(s, catcherId) || !catchable(s).includes(targetId)) {
      return { ok: false, reason: 'not-catchable' };
    }
    drawCards(s, playerOf(s, targetId), 2);
    return { ok: true, events: [{ type: 'caught', by: catcherId, target: targetId }] };
  }

  // ---- 점수 ----

  function cardPoints(c) {
    if (c.kind === 'num') return c.value;
    if (isWild(c)) return 50;
    return 20;
  }
  const handPoints = (hand) => hand.reduce((n, c) => n + cardPoints(c), 0);

  function roundResult(s) {
    const rows = s.players.map((p) => ({ id: p.id, count: p.hand.length, points: handPoints(p.hand) }));
    rows.sort((a, b) => (b.id === s.winnerId) - (a.id === s.winnerId) || a.count - b.count || a.points - b.points);
    const gained = rows.filter((r) => r.id !== s.winnerId).reduce((n, r) => n + r.points, 0);
    return { winnerId: s.winnerId, ranking: rows, gained };
  }

  const api = {
    COLORS, HAND, createDeck, shuffle, newRound, matches, canPlayCard, playableIds,
    play, chooseColor, chooseSwap, draw, pass, canChallenge, challenge, canJump, jumpIn,
    autoAction, call, catchable, catchPlayer, handPoints, roundResult,
    current, top, isWild, mostColor, fewestOpponent, seatOf, seatAfter, playerOf,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Game = api;
})(this);
