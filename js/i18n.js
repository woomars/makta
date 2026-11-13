// 화면 문구 사전(한국어·영어·일본어)과 언어 고르기. 허브(woomars.github.io)와 같은 저장 키를 쓴다.
// 언어 순서: 주소의 ?lang= → localStorage 'woomars.lang' → 브라우저 언어(ko·ja, 그 밖은 en).
(function (root) {
  'use strict';

  const LANGS = ['ko', 'en', 'ja'];
  const KEY = 'woomars.lang';
  const LANG_NAMES = { ko: '한국어', en: 'English', ja: '日本語' };

  // ---- 한국어 조사 ----

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

  const cardsEn = (n) => `${n} ${n === 1 ? 'card' : 'cards'}`;
  const ptsEn = (n) => `${n} ${n === 1 ? 'pt' : 'pts'}`;

  // 값은 '{이름}' 자리표를 쓰는 문자열이거나, 인자를 받아 문자열을 돌려주는 함수다.
  const DICT = {
    ko: {
      'app.name': '막타',
      'app.desc': '폭탄 카드로 서로 공격하며 손패를 먼저 비우는 가족 카드 게임',
      'lang.label': '언어',

      'start.tagline': '폭탄 카드로 서로 공격하고, 손패를 먼저 비우세요',
      'start.nameLabel': '내 이름',
      'start.namePh': '예: 아빠',
      'start.create': '방 만들기',
      'start.join': '방 들어가기',
      'start.rules': '간단 규칙',
      'start.nameInvalid': '이름을 1~8자로 적어 주세요',
      'start.creating': '방을 만드는 중…',
      'start.connecting': '연결하는 중…',
      'start.pending': '이름을 적고 「방 들어가기」를 누르면 {room}번 방에 들어가요',

      'rules.1': '같은 색이나 같은 숫자를 내요.',
      'rules.2': '낼 카드가 없으면 한 장 뽑아요.',
      'rules.3': '한 장 남으면 「막타!」를 눌러요. 안 누르고 들키면 2장을 받아요.',
      'rules.4': '먼저 다 내면 이겨요.',
      'rules.attacks': '공격 카드',
      'rules.bombs': '색 = 폭탄',
      'rules.skip': '다음 사람 한 번 쉬기',
      'rules.rev': '방향 바꾸기',
      'rules.draw2': '다음 사람 2장',
      'rules.wild': '색 바꾸기',
      'rules.wild4': '색 바꾸기 + 다음 사람 4장',
      'close': '닫기',

      'join.title': '방 번호 입력',
      'join.hint': '방장 화면의 숫자 4자리',
      'join.submit': '들어가기',
      'join.needDigits': '숫자 4자리를 입력해 주세요',
      'back': '뒤로',
      'roomNo': '방 번호',

      'lobby.scan': '카메라로 찍으면 바로 들어옵니다',
      'lobby.addBot': '봇 추가',
      'lobby.rules': '변형 규칙',
      'lobby.rulesOn': '변형 규칙 ({n}개 켜짐)',
      'lobby.noRules': '변형 규칙 없이 기본 규칙으로 해요',
      'lobby.start': '시작하기',
      'lobby.startN': '시작하기 ({n}명)',
      'lobby.stay': '게임 중에는 다른 앱으로 넘어가지 마세요(방이 닫혀요)',
      'lobby.waiting': '방장이 시작하길 기다리는 중',
      'lobby.host': '방장',
      'lobby.ready': '준비됨',
      'lobby.me': ' (나)',
      'lobby.empty': '빈자리',
      'lobby.remove': '{name} 빼기',
      'leave': '나가기',

      'bot': '봇',
      'bot.low': '하수',
      'bot.mid': '중수',
      'bot.high': '고수',
      'bot.name': '{label}{n}',
      'noName': '이름 없음',

      'rule.stack': '폭격·융단폭격 쌓기',
      'rule.stack.desc': '받을 장수를 같은 공격 카드로 다음 사람에게 넘겨요',
      'rule.drawUntil': '낼 때까지 뽑기',
      'rule.drawUntil.desc': '낼 수 있는 카드가 나올 때까지 뽑아요',
      'rule.sevenZero': '7과 0',
      'rule.sevenZero.desc': '7은 고른 사람과 손패 교환, 0은 모두 손패를 옆으로 넘겨요',
      'rule.jumpIn': '끼어들기',
      'rule.jumpIn.desc': '맨 위와 똑같은 카드가 있으면 차례가 아니어도 내요',
      'rule.multi': '같은 숫자 여러 장 내기',
      'rule.multi.desc': '같은 숫자를 한 번에 여러 장 내요',
      'rule.challenge': '융단폭격 의심하기',
      'rule.challenge.desc': '융단폭격을 받으면 낼 수 있는 색이 있었는지 의심해요',
      'rule.turnTimer': '차례 시간 제한 20초',
      'rule.turnTimer.desc': '20초가 지나면 자동으로 한 장 뽑아요',
      'rule.score': '점수 모드 (500점)',
      'rule.score.desc': '남은 카드 점수를 모아 먼저 500점이면 우승',

      'color.r': '빨강',
      'color.y': '노랑',
      'color.g': '초록',
      'color.b': '파랑',
      'bomb.r': '펑',
      'bomb.y': '둥근 폭탄',
      'bomb.g': '수류탄',
      'bomb.b': '미사일',
      'kind.skip': '기절',
      'kind.rev': '반사',
      'kind.draw2': '폭격',
      'kind.wild': '조준',
      'kind.wild4': '융단폭격',
      'card.num': '{color} {value}',
      'card.action': '{color} {name}',

      'game.turn': '지금 차례',
      'game.me': '나',
      'game.judging': '끼어들기 판정 중',
      'game.room': '방 {code} · ',
      'game.cw': '시계 방향',
      'game.ccw': '반대 방향',
      'game.sec': '{n}초',
      'game.draw': '뽑기',
      'game.take': '받기 ({n}장)',
      'game.keep': '그만 (카드 갖기)',
      'game.challenge': '의심하기',
      'game.call': '막타!',
      'game.catch': '잡았다!',
      'game.notCalled': '막타 안 외침',
      'game.proxy': '봇이 대신 하는 중',
      'game.colorNow': '지금 색:',
      'game.owe': '받을 카드 {n}장',
      'game.pickColor': '어떤 색으로 조준할까요?',
      'game.swapHint': '손패를 바꿀 사람을 위에서 골라 주세요',
      'game.peek': '상대 손패',
      'game.peekOf': (p) => `${p.name}의 손패`,
      'game.throw': '한 번 더 → 던지기',
      'cards': '{n}장',

      'log.play': (p) => `${josa(p.name, '이', '가')} ${josa(p.what, '을', '를')} 냈어요`,
      'log.playMany': '{card} 외 {n}장',
      'log.jump': '{name} 끼어들기!',
      'log.draw': (p) => `${josa(p.name, '이', '가')} ${p.n}장 뽑았어요`,
      'log.drawNone': '{name} 뽑을 카드가 없어요',
      'log.attack': '{by} → {target} +{n} {kind}!',
      'log.skip': '{name} 기절!',
      'log.reverse': '반사! 방향이 바뀌었어요',
      'log.color': (p) => `${josa(p.name, '이', '가')} ${ro(p.color)} 조준!`,
      'log.swap': '{a} ⇄ {b} 손패 교환',
      'log.rotate': '모두 손패를 넘겼어요',
      'log.call': '{name} 막타!',
      'log.caught': (p) => `${josa(p.by, '이', '가')} ${josa(p.target, '을', '를')} 잡았다! +2`,
      'log.challengeOk': '의심 성공! {name} +4',
      'log.challengeFail': '의심 실패! {name} +6',
      'log.win': '{name} 막타! 승리',

      'result.title': '결과',
      'result.matchWin': (p) => `${josa(p.name, '이', '가')} 이겼다!`,
      'result.roundWin': (p) => `${josa(p.name, '이', '가')} 막타!`,
      'result.gained': '+{n}점',
      'result.left': '{count}장 · {points}점',
      'result.totals': '누적 점수 (500점 우승)',
      'result.next': '다음 판',
      'result.again': '한 판 더',
      'result.toLobby': '대기실로',
      'result.waiting': '방장이 다음 판을 고르는 중',
      'pts': '{n}점',

      'err.not-found': '방을 찾을 수 없어요. 번호를 확인해 주세요',
      'err.timeout': '연결하지 못했어요. 잠시 뒤 다시 시도해 주세요',
      'err.no-internet': '인터넷 연결을 확인해 주세요',
      'err.full': '방이 가득 찼어요',
      'err.started': '이미 게임이 시작됐어요',
      'err.closed': '방장 연결이 끊겨 방이 닫혔어요',
      'err.hostLeft': '방장이 화면을 벗어나서 방이 닫혔어요',
      'retry': '다시 시도',
      'ok': '확인',
      'net.lost': '연결이 끊겼어요. 다시 연결하는 중…',
      'net.back': '다시 연결됐어요',
      'confirm.hostLeave': '나가면 방이 닫혀요. 나갈까요?',
      'confirm.guestLeave': '게임에서 나갈까요? 내 자리는 봇이 이어서 해요',
      'rotate': '세로로 돌려 주세요',
    },

    en: {
      'app.name': 'Last Hit',
      'app.desc': 'A family card game: attack each other with bomb cards and be the first to empty your hand',
      'lang.label': 'Language',

      'start.tagline': 'Attack with bomb cards and be the first to empty your hand',
      'start.nameLabel': 'Your name',
      'start.namePh': 'e.g. Dad',
      'start.create': 'Create Room',
      'start.join': 'Join Room',
      'start.rules': 'Quick Rules',
      'start.nameInvalid': 'Enter a name of 1–8 characters',
      'start.creating': 'Creating room…',
      'start.connecting': 'Connecting…',
      'start.pending': 'Enter your name and tap “Join Room” to join room {room}',

      'rules.1': 'Play a card of the same color or number.',
      'rules.2': 'Nothing to play? Draw a card.',
      'rules.3': 'Down to one card? Tap “Last Hit!”. Get caught without calling it and you take 2 cards.',
      'rules.4': 'First to play all their cards wins.',
      'rules.attacks': 'Attack Cards',
      'rules.bombs': 'Colors = Bombs',
      'rules.skip': 'Next player loses a turn',
      'rules.rev': 'Reverses the direction',
      'rules.draw2': 'Next player takes 2',
      'rules.wild': 'Changes the color',
      'rules.wild4': 'Changes the color + next player takes 4',
      'close': 'Close',

      'join.title': 'Enter Room Number',
      'join.hint': 'The 4 digits on the host’s screen',
      'join.submit': 'Join',
      'join.needDigits': 'Enter 4 digits',
      'back': 'Back',
      'roomNo': 'Room number',

      'lobby.scan': 'Scan with a camera to join right away',
      'lobby.addBot': 'Add Bot',
      'lobby.rules': 'House Rules',
      'lobby.rulesOn': 'House Rules ({n} on)',
      'lobby.noRules': 'No house rules, just the basics',
      'lobby.start': 'Start',
      'lobby.startN': (p) => `Start (${p.n} ${p.n === 1 ? 'player' : 'players'})`,
      'lobby.stay': 'Don’t switch apps during the game (the room will close)',
      'lobby.waiting': 'Waiting for the host to start',
      'lobby.host': 'Host',
      'lobby.ready': 'Ready',
      'lobby.me': ' (you)',
      'lobby.empty': 'Empty seat',
      'lobby.remove': 'Remove {name}',
      'leave': 'Leave',

      'bot': 'Bot',
      'bot.low': 'Novice',
      'bot.mid': 'Adept',
      'bot.high': 'Expert',
      'bot.name': '{label} {n}',
      'noName': 'No name',

      'rule.stack': 'Stack Strike & Blitz',
      'rule.stack.desc': 'Pass the cards you’d take on to the next player with the same attack card',
      'rule.drawUntil': 'Draw until you can play',
      'rule.drawUntil.desc': 'Keep drawing until you get a card you can play',
      'rule.sevenZero': '7 and 0',
      'rule.sevenZero.desc': '7 swaps hands with a player you pick; 0 makes everyone pass their hand along',
      'rule.jumpIn': 'Jump in',
      'rule.jumpIn.desc': 'Have an exact match for the top card? Play it, even out of turn',
      'rule.multi': 'Play multiples',
      'rule.multi.desc': 'Play several cards of the same number at once',
      'rule.challenge': 'Challenge a Blitz',
      'rule.challenge.desc': 'Hit by a Blitz? Challenge it if you think they had a matching color',
      'rule.turnTimer': '20-second turn limit',
      'rule.turnTimer.desc': 'After 20 seconds you draw a card automatically',
      'rule.score': 'Score mode (500 pts)',
      'rule.score.desc': 'Score the cards left in hands; first to 500 points wins',

      'color.r': 'Red',
      'color.y': 'Yellow',
      'color.g': 'Green',
      'color.b': 'Blue',
      'bomb.r': 'Boom',
      'bomb.y': 'Round bomb',
      'bomb.g': 'Grenade',
      'bomb.b': 'Missile',
      'kind.skip': 'Stun',
      'kind.rev': 'Reflect',
      'kind.draw2': 'Strike',
      'kind.wild': 'Aim',
      'kind.wild4': 'Blitz',
      'card.num': '{color} {value}',
      'card.action': '{color} {name}',

      'game.turn': 'Turn',
      'game.me': 'You',
      'game.judging': 'Judging jump-in',
      'game.room': 'Room {code} · ',
      'game.cw': 'Clockwise',
      'game.ccw': 'Counterclockwise',
      'game.sec': '{n}s',
      'game.draw': 'Draw',
      'game.take': (p) => `Take ${cardsEn(p.n)}`,
      'game.keep': 'Stop (keep it)',
      'game.challenge': 'Challenge',
      'game.call': 'Last Hit!',
      'game.catch': 'Gotcha!',
      'game.notCalled': "Didn't call",
      'game.proxy': 'Bot playing',
      'game.colorNow': 'Color:',
      'game.owe': (p) => `To take: ${cardsEn(p.n)}`,
      'game.pickColor': 'Which color will you aim at?',
      'game.swapHint': 'Pick a player above to swap hands with',
      'game.peek': 'Their hand',
      'game.peekOf': "{name}'s hand",
      'game.throw': 'Tap again → throw',
      'cards': (p) => cardsEn(p.n),

      'log.play': '{name} played {what}',
      'log.playMany': '{card} +{n} more',
      'log.jump': '{name} jumps in!',
      'log.draw': (p) => `${p.name} drew ${cardsEn(p.n)}`,
      'log.drawNone': 'Nothing left for {name} to draw',
      'log.attack': '{by} → {target} +{n} {kind}!',
      'log.skip': '{name} is stunned!',
      'log.reverse': 'Reflect! Direction reversed',
      'log.color': '{name} aims at {color}!',
      'log.swap': '{a} ⇄ {b} swapped hands',
      'log.rotate': 'Everyone passed their hand',
      'log.call': '{name} calls Last Hit!',
      'log.caught': '{by} caught {target}! +2',
      'log.challengeOk': 'Challenge succeeded! {name} +4',
      'log.challengeFail': 'Challenge failed! {name} +6',
      'log.win': '{name} lands the Last Hit! Victory',

      'result.title': 'Results',
      'result.matchWin': '{name} wins!',
      'result.roundWin': '{name}: Last Hit!',
      'result.gained': (p) => `+${ptsEn(p.n)}`,
      'result.left': (p) => `${cardsEn(p.count)} · ${ptsEn(p.points)}`,
      'result.totals': 'Total score (500 to win)',
      'result.next': 'Next Round',
      'result.again': 'Play Again',
      'result.toLobby': 'Back to Lobby',
      'result.waiting': 'The host is choosing what’s next',
      'pts': (p) => ptsEn(p.n),

      'err.not-found': 'Room not found. Check the number.',
      'err.timeout': 'Couldn’t connect. Try again in a moment.',
      'err.no-internet': 'Check your internet connection.',
      'err.full': 'The room is full.',
      'err.started': 'The game has already started.',
      'err.closed': 'Lost connection to the host, so the room closed.',
      'err.hostLeft': 'The host left the screen, so the room closed.',
      'retry': 'Retry',
      'ok': 'OK',
      'net.lost': 'Disconnected. Reconnecting…',
      'net.back': 'Reconnected',
      'confirm.hostLeave': 'Leaving will close the room. Leave?',
      'confirm.guestLeave': 'Leave the game? A bot will take over your seat.',
      'rotate': 'Please turn your phone upright',
    },

    ja: {
      'app.name': 'ラストヒット',
      'app.desc': '爆弾カードで攻撃し合い、先に手札をなくした人が勝つ家族向けカードゲーム',
      'lang.label': '言語',

      'start.tagline': '爆弾カードで攻撃し合い、先に手札をなくそう',
      'start.nameLabel': '名前',
      'start.namePh': '例：パパ',
      'start.create': 'ルームを作る',
      'start.join': 'ルームに入る',
      'start.rules': 'かんたんルール',
      'start.nameInvalid': '名前を1〜8文字で入力してください',
      'start.creating': 'ルームを作成中…',
      'start.connecting': '接続中…',
      'start.pending': '名前を入力して「ルームに入る」を押すと、{room}番ルームに入ります',

      'rules.1': '同じ色か同じ数字のカードを出す。',
      'rules.2': '出せるカードがなければ1枚引く。',
      'rules.3': '残り1枚になったら「ラストヒット！」を押す。押さずに見つかると2枚もらう。',
      'rules.4': '先に全部出した人の勝ち。',
      'rules.attacks': '攻撃カード',
      'rules.bombs': '色 = 爆弾',
      'rules.skip': '次の人は1回休み',
      'rules.rev': '順番が逆回りになる',
      'rules.draw2': '次の人に2枚',
      'rules.wild': '色を変える',
      'rules.wild4': '色を変える＋次の人に4枚',
      'close': '閉じる',

      'join.title': 'ルーム番号を入力',
      'join.hint': 'ホスト画面に出ている4桁の数字',
      'join.submit': '入る',
      'join.needDigits': '4桁の数字を入力してください',
      'back': '戻る',
      'roomNo': 'ルーム番号',

      'lobby.scan': 'カメラで読み取るとすぐ参加できます',
      'lobby.addBot': 'ボット追加',
      'lobby.rules': 'ハウスルール',
      'lobby.rulesOn': 'ハウスルール（{n}個オン）',
      'lobby.noRules': 'ハウスルールなし、基本ルールで遊びます',
      'lobby.start': 'スタート',
      'lobby.startN': 'スタート（{n}人）',
      'lobby.stay': 'ゲーム中はほかのアプリに切り替えないで（ルームが閉じます）',
      'lobby.waiting': 'ホストの開始を待っています',
      'lobby.host': 'ホスト',
      'lobby.ready': '準備OK',
      'lobby.me': '（自分）',
      'lobby.empty': '空席',
      'lobby.remove': '{name}を外す',
      'leave': '退出',

      'bot': 'ボット',
      'bot.low': '初級',
      'bot.mid': '中級',
      'bot.high': '上級',
      'bot.name': '{label}{n}',
      'noName': '名無し',

      'rule.stack': '爆撃・絨毯爆撃の重ね出し',
      'rule.stack.desc': '同じ攻撃カードを出せば、受ける枚数を次の人に回せる',
      'rule.drawUntil': '出せるまで引く',
      'rule.drawUntil.desc': '出せるカードが来るまで引き続ける',
      'rule.sevenZero': '7と0',
      'rule.sevenZero.desc': '7は選んだ人と手札を交換、0は全員が手札を隣に回す',
      'rule.jumpIn': '割り込み',
      'rule.jumpIn.desc': '一番上とまったく同じカードがあれば、自分の番でなくても出せる',
      'rule.multi': '同じ数字の複数出し',
      'rule.multi.desc': '同じ数字のカードを一度に何枚も出せる',
      'rule.challenge': '絨毯爆撃にチャレンジ',
      'rule.challenge.desc': '絨毯爆撃を受けたら、出せる色があったのではと疑える',
      'rule.turnTimer': '持ち時間20秒',
      'rule.turnTimer.desc': '20秒たつと自動で1枚引く',
      'rule.score': 'スコアモード（500点）',
      'rule.score.desc': '残ったカードの点数を集め、先に500点で優勝',

      'color.r': '赤',
      'color.y': '黄',
      'color.g': '緑',
      'color.b': '青',
      'bomb.r': 'ドカン',
      'bomb.y': '丸い爆弾',
      'bomb.g': '手榴弾',
      'bomb.b': 'ミサイル',
      'kind.skip': '気絶',
      'kind.rev': '反射',
      'kind.draw2': '爆撃',
      'kind.wild': '照準',
      'kind.wild4': '絨毯爆撃',
      'card.num': '{color}{value}',
      'card.action': '{color}の{name}',

      'game.turn': 'いまの番',
      'game.me': '自分',
      'game.judging': '割り込み判定中',
      'game.room': 'ルーム {code} · ',
      'game.cw': '時計回り',
      'game.ccw': '反時計回り',
      'game.sec': '{n}秒',
      'game.draw': '引く',
      'game.take': '受ける（{n}枚）',
      'game.keep': 'やめる（キープ）',
      'game.challenge': 'チャレンジ',
      'game.call': 'ラストヒット！',
      'game.catch': '捕まえた！',
      'game.notCalled': '未宣言',
      'game.proxy': 'ボットが代行中',
      'game.colorNow': 'いまの色：',
      'game.owe': '受けるカード{n}枚',
      'game.pickColor': 'どの色に照準を合わせる？',
      'game.swapHint': '手札を交換する相手を上から選んでください',
      'game.peek': '相手の手札',
      'game.peekOf': '{name}の手札',
      'game.throw': 'もう一度 → 出す',
      'cards': '{n}枚',

      'log.play': '{name}が{what}を出した',
      'log.playMany': '{card}ほか{n}枚',
      'log.jump': '{name}の割り込み！',
      'log.draw': '{name}が{n}枚引いた',
      'log.drawNone': '{name}が引けるカードがない',
      'log.attack': '{by} → {target} +{n} {kind}！',
      'log.skip': '{name}が気絶！',
      'log.reverse': '反射！逆回りになった',
      'log.color': '{name}が{color}に照準！',
      'log.swap': '{a} ⇄ {b} 手札交換',
      'log.rotate': '全員が手札を回した',
      'log.call': '{name}「ラストヒット！」',
      'log.caught': '{by}が{target}を捕まえた！+2',
      'log.challengeOk': 'チャレンジ成功！{name} +4',
      'log.challengeFail': 'チャレンジ失敗！{name} +6',
      'log.win': '{name}のラストヒット！勝利',

      'result.title': '結果',
      'result.matchWin': '{name}の勝ち！',
      'result.roundWin': '{name}のラストヒット！',
      'result.gained': '+{n}点',
      'result.left': '{count}枚 · {points}点',
      'result.totals': '累計スコア（500点で優勝）',
      'result.next': '次のラウンド',
      'result.again': 'もう1回',
      'result.toLobby': 'ロビーへ',
      'result.waiting': 'ホストが次を選んでいます',
      'pts': '{n}点',

      'err.not-found': 'ルームが見つかりません。番号を確認してください',
      'err.timeout': '接続できませんでした。少し待ってからもう一度お試しください',
      'err.no-internet': 'インターネット接続を確認してください',
      'err.full': 'ルームが満員です',
      'err.started': 'ゲームはもう始まっています',
      'err.closed': 'ホストとの接続が切れ、ルームが閉じました',
      'err.hostLeft': 'ホストが画面を離れたため、ルームが閉じました',
      'retry': 'もう一度',
      'ok': 'OK',
      'net.lost': '接続が切れました。再接続中…',
      'net.back': '再接続しました',
      'confirm.hostLeave': '退出するとルームが閉じます。退出しますか？',
      'confirm.guestLeave': 'ゲームを退出しますか？ 自分の席はボットが引き継ぎます',
      'rotate': '縦向きにしてください',
    },
  };

  // ---- 언어 정하기 ----

  function storageGet() {
    try { return root.localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function storageSet(value) {
    try { root.localStorage.setItem(KEY, value); } catch (e) { /* 저장 불가 */ }
  }

  function fromNavigator(nav) {
    const list = nav ? [].concat(nav.languages || [], nav.language || []) : [];
    const first = String(list[0] || '').toLowerCase();
    if (first.startsWith('ko')) return 'ko';
    if (first.startsWith('ja')) return 'ja';
    return 'en';
  }

  function detect() {
    let param = null;
    try { param = new URLSearchParams(root.location.search).get('lang'); } catch (e) { /* 주소 없음 */ }
    if (LANGS.includes(param)) {
      storageSet(param);
      return param;
    }
    const saved = storageGet();
    if (LANGS.includes(saved)) return saved;
    return fromNavigator(root.navigator);
  }

  let lang = typeof root.document === 'object' ? detect() : 'ko';
  const listeners = [];

  function fill(template, params) {
    return template.replace(/\{(\w+)\}/g, (all, k) => (params[k] === undefined ? all : String(params[k])));
  }

  function tr(language, key, params = {}) {
    const dict = DICT[language] || DICT.ko;
    const v = dict[key] !== undefined ? dict[key] : DICT.ko[key];
    if (v === undefined) return key;
    return typeof v === 'function' ? v(params) : fill(v, params);
  }
  const t = (key, params) => tr(lang, key, params);

  // index.html의 고정 문구: data-i18n(글자), data-i18n-ph(자리 표시), data-i18n-aria(화면 읽기 이름)
  function apply(doc = root.document) {
    if (!doc) return;
    doc.documentElement.lang = lang;
    doc.title = t('app.name');
    const desc = doc.querySelector('meta[name="description"]');
    if (desc) desc.setAttribute('content', t('app.desc'));
    doc.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    doc.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.setAttribute('placeholder', t(el.dataset.i18nPh)); });
    doc.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
    doc.documentElement.style.setProperty('--throw-label', JSON.stringify(t('game.throw')));
  }

  function setLang(next) {
    if (!LANGS.includes(next)) return;
    storageSet(next);
    if (next === lang) return;
    lang = next;
    apply();
    for (const fn of listeners) fn(lang);
  }

  if (typeof root.document === 'object') root.document.documentElement.lang = lang;

  const api = {
    LANGS, LANG_NAMES, DICT, KEY,
    t, tr, apply, setLang, detect, fromNavigator, josa, ro, hasBatchim,
    get lang() { return lang; },
    onChange: (fn) => listeners.push(fn),
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.I18n = api;
})(this);
