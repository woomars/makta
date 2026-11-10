// 핸드폰 한 대의 게임 상태. 맨 위 카드가 화면에 뜬 시각을 재서 끼어들기 반응 시간을 계산한다.
(function (root) {
  'use strict';

  // 이전 화면과 새 화면을 비교해 낼 소리와 진동을 고른다. 오래된 일부터 차례로.
  function cues(prev, view) {
    if (!prev) return [];
    const out = [];
    const me = view.me;
    const fresh = view.seq > prev.seq ? view.log.slice(0, Math.min(view.log.length, view.seq - prev.seq)).reverse() : [];
    for (const e of fresh) {
      if (e.type === 'play') out.push({ sound: 'play' });
      else if (e.type === 'attack') {
        const cue = { sound: e.count >= 4 ? 'bigAttack' : 'attack' };
        if (e.target === me) cue.vibrate = 200;
        out.push(cue);
      } else if (e.type === 'caught') out.push(e.target === me ? { sound: 'caught', vibrate: 200 } : { sound: 'caught' });
      else if (e.type === 'call') out.push({ sound: 'call' });
      else if (e.type === 'win') out.push({ sound: 'boom' });
    }
    if (view.phase === 'playing' && view.turnId === me && prev.turnId !== me) out.push({ sound: 'myTurn', vibrate: 50 });
    return out;
  }

  function create({
    send,
    onView,
    onWelcome = () => {},
    onReject = () => {},
    raf = (fn) => root.requestAnimationFrame(fn),
    now = () => root.performance.now(),
    sound = root.Sound,
  }) {
    let view = null;
    let playerId = null;
    const renderedAt = {};

    function receive(msg) {
      if (!msg) return;
      if (msg.t === 'welcome') {
        playerId = msg.playerId;
        onWelcome(msg);
      } else if (msg.t === 'reject') {
        onReject(msg.reason);
      } else if (msg.t === 'view') {
        const prev = view;
        view = msg.view;
        const v = view.topVersion;
        if (prev && v < prev.topVersion) for (const k of Object.keys(renderedAt)) delete renderedAt[k];
        onView(view);
        // 화면이 실제로 그려진 다음 프레임의 시각을 그 카드가 보인 시각으로 삼는다.
        raf(() => {
          if (renderedAt[v] === undefined) renderedAt[v] = now();
          for (const k of Object.keys(renderedAt)) if (k < v - 20) delete renderedAt[k];
        });
        for (const c of cues(prev, view)) {
          if (typeof sound[c.sound] === 'function') sound[c.sound]();
          if (c.vibrate) sound.vibrate(c.vibrate);
        }
      }
    }

    function jump(cardId) {
      if (!view) return;
      const t = now();
      const start = renderedAt[view.topVersion] ?? t;
      send({ t: 'jump', cardId, topVersion: view.topVersion, reactionMs: Math.max(0, t - start) });
    }

    return {
      receive,
      play: (cardIds) => send({ t: 'play', cardIds }),
      draw: () => send({ t: 'draw' }),
      pass: () => send({ t: 'pass' }),
      color: (color) => send({ t: 'color', color }),
      swap: (target) => send({ t: 'swap', target }),
      challenge: () => send({ t: 'challenge' }),
      call: () => send({ t: 'call' }),
      catch: () => send({ t: 'catch' }),
      jump,
      get view() { return view; },
      get playerId() { return playerId; },
    };
  }

  const api = { create, cues };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Client = api;
})(this);
