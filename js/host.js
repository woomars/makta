// 방장 핸드폰에서 도는 게임 진행. 모든 상태와 판정, 봇 계산을 여기서 한다.
// 시계, 난수, 전송 함수는 밖에서 넣어 주므로 Node에서 테스트할 수 있다.
(function (root) {
  'use strict';

  const Game = typeof require === 'function' ? require('./game.js') : root.Game;
  const Bot = typeof require === 'function' ? require('./bot.js') : root.Bot;
  const Judge = typeof require === 'function' ? require('./judge.js') : root.Judge;

  const MAX_SEATS = 10;
  const TARGET_SCORE = 500;
  const TIMING = {
    TURN_MS: 20000,
    CATCH_MIN_MS: 2500,
    SWAP_GRACE_MS: 3000,
    BOT_THINK_MS: [1000, 2000],
    JUDGE_WINDOW_MS: 300,
    MAX_WINDOW_MS: 1000,
    PASS_GUARD_MS: 400,
    // 판 사이에 끊긴 사람의 자리를 남겨 두는 시간. 손님은 판 밖에서 끊기면 2분 동안 다시 붙어 보므로(app.js)
    // 그보다 조금 길게. 이 안에 방장이 다음 판을 시작하면 그 자리는 봇이 대신 두고, 돌아오면 돌려준다.
    GHOST_KEEP_MS: 150000,
  };
  const RTT_SAMPLES = 10;
  const LOG_SIZE = 3;
  const RULE_KEYS = ['stack', 'drawUntil', 'sevenZero', 'jumpIn', 'multi', 'challenge', 'turnTimer', 'score'];
  const BOT_LABEL = { low: '하수', mid: '중수', high: '고수' };
  const COLOR_ORDER = { r: 0, y: 1, g: 2, b: 3 };
  const KIND_ORDER = { num: 0, skip: 1, rev: 2, draw2: 3, wild: 4, wild4: 5 };

  const randomToken = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const cleanName = (name) => String(name || '').trim().slice(0, 8) || '이름 없음';
  const offRules = () => Object.fromEntries(RULE_KEYS.map((k) => [k, false]));

  function sortHand(hand) {
    const colorRank = (c) => (c.color && !Game.isWild(c) ? COLOR_ORDER[c.color] : 4);
    return hand.slice().sort((a, b) => colorRank(a) - colorRank(b)
      || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.value || 0) - (b.value || 0) || a.id - b.id);
  }

  function applyAction(g, id, a) {
    switch (a && a.t) {
      case 'play': return Game.play(g, id, a.cardIds);
      case 'draw': return Game.draw(g, id);
      case 'pass': return Game.pass(g, id);
      case 'color': return Game.chooseColor(g, id, a.color);
      case 'swap': return Game.chooseSwap(g, id, a.target);
      case 'challenge': return Game.challenge(g, id);
      default: return { ok: false, reason: 'unknown' };
    }
  }

  class HostSession {
    constructor({ hostPeerId, rng, clock, send, makeToken = randomToken }) {
      this.hostPeerId = hostPeerId;
      this.rng = rng;
      this.clock = clock;
      this.send = send;
      this.makeToken = makeToken;
      this.members = []; // { id, name, peerId, token, connected, bot, proxy, score }
      this.nextPersonId = 2;
      this.nextBotId = 1;
      this.phase = 'lobby';
      this.rules = offRules();
      this.game = null;
      this.memory = Bot.newMemory();
      this.log = [];
      this.seq = 0;
      this.firstSeat = null;
      this.result = null;
      this.matchWinnerId = null;
      this.peek = null; // { to, cards } 의심한 사람에게 한 번만 보여 줄 손패
      this.token = 0; // 예약된 봇 수와 시간 제한을 무효로 만들 때 올린다
      this.botTimer = null;
      this.turnTimer = null;
      this.turnDeadline = null;
      this.windows = new Map(); // playerId -> { from, minUntil, actedAfter } 잡을 수 있는 시간
      this.spent = new Set(); // 잡기 시간이 이미 지나간 사람. 잡을 수 없는 상태가 되면 지운다.
      this.forgot = new Set(); // 막타 외치기를 잊은 봇. 잡을 수 없는 상태가 되면 지운다.
      this.lastDraw = null; // { id, at } 뽑기 바로 뒤의 두 번째 탭(그만)을 막는다
      this.catchTimers = [];
      this.jumpTimers = [];
      this.judgeTimer = null;
      this.entries = [];
      this.entrySeq = 0;
      this.disposed = false;
    }

    dispose() {
      this.disposed = true;
      this.clearRoundTimers();
    }

    // ---- 연결 ----

    setLatency(peerId, rttMs) {
      const m = this.memberByPeer(peerId);
      if (!m || !Number.isFinite(rttMs)) return;
      m.rtts = (m.rtts || []).concat(rttMs).slice(-RTT_SAMPLES);
    }

    judgeWindowMs() {
      let worst = 0;
      for (const m of this.members) if (m.connected && m.rtts) worst = Math.max(worst, ...m.rtts);
      return Math.min(TIMING.MAX_WINDOW_MS, Math.max(TIMING.JUDGE_WINDOW_MS, Math.round(worst / 2) + 200));
    }

    memberByPeer(peerId) {
      return this.members.find((m) => m.peerId === peerId && m.connected);
    }

    member(id) {
      return this.members.find((m) => m.id === id);
    }

    handleConnect() {
      // 이름(hello)을 받을 때까지는 아무것도 하지 않는다.
    }

    handleMessage(peerId, msg) {
      if (this.disposed || !msg || typeof msg.t !== 'string') return;
      if (msg.t === 'hello') return this.onHello(peerId, msg);
      const m = this.memberByPeer(peerId);
      if (!m) return;
      const isHost = peerId === this.hostPeerId;
      switch (msg.t) {
        case 'add-bot': if (isHost) this.onAddBot(msg.level); break;
        case 'remove-bot': if (isHost) this.onRemoveBot(msg.id); break;
        case 'rules': if (isHost) this.onRules(msg.rules); break;
        case 'start': if (isHost) this.onStart(); break;
        case 'next': if (isHost) this.onNext(); break;
        case 'again': if (isHost) this.onAgain(); break;
        case 'to-lobby': if (isHost) this.onToLobby(); break;
        case 'play': this.act(m.id, { t: 'play', cardIds: msg.cardIds }); break;
        case 'draw': case 'pass': case 'challenge': this.act(m.id, { t: msg.t }); break;
        case 'color': this.act(m.id, { t: 'color', color: msg.color }); break;
        case 'swap': this.act(m.id, { t: 'swap', target: msg.target }); break;
        case 'call': this.onCall(m.id); break;
        case 'catch': this.onCatch(m.id); break;
        case 'jump': this.onJump(m.id, msg); break;
        case 'leave': if (!isHost) this.handleDisconnect(peerId, { left: true }); break;
        default: break;
      }
    }

    // left: 손님이 「나가기」를 눌렀다(돌아오지 않는다). 아니면 잠깐 끊긴 것일 수 있다.
    handleDisconnect(peerId, { left = false } = {}) {
      if (this.disposed) return;
      const m = this.memberByPeer(peerId);
      if (!m || peerId === this.hostPeerId) return;
      m.lostAt = this.clock.now();
      m.left = left;
      if (this.inRound()) {
        // 판 중간에 끊기면 중수 봇이 바로 이어받는다.
        m.connected = false;
        m.proxy = true;
        m.returning = false;
        for (const [id, w] of this.windows) {
          if (id !== m.id && this.isOpen(id)) this.scheduleBotCatches(id, Math.max(0, w.from - this.clock.now()), m);
        }
        if (this.phase === 'playing' && this.actorId() === m.id) this.schedule();
        if (this.phase === 'playing') this.scheduleBotJumps();
      } else if (this.phase === 'lobby') {
        this.members.splice(this.members.indexOf(m), 1);
      } else {
        // 판 사이에는 자리와 점수를 남겨 둔다. 다음 판 시작 때 정리한다(pruneGhosts).
        m.connected = false;
      }
      this.broadcast();
    }

    // 끊긴 채로 남은 사람을 자리에서 뺀다. 다음 판을 시작하거나 대기실로 갈 때 부른다.
    // 다음 판을 시작할 때(keepRecent)는 나가기를 누르지 않고 방금 끊긴 사람의 자리를 남겨 봇이 대신 두게 한다.
    // 결과 화면에서 폰이 잠깐 꺼진 손님이 돌아왔을 때 '이미 시작됨'으로 튕기지 않게.
    // 대기실로 갈 때는 다 뺀다. 돌아오면 대기실에 새로 앉는다.
    pruneGhosts(keepRecent = false) {
      const now = this.clock.now();
      const recent = (m) => keepRecent && !m.left && now - m.lostAt < TIMING.GHOST_KEEP_MS;
      this.members = this.members.filter((m) => m.bot || m.connected || recent(m));
      for (const m of this.members) { m.proxy = !m.bot && !m.connected; m.returning = false; }
    }

    inRound() {
      return this.phase === 'playing' || this.phase === 'judging';
    }

    // 같은 기기에서 돌아온 사람에게 자리와 손패를 돌려준다.
    // 봇이 그 사람 차례를 두려고 기다리는 중이면 그 수가 끝난 뒤에 돌려준다.
    reattach(m, peerId) {
      m.peerId = peerId;
      m.connected = true;
      m.left = false;
      this.send(peerId, { t: 'welcome', playerId: m.id, token: m.token });
      if (!this.inRound()) {
        m.proxy = false;
      } else if (this.botTimer !== null && this.actorId() === m.id) {
        m.returning = true;
      } else {
        m.proxy = false;
        if (this.phase === 'playing' && this.actorId() === m.id) this.schedule();
      }
      this.broadcast();
    }

    close() {
      if (this.disposed) return;
      for (const m of this.members) {
        if (m.connected && m.peerId && m.peerId !== this.hostPeerId) this.send(m.peerId, { t: 'closed' });
      }
    }

    // ---- 대기실 ----

    onHello(peerId, msg) {
      if (this.memberByPeer(peerId)) return;
      // 옛 연결이 끊긴 걸 아직 모르는 채로 같은 기기가 다시 들어올 수도 있다. 표식이 맞으면 새 연결로 바꿔 준다.
      const known = msg.token ? this.members.find((m) => m.token === msg.token && !m.bot) : null;
      if (known) return this.reattach(known, peerId);
      if (this.inRound()) return this.send(peerId, { t: 'reject', reason: 'started' });
      if (this.members.length >= MAX_SEATS) return this.send(peerId, { t: 'reject', reason: 'full' });
      const id = peerId === this.hostPeerId ? 'p1' : 'p' + this.nextPersonId++;
      const m = { id, name: cleanName(msg.name), peerId, token: this.makeToken(), connected: true, bot: null, proxy: false, score: 0 };
      if (id === 'p1') this.members.unshift(m);
      else this.members.push(m);
      this.send(peerId, { t: 'welcome', playerId: id, token: m.token });
      this.broadcast();
    }

    onAddBot(level) {
      if (this.phase !== 'lobby' || !BOT_LABEL[level] || this.members.length >= MAX_SEATS) return;
      const label = BOT_LABEL[level];
      const used = new Set(this.members.filter((m) => m.bot).map((m) => m.name));
      let n = 1;
      while (used.has(label + n)) n += 1;
      this.members.push({ id: 'b' + this.nextBotId++, name: label + n, peerId: null, token: null, connected: true, bot: level, proxy: false, score: 0 });
      this.broadcast();
    }

    onRemoveBot(id) {
      const m = this.member(id);
      if (this.phase !== 'lobby' || !m || !m.bot) return;
      this.members.splice(this.members.indexOf(m), 1);
      this.broadcast();
    }

    onRules(rules) {
      if (this.phase !== 'lobby' || !rules || typeof rules !== 'object') return;
      for (const k of RULE_KEYS) if (typeof rules[k] === 'boolean') this.rules[k] = rules[k];
      this.broadcast();
    }

    onStart() {
      if (this.phase !== 'lobby' || this.members.length < 2) return;
      this.resetScores();
      this.firstSeat = null;
      this.startRound();
    }

    resetScores() {
      for (const m of this.members) m.score = 0;
    }

    startRound() {
      this.clearRoundTimers();
      this.pruneGhosts(true);
      const ids = this.members.map((m) => m.id);
      const n = ids.length;
      this.firstSeat = this.firstSeat === null ? Math.floor(this.rng() * n) : (this.firstSeat + 1) % n;
      this.game = Game.newRound(ids, this.rules, this.rng, this.firstSeat);
      this.memory = Bot.newMemory();
      this.log = [];
      this.result = null;
      this.matchWinnerId = null;
      this.phase = 'playing';
      this.schedule();
      this.broadcast();
    }

    // ---- 판과 경기 ----

    endRound() {
      this.clearRoundTimers();
      const result = Game.roundResult(this.game);
      this.result = result;
      const winner = this.member(result.winnerId);
      if (this.rules.score) {
        winner.score += result.gained;
        if (winner.score >= TARGET_SCORE) {
          this.phase = 'matchover';
          this.matchWinnerId = winner.id;
        } else {
          this.phase = 'roundover';
        }
      } else {
        this.phase = 'matchover';
        this.matchWinnerId = winner.id;
      }
    }

    onNext() {
      if (this.phase === 'roundover') this.startRound();
    }

    onAgain() {
      if (this.phase !== 'matchover') return;
      this.resetScores();
      this.startRound();
    }

    onToLobby() {
      if (this.phase !== 'roundover' && this.phase !== 'matchover') return;
      this.clearRoundTimers();
      this.pruneGhosts();
      this.resetScores();
      this.phase = 'lobby';
      this.game = null;
      this.result = null;
      this.matchWinnerId = null;
      this.log = [];
      this.firstSeat = null;
      this.broadcast();
    }

    // ---- 게임 진행 ----

    actorId() {
      const g = this.game;
      if (!g || g.winnerId) return null;
      return g.await ? g.await.playerId : Game.current(g);
    }

    record(events, before) {
      for (const e of events) {
        this.log.unshift(e);
        this.seq += 1;
        Bot.observe(this.memory, before, e);
      }
      this.log.length = Math.min(this.log.length, LOG_SIZE);
    }

    before() {
      return { color: this.game.color, pending: this.game.pending };
    }

    // 다른 사람이 행동하면 열려 있던 잡기 시간은 최소 시간이 지난 뒤 닫힌다.
    markActed(actorId) {
      for (const [id, w] of this.windows) if (id !== actorId) w.actedAfter = true;
    }

    // 차례 행동 하나를 적용한다. botLevel이 있으면 봇이 마지막 한 장이 될 때 막타를 외칠지 정한다.
    act(playerId, action) {
      if (this.phase !== 'playing' || this.actorId() !== playerId) return false;
      const now = this.clock.now();
      if (action && action.t === 'pass' && this.lastDraw && this.lastDraw.id === playerId
        && now - this.lastDraw.at < TIMING.PASS_GUARD_MS) return false;
      const g = this.game;
      const before = this.before();
      const peekCards = action && action.t === 'challenge' && g.wild4 ? Game.playerOf(g, g.wild4.by).hand.slice() : null;
      const r = applyAction(g, playerId, action);
      if (!r.ok) return false;
      this.markActed(playerId);
      this.record(r.events, before);
      if (peekCards) this.peek = { to: playerId, cards: sortHand(peekCards) };
      this.lastDraw = action.t === 'draw' ? { id: playerId, at: now } : null;
      this.afterChange(r.events);
      return true;
    }

    onCall(playerId) {
      if (this.phase !== 'playing' && this.phase !== 'judging') return;
      const r = Game.call(this.game, playerId);
      if (!r.ok) return;
      this.record(r.events, this.before());
      this.syncWindows([]);
      this.broadcast();
    }

    afterChange(events = []) {
      this.botCalls();
      this.syncWindows(events);
      if (this.game.winnerId) this.endRound();
      else this.schedule();
      this.broadcast();
    }

    // 1장이 된 봇(대신 두는 자리 포함)은 어떻게 1장이 됐든 레벨에 맞는 확률로 막타를 외친다.
    botCalls() {
      const g = this.game;
      if (!g || g.winnerId) return;
      const ids = Game.catchable(g);
      for (const id of this.forgot) if (!ids.includes(id)) this.forgot.delete(id);
      for (const id of ids) {
        const m = this.member(id);
        if (!m || !(m.bot || m.proxy) || this.forgot.has(id)) continue;
        if (!Bot.wantsCall(m.bot || 'mid', this.rng)) { this.forgot.add(id); continue; }
        const c = Game.call(g, id);
        if (c.ok) this.record(c.events, this.before());
      }
    }

    // ---- 잡기 ----

    isOpen(id) {
      const w = this.windows.get(id);
      const now = this.clock.now();
      return !!w && now >= w.from && (now < w.minUntil || !w.actedAfter);
    }

    // 게임에서 잡을 수 있는 사람과 잡기 시간을 맞춘다. 새로 생긴 사람에게는 시간을 열고 봇이 잡을 준비를 한다.
    syncWindows(events) {
      const g = this.game;
      const now = this.clock.now();
      const ids = g ? Game.catchable(g) : [];
      for (const id of this.spent) if (!ids.includes(id)) this.spent.delete(id);
      for (const [id, w] of this.windows) {
        if (!ids.includes(id)) this.windows.delete(id);
        else if (w.actedAfter && now >= w.minUntil) this.closeWindow(id);
      }
      const grace = events.some((e) => e.type === 'swap' || e.type === 'rotate');
      // 7과 0으로 손패가 바뀐 사람은 1장이 계속이었더라도 새로 잡을 수 있다.
      for (const e of events) {
        const changed = e.type === 'rotate' ? g.players.map((p) => p.id) : e.type === 'swap' ? [e.a, e.b] : [];
        for (const id of changed) { this.spent.delete(id); this.windows.delete(id); }
      }
      for (const id of ids) {
        if (this.windows.has(id) || this.spent.has(id)) continue;
        const from = now + (grace ? TIMING.SWAP_GRACE_MS : 0);
        const w = { from, minUntil: from + TIMING.CATCH_MIN_MS, actedAfter: false };
        this.windows.set(id, w);
        if (grace) this.later(this.catchTimers, from - now, () => this.broadcast());
        this.later(this.catchTimers, w.minUntil - now, () => {
          if (this.windows.get(id) === w && w.actedAfter) {
            this.closeWindow(id);
            this.broadcast();
          }
        });
        this.scheduleBotCatches(id, from - now);
      }
    }

    closeWindow(id) {
      this.windows.delete(id);
      this.spent.add(id);
    }

    scheduleBotCatches(targetId, offset, only = null) {
      for (const m of only ? [only] : this.members) {
        if (m.id === targetId || !(m.bot || m.proxy)) continue;
        const level = m.bot || 'mid';
        const delay = offset + this.between(Bot.PROFILE[level].catchMs);
        this.later(this.catchTimers, delay, () => { if (this.isOpen(targetId)) this.onCatch(m.id); });
      }
    }

    onCatch(catcherId) {
      if (!this.inRound()) return;
      const target = this.members.find((m) => m.id !== catcherId && this.isOpen(m.id));
      if (!target) return;
      const r = Game.catchPlayer(this.game, catcherId, target.id);
      if (!r.ok) return;
      this.windows.delete(target.id);
      this.record(r.events, this.before());
      this.syncWindows([]);
      this.broadcast();
    }

    // ---- 끼어들기 ----

    onJump(playerId, msg) {
      const g = this.game;
      if (!this.rules.jumpIn || (this.phase !== 'playing' && this.phase !== 'judging')) return;
      if (msg.topVersion !== g.topVersion || !Game.canJump(g, playerId, msg.cardId)) return;
      const reactionMs = Number.isFinite(msg.reactionMs) && msg.reactionMs >= 0 ? msg.reactionMs : Infinity;
      this.entries.push({ playerId, cardId: msg.cardId, reactionMs, seq: ++this.entrySeq });
      if (this.phase === 'judging') return;
      this.phase = 'judging';
      this.clearTurnTimers();
      this.judgeTimer = this.clock.setTimeout(() => this.settleJump(), this.judgeWindowMs());
      this.broadcast();
    }

    settleJump() {
      this.judgeTimer = null;
      const w = Judge.pickJump(this.entries);
      this.entries = [];
      this.phase = 'playing';
      const g = this.game;
      if (w && Game.canJump(g, w.playerId, w.cardId)) {
        const before = this.before();
        const r = Game.jumpIn(g, w.playerId, w.cardId);
        this.markActed(w.playerId);
        this.record(r.events, before);
        this.afterChange(r.events);
      } else {
        this.schedule();
        this.broadcast();
      }
    }

    scheduleBotJumps() {
      for (const h of this.jumpTimers) this.clock.clearTimeout(h);
      this.jumpTimers = [];
      const g = this.game;
      if (!this.rules.jumpIn || this.phase !== 'playing' || !g || g.winnerId) return;
      for (const m of this.members) {
        if (!(m.bot || m.proxy)) continue;
        const level = m.bot || 'mid';
        const cardId = Bot.jumpCard(g, m.id, level, this.rng);
        if (cardId === null) continue;
        const delay = this.between(Bot.PROFILE[level].jumpMs);
        const topVersion = g.topVersion;
        this.later(this.jumpTimers, delay, () => this.onJump(m.id, { cardId, topVersion, reactionMs: delay }));
      }
    }

    // ---- 시간 ----

    later(list, ms, fn) {
      const h = this.clock.setTimeout(() => {
        const i = list.indexOf(h);
        if (i >= 0) list.splice(i, 1);
        if (!this.disposed) fn();
      }, Math.max(0, ms));
      list.push(h);
    }

    clearTurnTimers() {
      this.token += 1;
      if (this.botTimer !== null) this.clock.clearTimeout(this.botTimer);
      if (this.turnTimer !== null) this.clock.clearTimeout(this.turnTimer);
      this.botTimer = this.turnTimer = this.turnDeadline = null;
    }

    clearRoundTimers() {
      this.clearTurnTimers();
      for (const h of [...this.catchTimers, ...this.jumpTimers]) this.clock.clearTimeout(h);
      if (this.judgeTimer !== null) this.clock.clearTimeout(this.judgeTimer);
      this.catchTimers = [];
      this.jumpTimers = [];
      this.judgeTimer = null;
      this.entries = [];
      this.windows.clear();
      this.spent.clear();
      this.forgot.clear();
      this.lastDraw = null;
    }

    between([lo, hi]) {
      return lo + this.rng() * (hi - lo);
    }

    // 지금 해야 할 사람이 봇이면 생각하는 척한 뒤 두고, 사람이면 시간 제한을 건다.
    // 봇은 열려 있는 잡기 시간의 최소 시간이 지날 때까지 기다린다.
    schedule() {
      for (const m of this.members) {
        if (m.returning) { m.returning = false; m.proxy = false; }
      }
      this.clearTurnTimers();
      const id = this.actorId();
      if (!id || this.phase !== 'playing') return;
      const m = this.member(id);
      const token = this.token;
      if (m.bot || m.proxy) {
        const now = this.clock.now();
        let wait = this.between(TIMING.BOT_THINK_MS);
        for (const w of this.windows.values()) wait = Math.max(wait, w.minUntil - now);
        this.botTimer = this.clock.setTimeout(() => {
          if (token !== this.token) return;
          this.botTimer = null;
          this.botMove(id);
        }, wait);
      } else if (this.rules.turnTimer || (this.game.await && this.game.await.kind === 'swap')) {
        this.turnDeadline = this.clock.now() + TIMING.TURN_MS;
        this.turnTimer = this.clock.setTimeout(() => {
          if (token !== this.token) return;
          this.turnTimer = null;
          this.act(id, Game.autoAction(this.game));
        }, TIMING.TURN_MS);
      }
      this.scheduleBotJumps();
    }

    botMove(id) {
      const m = this.member(id);
      const level = m.bot || 'mid';
      this.act(id, Bot.decide(this.game, id, level, this.memory, this.rng));
    }

    // ---- 화면 정보 ----

    playableFor(memberId) {
      const g = this.game;
      if (!g || this.phase !== 'playing') return [];
      if (this.actorId() === memberId) return Game.playableIds(g, memberId);
      if (!this.rules.jumpIn) return [];
      const p = Game.playerOf(g, memberId);
      return p ? p.hand.filter((c) => Game.canJump(g, memberId, c.id)).map((c) => c.id) : [];
    }

    viewFor(memberId) {
      const g = this.game;
      const actor = this.actorId();
      const me = g ? Game.playerOf(g, memberId) : null;
      const players = this.members.map((m) => {
        const p = g ? Game.playerOf(g, m.id) : null;
        return {
          id: m.id,
          name: m.name,
          bot: m.bot,
          proxy: m.proxy,
          connected: m.connected,
          count: p ? p.hand.length : 0,
          called: p ? p.called : false,
          catchable: this.isOpen(m.id),
          isTurn: actor === m.id,
          score: m.score,
        };
      });
      return {
        phase: this.phase,
        me: memberId,
        hostId: 'p1',
        rules: { ...this.rules },
        players,
        hand: me ? sortHand(me.hand) : [],
        playableIds: this.playableFor(memberId),
        top: g ? Game.top(g) : null,
        color: g ? g.color : null,
        dir: g ? g.dir : 1,
        drawCount: g ? g.draw.length : 0,
        topVersion: g ? g.topVersion : 0,
        turnId: actor,
        await: g ? g.await : null,
        pending: g && g.pending ? { count: g.pending.count } : null,
        canChallenge: !!(g && this.phase === 'playing' && Game.canChallenge(g, memberId)),
        drewId: g && actor === memberId ? g.drewId : null,
        turnMsLeft: this.turnDeadline !== null ? Math.max(0, this.turnDeadline - this.clock.now()) : null,
        log: this.log.slice(),
        seq: this.seq,
        peek: this.peek && this.peek.to === memberId ? this.peek.cards : null,
        result: this.result,
        matchWinnerId: this.matchWinnerId,
      };
    }

    broadcast() {
      if (this.disposed) return;
      for (const m of this.members) {
        if (m.connected && m.peerId) this.send(m.peerId, { t: 'view', view: this.viewFor(m.id) });
      }
      this.peek = null;
    }
  }

  HostSession.TIMING = TIMING;
  HostSession.MAX_SEATS = MAX_SEATS;
  HostSession.RULE_KEYS = RULE_KEYS;
  HostSession.BOT_LABEL = BOT_LABEL;
  HostSession.sortHand = sortHand;

  if (typeof module === 'object' && module.exports) module.exports = HostSession;
  else root.HostSession = HostSession;
})(this);
