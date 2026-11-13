// 시작점. 화면 버튼, 방 만들기/들어가기, 재접속, 화면 켜짐 유지를 연결한다.
(function (root) {
  'use strict';

  const { UI, Net, Client, HostSession, Sound, I18n } = root;
  const t = (key, params) => I18n.t(key, params);
  const NAME_KEY = 'makta.name';
  const tokenKey = (code) => 'makta.token.' + code;
  const RETRY_MS = 3000;
  const RECONNECT_MS = 30000;
  // 판 밖(대기실, 결과 화면)에서 방장과 끊기면 더 오래 기다린다. 방장이 결과를 보다가 잠깐 다른 앱에
  // 다녀오는 일이 흔하다. 그동안 방장 쪽 방 번호가 중개 서버에서 잠시 없어질 수도 있어서(not-found) 그것도 기다린다.
  // 방장은 이보다 조금 길게 자리를 남겨 둔다(host.js GHOST_KEEP_MS).
  const RECONNECT_IDLE_MS = 120000;
  const CLOSE_LINGER_MS = 300;
  const GAME_PHASES = new Set(['playing', 'judging']);
  const RESULT_PHASES = new Set(['roundover', 'matchover']);

  // 연결 실패 이유별 안내. 문구는 사전의 'err.<이유>'
  const ERROR_CODES = new Set(['not-found', 'timeout', 'no-internet', 'full', 'started', 'closed']);
  const errorText = (code) => t('err.' + (ERROR_CODES.has(code) ? code : 'no-internet'));

  function storage(kind) {
    return {
      get(key) { try { return root[kind].getItem(key); } catch (e) { return null; } },
      set(key, value) { try { root[kind].setItem(key, value); } catch (e) { /* 저장 불가 */ } },
    };
  }
  const local = storage('localStorage');
  const session = storage('sessionStorage');

  // 지금 들어가 있는 방
  let mode = null; // 'host' | 'guest' | null
  let code = null;
  let host = null; // HostSession (방장만)
  let room = null; // Net.createRoom 결과 (방장만)
  let conn = null; // Net.joinRoom 결과 (참가자만)
  let client = null;
  let busy = false;
  let pendingRoom = null;
  let reconnect = null; // { deadline, timer, trying }
  let wakeLock = null;

  // ---- 공통 ----

  function validName() {
    const name = UI.getName().trim();
    if (name.length >= 1 && name.length <= 8) return name;
    UI.show('start');
    UI.setMessage('start', t('start.nameInvalid'));
    return null;
  }

  function inGame() {
    return !!(client && client.view && GAME_PHASES.has(client.view.phase));
  }

  function onView(view) {
    if (view.phase === 'lobby') {
      UI.show('lobby');
      const qr = mode === 'host' ? `${location.origin}${location.pathname}?room=${code}` : null;
      UI.renderLobby(view, mode === 'host' ? code : null, qr);
    } else if (RESULT_PHASES.has(view.phase)) {
      UI.show('result');
      UI.renderResult(view);
    } else {
      UI.setRoom(code);
      UI.show('game');
      UI.renderGame(view);
    }
    requestWake();
  }

  // linger: 방장이 직접 나갈 때는 '방 닫힘' 알림이 참가자에게 닿도록 연결을 조금 늦게 끊는다.
  // (화면을 벗어날 때는 아이폰 타이머가 멈추므로 바로 끊는다.)
  function endRoom(message, { linger = false } = {}) {
    if (reconnect) clearTimeout(reconnect.timer);
    reconnect = null;
    if (conn) conn.close();
    if (host) {
      host.close();
      host.dispose();
    }
    if (room) {
      const r = room;
      if (linger) setTimeout(() => r.close(), CLOSE_LINGER_MS);
      else r.close();
    }
    mode = code = host = room = conn = client = null;
    releaseWake();
    history.replaceState(null, '', location.pathname);
    UI.show('start');
    UI.setMessage('start', '');
    if (message) UI.error(message);
  }

  // ---- 방장 ----

  async function createRoom() {
    const name = validName();
    if (!name || busy) return;
    busy = true;
    UI.setMessage('start', t('start.creating'));
    try {
      room = await Net.createRoom({
        onConnect: (id) => host && host.handleConnect(id),
        onMessage: (id, msg) => host && host.handleMessage(id, msg),
        onDisconnect: (id) => host && host.handleDisconnect(id),
        onLatency: (id, rtt) => host && host.setLatency(id, rtt),
      });
    } catch (e) {
      busy = false;
      UI.setMessage('start', '');
      UI.error(errorText(e.code), { retry: createRoom });
      return;
    }
    busy = false;
    UI.setMessage('start', '');
    mode = 'host';
    code = room.code;
    // 이 방의 객체를 붙잡아 둔다. 방이 바뀐 뒤 옛 방의 메시지가 새 방으로 새지 않게.
    const myRoom = room;
    let myClient = null;
    const deliver = (msg) => queueMicrotask(() => myClient && myClient.receive(msg));
    const myHost = new HostSession({
      hostPeerId: 'local',
      rng: Math.random,
      clock: { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h) },
      send: (peerId, msg) => (peerId === 'local' ? deliver(msg) : myRoom.send(peerId, msg)),
    });
    myClient = Client.create({
      send: (msg) => queueMicrotask(() => myHost.handleMessage('local', msg)),
      onView,
    });
    host = myHost;
    client = myClient;
    host.handleMessage('local', { t: 'hello', name, token: null });
  }

  function toHost(msg) {
    if (client && mode === 'host') host.handleMessage('local', msg);
  }

  // ---- 참가자 ----

  function guestHandlers() {
    return {
      onMessage: (msg) => client && client.receive(msg),
      onClose: (reason) => (reason === 'closed' ? endRoom(t('err.hostClosed')) : startReconnect()),
    };
  }

  function sendHello() {
    conn.send({ t: 'hello', name: UI.getName().trim(), token: session.get(tokenKey(code)) });
  }

  async function joinRoom(roomCode) {
    const name = validName();
    if (!name || busy) return;
    busy = true;
    pendingRoom = null;
    UI.setMessage('join', t('start.connecting'));
    UI.setMessage('start', t('start.connecting'));
    try {
      conn = await Net.joinRoom(roomCode, guestHandlers());
    } catch (e) {
      busy = false;
      UI.setMessage('join', '');
      UI.setMessage('start', '');
      UI.error(errorText(e.code), e.code === 'no-internet' ? { retry: () => joinRoom(roomCode) } : {});
      return;
    }
    busy = false;
    UI.setMessage('join', '');
    UI.setMessage('start', '');
    mode = 'guest';
    code = roomCode;
    client = Client.create({
      send: (msg) => conn && conn.send(msg),
      onView,
      onWelcome: (w) => session.set(tokenKey(code), w.token),
      onReject: (reason) => endRoom(ERROR_CODES.has(reason) ? errorText(reason) : undefined),
    });
    history.replaceState(null, '', `${location.pathname}?room=${roomCode}`);
    sendHello();
  }

  // 방장과 끊겼다. 내 쪽 문제일 수도 있으니 3초마다 다시 붙어 본다.
  // 게임 중이면 30초 동안(그동안 내 자리는 봇이 대신 둔다), 방장 쪽 방이 아예 없어졌으면(not-found) 바로 끝낸다.
  // 대기실이나 결과 화면이면 지금 화면을 그대로 둔 채 2분 동안 방장을 기다린다. 「나가기」로 언제든 나갈 수 있다.
  function startReconnect() {
    conn = null;
    if (reconnect || !mode) return;
    const playing = inGame();
    const ms = playing ? RECONNECT_MS : RECONNECT_IDLE_MS;
    reconnect = { deadline: Date.now() + ms, timer: null, trying: false, playing };
    UI.toast(t(playing ? 'net.lost' : 'net.waitHost'), ms);
    tryReconnect();
  }

  async function tryReconnect() {
    if (!reconnect || reconnect.trying) return;
    clearTimeout(reconnect.timer);
    reconnect.trying = true;
    const myCode = code;
    try {
      const c = await Net.joinRoom(myCode, guestHandlers());
      if (!reconnect || code !== myCode) return c.close();
      conn = c;
      reconnect = null;
      UI.toast(t('net.back'));
      sendHello();
    } catch (e) {
      if (!reconnect) return;
      reconnect.trying = false;
      if ((e.code === 'not-found' && reconnect.playing) || Date.now() >= reconnect.deadline) endRoom(errorText('closed'));
      else reconnect.timer = setTimeout(tryReconnect, RETRY_MS);
    }
  }

  // ---- 나가기 ----

  function leave() {
    if (mode === 'host') {
      const others = client && client.view ? client.view.players.some((p) => !p.bot && p.id !== client.view.me) : false;
      if (others && !confirm(t('confirm.hostLeave'))) return;
      endRoom(null, { linger: true });
    } else if (mode === 'guest') {
      if (inGame() && !confirm(t('confirm.guestLeave'))) return;
      const c = conn;
      conn = null;
      if (c) {
        c.send({ t: 'leave' });
        setTimeout(() => c.close(), 300);
      }
      endRoom(null);
    } else {
      UI.show('start');
    }
  }

  // ---- 화면 켜짐 유지 ----

  function requestWake() {
    if (wakeLock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    wakeLock = 'pending';
    navigator.wakeLock.request('screen').then((lock) => {
      if (!mode) {
        lock.release().catch(() => {});
        wakeLock = null;
        return;
      }
      wakeLock = lock;
      lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
    }).catch(() => { wakeLock = null; });
  }

  function releaseWake() {
    if (wakeLock && wakeLock !== 'pending') wakeLock.release().catch(() => {});
    wakeLock = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      // 방장이 화면을 벗어나면 방을 닫는다(설계: 방장 연결이 끊기면 방이 닫힘).
      if (mode === 'host' && inGame()) endRoom(t('err.hostLeft'));
      return;
    }
    if (mode) requestWake();
    if (reconnect) tryReconnect();
  });

  root.addEventListener('pagehide', () => {
    if (mode === 'host') endRoom(null);
  });

  // 아이폰은 손을 뗄 때(touchend, click)를 사용자 동작으로 보므로 여러 이벤트에서 소리를 연다.
  for (const ev of ['pointerdown', 'touchend', 'click']) {
    document.addEventListener(ev, () => {
      Sound.unlock();
      if (mode) requestWake();
    }, { passive: true });
  }

  // ---- 버튼 연결 ----

  UI.on('name-change', (name) => local.set(NAME_KEY, name.trim()));
  UI.on('create', createRoom);
  UI.on('join-open', () => {
    if (!validName()) return;
    if (pendingRoom) return joinRoom(pendingRoom);
    UI.setMessage('start', '');
    UI.setMessage('join', '');
    UI.clearCode();
    UI.show('join');
    UI.focusCode();
  });
  UI.on('join-submit', (value) => {
    if (!/^\d{4}$/.test(value)) return UI.setMessage('join', t('join.needDigits'));
    joinRoom(value);
  });
  UI.on('back', () => UI.show('start'));
  UI.on('rules-open', () => UI.show('rules'));
  UI.on('rules-close', () => UI.show('start'));
  UI.on('add-bot', (level) => toHost({ t: 'add-bot', level }));
  UI.on('remove-bot', (id) => toHost({ t: 'remove-bot', id }));
  UI.on('rules', (rules) => toHost({ t: 'rules', rules }));
  UI.on('start', () => toHost({ t: 'start' }));
  UI.on('next', () => toHost({ t: 'next' }));
  UI.on('again', () => toHost({ t: 'again' }));
  UI.on('to-lobby', () => toHost({ t: 'to-lobby' }));
  UI.on('play', (ids) => client && client.play(ids));
  UI.on('draw', () => client && client.draw());
  UI.on('pass', () => client && client.pass());
  UI.on('color', (c) => client && client.color(c));
  UI.on('swap', (id) => client && client.swap(id));
  UI.on('challenge', () => client && client.challenge());
  UI.on('call', () => client && client.call());
  UI.on('catch', () => client && client.catch());
  UI.on('jump', (id) => client && client.jump(id));
  UI.on('leave', leave);
  // 시작 화면에서 언어를 바꾸면 그 화면의 안내 문구도 다시 적는다.
  UI.on('lang-change', () => {
    if (!mode && !busy) UI.setMessage('start', pendingRoom ? t('start.pending', { room: pendingRoom }) : '');
  });

  // ---- 처음 열 때 ----

  UI.setName(local.get(NAME_KEY) || '');
  const roomParam = new URLSearchParams(location.search).get('room');
  UI.show('start');
  if (roomParam && /^\d{4}$/.test(roomParam)) {
    if (UI.getName().trim()) joinRoom(roomParam);
    else {
      pendingRoom = roomParam;
      UI.setMessage('start', t('start.pending', { room: roomParam }));
    }
  }
})(this);
