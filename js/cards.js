// 카드 그림. 색마다 폭탄 모양이 다르다: 빨강 펑, 노랑 둥근 폭탄, 초록 수류탄, 파랑 미사일.
(function (root) {
  'use strict';

  const { I18n } = root;
  const t = (key, params) => I18n.t(key, params);

  // 이름(name)과 폭탄 이름(bomb)은 읽을 때마다 지금 언어로 바뀐다.
  const COLOR = {};
  for (const [id, icon] of [['r', 'i-boom'], ['y', 'i-bomb'], ['g', 'i-grenade'], ['b', 'i-missile']]) {
    COLOR[id] = {
      icon,
      get name() { return t('color.' + id); },
      get bomb() { return t('bomb.' + id); },
    };
  }
  const NAME = {};
  for (const kind of ['skip', 'rev', 'draw2', 'wild', 'wild4']) {
    Object.defineProperty(NAME, kind, { enumerable: true, get: () => t('kind.' + kind) });
  }
  const LABEL = { skip: '⊘', rev: '⇄', draw2: '+2', wild: '★', wild4: '+4' };
  const WILD_ICON = { wild: 'i-missile', wild4: 'i-boom' };

  const isWild = (c) => c.kind === 'wild' || c.kind === 'wild4';
  const label = (c) => (c.kind === 'num' ? String(c.value) : LABEL[c.kind]);
  const icon = (id, cls) => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;

  // 화면 읽기 프로그램과 기록 문구에 쓰는 이름. 예: "초록 7", "빨강 폭격", "융단폭격"
  function spoken(c) {
    if (isWild(c)) return NAME[c.kind];
    const color = COLOR[c.color].name;
    return c.kind === 'num' ? t('card.num', { color, value: c.value }) : t('card.action', { color, name: NAME[c.kind] });
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
