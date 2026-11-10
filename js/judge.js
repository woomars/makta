// 끼어들기 판정. 판정 대기 시간 동안 모인 입력 중 반응 시간이 가장 짧은 사람이 낸다.
(function (root) {
  'use strict';

  function pickJump(entries) {
    const firstByPlayer = new Map();
    for (const e of [...entries].sort((a, b) => a.seq - b.seq)) {
      if (!firstByPlayer.has(e.playerId)) firstByPlayer.set(e.playerId, e);
    }
    const sorted = [...firstByPlayer.values()].sort((a, b) => a.reactionMs - b.reactionMs || a.seq - b.seq);
    return sorted[0] || null;
  }

  const api = { pickJump };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Judge = api;
})(this);
