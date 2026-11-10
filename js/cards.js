// 카드 그림. 색마다 폭탄 모양이 다르다: 빨강 펑, 노랑 둥근 폭탄, 초록 수류탄, 파랑 미사일.
(function (root) {
  'use strict';

  const COLOR = {
    r: { name: '빨강', bomb: '펑', icon: 'i-boom' },
    y: { name: '노랑', bomb: '둥근 폭탄', icon: 'i-bomb' },
    g: { name: '초록', bomb: '수류탄', icon: 'i-grenade' },
    b: { name: '파랑', bomb: '미사일', icon: 'i-missile' },
  };
  const NAME = { skip: '기절', rev: '반사', draw2: '폭격', wild: '조준', wild4: '융단폭격' };
  const LABEL = { skip: '⊘', rev: '⇄', draw2: '+2', wild: '★', wild4: '+4' };
  const WILD_ICON = { wild: 'i-missile', wild4: 'i-boom' };

  const isWild = (c) => c.kind === 'wild' || c.kind === 'wild4';
  const label = (c) => (c.kind === 'num' ? String(c.value) : LABEL[c.kind]);
  const icon = (id, cls) => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;

  // 화면 읽기 프로그램과 기록 문구에 쓰는 이름. 예: "초록 7", "빨강 폭격", "융단폭격"
  function spoken(c) {
    if (isWild(c)) return NAME[c.kind];
    const color = COLOR[c.color].name;
    return c.kind === 'num' ? `${color} ${c.value}` : `${color} ${NAME[c.kind]}`;
  }

  function face(card, { big = false } = {}) {
    const el = document.createElement('div');
    const wild = isWild(card);
    el.className = `card ${wild ? 'c-k' : 'c-' + card.color}${big ? ' big' : ''}`;
    if (wild && card.color) el.classList.add('chosen-' + card.color);
    el.dataset.id = card.id;
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', spoken(card));
    const mark = wild ? WILD_ICON[card.kind] : COLOR[card.color].icon;
    el.innerHTML = `<span class="tl">${label(card)}</span>`
      + (wild ? '' : icon(mark, 'ic'))
      + icon(mark, 'wm')
      + `<div class="mid">${label(card)}</div>`
      + (card.kind === 'num' ? '' : `<span class="nm">${NAME[card.kind]}</span>`);
    return el;
  }

  function back({ big = false } = {}) {
    const el = document.createElement('div');
    el.className = `card back${big ? ' big' : ''}`;
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = icon('i-bomb', 'wm');
    return el;
  }

  root.Cards = { COLOR, NAME, LABEL, face, back, label, spoken, icon, isWild };
})(this);
