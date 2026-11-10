// 봇의 수 고르기. 하수는 아무거나, 중수는 기본 요령, 고수는 다음 사람을 막고 남이 없는 색을 노린다.
// 탐색 없이 단순 규칙만 쓰므로 한 수에 수 밀리초도 걸리지 않는다.
(function (root) {
  'use strict';

  const Game = typeof require === 'function' ? require('./game.js') : root.Game;

  const PROFILE = {
    low: { forgetCall: 0.2, catchMs: [1500, 2000], jump: 0 },
    mid: { forgetCall: 0.05, catchMs: [800, 1500], jump: 0.5, jumpMs: [800, 1200] },
    high: { forgetCall: 0, catchMs: [200, 800], jump: 1, jumpMs: [400, 700] },
  };
  const ATTACK_ORDER = ['draw2', 'skip', 'wild4'];

  const pickRandom = (list, rng) => list[Math.floor(rng() * list.length)];
  const handOf = (s, id) => Game.playerOf(s, id).hand;
  const nextPlayer = (s) => s.players[Game.seatAfter(s, s.turn)];

  function newMemory() {
    return { lacks: {} };
  }

  // 누가 어떤 색이 없어서 뽑았는지 기억한다. before는 그 행동 직전의 { color, pending }.
  function observe(memory, before, event) {
    const lacks = (id) => (memory.lacks[id] = memory.lacks[id] || []);
    if (event.type === 'draw' && !before.pending) {
      const list = lacks(event.by);
      if (!list.includes(before.color)) list.push(before.color);
    } else if (event.type === 'play' || event.type === 'jump') {
      const played = event.cards || [event.card];
      const list = lacks(event.by);
      for (const c of played) {
        const i = list.indexOf(c.color);
        if (i >= 0) list.splice(i, 1);
      }
    }
  }

  function pickColor(s, playerId, level, memory, rng) {
    const hand = handOf(s, playerId);
    if (level === 'low') return pickRandom(Game.COLORS, rng);
    if (level === 'high') {
      const lacks = memory.lacks[nextPlayer(s).id] || [];
      const held = Game.COLORS.filter((c) => lacks.includes(c) && hand.some((x) => x.color === c));
      if (held.length) return Game.mostColor(hand.filter((x) => held.includes(x.color)));
    }
    return Game.mostColor(hand);
  }

  function pickSwap(s, playerId, level, rng) {
    if (level === 'low') return pickRandom(s.players.filter((p) => p.id !== playerId), rng).id;
    return Game.fewestOpponent(s, playerId);
  }

  function pointsOf(c) {
    return Game.handPoints([c]);
  }

  function pickCard(s, playerId, level, cards, rng) {
    if (level === 'low') return pickRandom(cards, rng);
    if (level === 'high') {
      if (nextPlayer(s).hand.length <= 2) {
        for (const kind of ATTACK_ORDER) {
          const hit = cards.find((c) => c.kind === kind);
          if (hit) return hit;
        }
      }
      if (s.rules.score) {
        const plain = cards.filter((c) => !Game.isWild(c));
        if (plain.length) return plain.slice().sort((a, b) => pointsOf(b) - pointsOf(a))[0];
      }
    }
    const plain = cards.filter((c) => !Game.isWild(c));
    return plain.find((c) => c.color === s.color) || plain[0] || cards[0];
  }

  // 같은 숫자 여러 장 내기가 켜져 있으면 중수와 고수는 같은 숫자를 함께 던진다.
  function withSameNumbers(s, playerId, level, card) {
    const ids = [card.id];
    if (!s.rules.multi || level === 'low' || card.kind !== 'num' || s.drewId !== null) return ids;
    for (const c of handOf(s, playerId)) {
      if (c !== card && c.kind === 'num' && c.value === card.value) ids.push(c.id);
    }
    return ids;
  }

  function decide(s, playerId, level, memory, rng) {
    if (s.await && s.await.kind === 'color') return { t: 'color', color: pickColor(s, playerId, level, memory, rng) };
    if (s.await && s.await.kind === 'swap') return { t: 'swap', target: pickSwap(s, playerId, level, rng) };

    const ids = Game.playableIds(s, playerId);
    const cards = handOf(s, playerId).filter((c) => ids.includes(c.id));

    if (s.pending) {
      if (level === 'high' && Game.canChallenge(s, playerId)) {
        const lacks = memory.lacks[s.wild4.by] || [];
        if (!lacks.includes(s.wild4.prevColor) && rng() < 0.5) return { t: 'challenge' };
      }
      if (!cards.length) return { t: 'draw' };
      if (level === 'low') return { t: 'play', cardIds: [pickRandom(cards, rng).id] };
      const stack = cards.find((c) => c.kind === 'draw2') || cards[0];
      return { t: 'play', cardIds: [stack.id] };
    }

    if (!cards.length) return s.drewId !== null ? { t: 'pass' } : { t: 'draw' };
    const card = pickCard(s, playerId, level, cards, rng);
    return { t: 'play', cardIds: withSameNumbers(s, playerId, level, card) };
  }

  function wantsCall(level, rng) {
    return rng() >= PROFILE[level].forgetCall;
  }

  function jumpCard(s, playerId, level, rng) {
    if (!s.rules.jumpIn || !(rng() < PROFILE[level].jump)) return null;
    const card = handOf(s, playerId).find((c) => Game.canJump(s, playerId, c.id));
    return card ? card.id : null;
  }

  const api = { PROFILE, newMemory, observe, decide, wantsCall, jumpCard };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Bot = api;
})(this);
