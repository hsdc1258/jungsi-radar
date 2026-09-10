// 화면. 데이터(assets/data.js)와 엔진(assets/engine.js)을 받아 탭 하나를 통째로 그린다.
// 컴포넌트는 Seed Design recipe 클래스(.seed-*)만 쓴다 — docs/FRAME.md 밖의 패턴을 만들지 않는다.
(() => {
  'use strict';

  const DATA = globalThis.IPSI_DATA;
  const ENGINE = globalThis.IPSI_ENGINE;
  const EXAM_YEAR = '2026';

  // ---------------------------------------------------------------- 저장소
  const STORE = {
    scores: 'jr.scores', filters: 'jr.filters', favorites: 'jr.favorites',
    favUniversities: 'jr.favUniversities', theme: 'jr.theme', view: 'jr.view',
  };
  const readStore = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (error) { return fallback; }
  };
  const writeStore = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (error) { /* 저장소가 막혀 있어도 화면은 돈다. */ }
  };

  // ---------------------------------------------------------------- 상태
  const EMPTY_SCORES = {
    mode: 'pct',
    korElective: '언어와매체', kor: '',
    mathElective: '미적분', math: '',
    eng: '2', hist: '1',
    inq1Subject: '생활과윤리', inq1: '',
    inq2Subject: '사회문화', inq2: '',
    gpa: '',
  };
  const state = {
    view: readStore(STORE.view, 'scores'),
    scores: { ...EMPTY_SCORES, ...readStore(STORE.scores, {}) },
    // lines·universities 는 진단 화면의 체크 목록이다(라벨·아이디 배열). 빈 배열이면 전체.
    filters: {
      track: '전체', band: '전체', query: '', favOnly: false, favUniOnly: false, sort: 'cut',
      noArts: true, noDream: true, noWomen: true, limit: 8, lines: [], universities: [],
      ...readStore(STORE.filters, {}),
    },
    favorites: new Set(readStore(STORE.favorites, [])),
    // 관심 대학은 관심 학과와 따로 저장한다 — 대학을 담아도 학과 별표는 그대로다.
    favUniversities: new Set(readStore(STORE.favUniversities, [])),
    target: { university: '', dept: '' },
    rulesUniversity: 'snu',
    copied: false,
    // 정보 탭으로 보낼 때 열어 둘 절(ⓘ 버튼이 넣는다). 저장하지 않는다.
    aboutFocus: null,
    // 진단 필터에서 지금 펼쳐 둔 체크 목록('line' | 'university' | null).
    filterPanel: null,
  };

  for (const field of ['lines', 'universities']) {
    if (!Array.isArray(state.filters[field])) state.filters[field] = [];
  }

  // ---------------------------------------------------------------- 유틸
  const el = (tag, attrs = {}, children = []) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'html') node.innerHTML = value;
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else if (value === true) node.setAttribute(key, '');
      else node.setAttribute(key, String(value));
    }
    for (const child of [].concat(children).flat(Infinity)) {
      if (child === null || child === undefined || child === false) continue;
      node.append(typeof child === 'string' || typeof child === 'number' ? String(child) : child);
    }
    return node;
  };
  // 음수는 하이픈이 아니라 진짜 빼기 기호(−)로 적는다 — 숫자가 줄지어 나오는 화면이라 폭이 흔들리면 안 된다.
  const MINUS = '\u2212';
  const fmt = (value, digits = 1) => (typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits).replace('-', MINUS) : '—');
  // 차이를 나타내는 숫자에는 항상 부호를 붙인다.
  const signed = (value, digits = 1) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
    const sign = value > 0 ? '+' : value < 0 ? MINUS : '';
    return `${sign}${Math.abs(value).toFixed(digits)}`;
  };
  const muted = (text) => el('p', { class: 'jr-muted', text });
  // 표·문장 속 음수도 같은 빼기 기호로 (원자료는 하이픈을 쓴다).
  const numText = (value) => (value === null || value === undefined || value === '' ? '—' : String(value).replace(/^-/u, MINUS));
  const prose = (text) => String(text || '').replace(/(^|[\s(])-(?=[\d.])/gu, `$1${MINUS}`);

  const BAND_TONE = { safe: 'positive', fit: 'brand', reach: 'neutral', stretch: 'warning', risky: 'critical', blocked: 'critical', hold: 'neutral', mismatch: 'neutral' };
  // 지원 자격이 막힌 모집단위(과탐 필수·미적분 필수 등)는 점수와 무관하게 '불가'다.
  const BLOCKED_BAND = Object.freeze({ key: 'blocked', label: '불가' });
  // 판정은 엔진이 낸 값 하나만 쓴다(ENGINE.VERDICT_BANDS). 화면이 따로 계산하지 않는다.
  const bandOf = (result) => (result?.status === 'blocked' ? BLOCKED_BAND
    : result?.status === 'basis-mismatch' ? ENGINE.MISMATCH_BAND
    : result?.band || null);
  // 목록에 보여 주는 순서: 안정 → 적정 → 소신 → 상향 → 위험 → 불가.
  // 판정별 보기의 순서. 보류·기준 불일치·불가는 판정이 아니라 상태라 맨 아래로 내린다.
  const BAND_ORDER = ['safe', 'fit', 'reach', 'stretch', 'risky', 'hold', 'mismatch', 'blocked'];
  // '높은 순' 정렬에서 앞쪽에 세우는 판정들. 머리글은 쓰지 않고 순서로만 구분한다.
  const REACHABLE_BANDS = Object.freeze(['safe', 'fit', 'reach']);
  const SORTS = Object.freeze([['cut', '높은 순'], ['band', '판정별']]);
  const badge = (label, tone = 'neutral') => el('span', {
    class: `seed-badge__root seed-badge__root--size_medium seed-badge__root--variant_weak seed-badge__root--tone_${tone}-variant_weak`,
  }, [el('span', { class: 'seed-badge__label', text: label })]);

  const button = (label, { variant = 'neutralWeak', size = 'medium', onclick, attrs = {} } = {}) => el('button', {
    type: 'button',
    class: `seed-action-button seed-action-button--variant_${variant} seed-action-button--size_${size} seed-action-button--layout_withText seed-action-button--size_${size}-layout_withText`,
    onclick,
    ...attrs,
  }, [label]);

  const select = (options, value, onchange, label, id) => {
    const node = el('select', {
      class: 'seed-select-trigger__root seed-select-trigger__root--size_medium jr-select',
      'aria-label': label,
      id,
      onchange: (event) => onchange(event.target.value),
    });
    for (const option of options) {
      const [optionValue, optionLabel] = Array.isArray(option) ? option : [option, option];
      node.append(el('option', { value: optionValue, selected: String(optionValue) === String(value) }, [optionLabel]));
    }
    return node;
  };

  // 묶음이 있는 셀렉트. 네이티브 <optgroup>이 묶음 이름을 맡는다.
  const groupedSelect = (groups, value, onchange, label, id) => {
    const node = el('select', {
      class: 'seed-select-trigger__root seed-select-trigger__root--size_medium jr-select',
      'aria-label': label,
      id,
      onchange: (event) => onchange(event.target.value),
    });
    for (const group of groups) {
      if (!group.options || group.options.length === 0) continue;
      const holder = el('optgroup', { label: group.label });
      for (const [optionValue, optionLabel] of group.options) {
        holder.append(el('option', { value: optionValue, selected: String(optionValue) === String(value) }, [optionLabel]));
      }
      node.append(holder);
    }
    return node;
  };

  // Seed text-input 은 겉 상자(__root)가 테두리를, 안쪽 <input>(__value)이 글자를 맡는다.
  const textInput = (attrs, wrapperClass) => el('div', {
    class: `seed-text-input__root seed-text-input__root--variant_outline seed-text-input__root--variant_outline-size_medium ${wrapperClass}`,
  }, [el('input', {
    class: 'seed-text-input__value seed-text-input__value--variant_outline-size_medium',
    ...attrs,
  })]);

  const numberInput = (value, onchange, { label, id, min = 0, max = 100, step = 1, placeholder = '' }) => {
    // 범위를 벗어난 값은 테두리로 알린다 (계산은 어차피 범위 안으로 잘라 쓴다).
    const mark = (raw) => {
      const number = Number(raw);
      const bad = raw !== '' && (!Number.isFinite(number) || number < min || number > max);
      if (bad) { root.setAttribute('data-invalid', ''); input.setAttribute('aria-invalid', 'true'); }
      else { root.removeAttribute('data-invalid'); input.removeAttribute('aria-invalid'); }
    };
    const input = el('input', {
      class: 'seed-text-input__value seed-text-input__value--variant_outline-size_medium',
      type: 'number', value, min, max, step, placeholder, inputmode: 'decimal', id,
      'aria-label': label,
      oninput: (event) => { mark(event.target.value); onchange(event.target.value); },
    });
    const root = el('div', {
      class: 'seed-text-input__root seed-text-input__root--variant_outline seed-text-input__root--variant_outline-size_medium jr-number',
    }, [input]);
    mark(value);
    return root;
  };

  const banner = (text, variant = 'neutralWeak') => el('div', {
    class: `seed-inline-banner__root seed-inline-banner__root--variant_${variant}`,
  }, [el('div', { class: 'seed-inline-banner__content' }, [
    el('p', { class: `seed-inline-banner__description seed-inline-banner__description--variant_${variant}`, text }),
  ])]);

  // 그룹 머리글. iOS 그룹 인셋 리스트의 작은 회색 머리글이다 (FRAME §8.2).
  const listHeader = (text, suffix) => el('div', {
    class: 'seed-list-header seed-list-header--variant_mediumWeak jr-group-head',
  }, [el('span', { text }), suffix ? el('span', { class: 'jr-group-count', text: suffix }) : null]);

  // 숫자 스탯 줄. 라벨은 작은 회색, 값은 굵게 — 화면 위의 문장을 이것 하나로 대신한다 (FRAME §8.1).
  const stats = (items) => el('div', { class: 'jr-stats' }, items.filter(Boolean).map(([label, value]) => el('div', { class: 'jr-stat' }, [
    el('span', { class: 'jr-stat-label', text: label }),
    el('span', { class: 'jr-stat-value num', text: value }),
  ])));

  // 정보 탭의 해당 절로 보내는 ⓘ 하나. 화면마다 오른쪽 위에 이것 말고 다른 안내는 두지 않는다.
  const infoButton = (anchor) => el('button', {
    type: 'button',
    class: 'seed-action-button seed-action-button--variant_ghost seed-action-button--size_medium seed-action-button--layout_withText seed-action-button--size_medium-layout_withText jr-info',
    'aria-label': '설명 보기',
    onclick: () => { state.aboutFocus = anchor; go('about'); },
  }, ['i']);

  // 화면 머리: 왼쪽은 값(스탯·셀렉트), 오른쪽은 ⓘ 하나.
  const screenHead = (left, anchor) => el('div', { class: 'jr-screen-head' }, [
    el('div', { class: 'jr-screen-head-main' }, [].concat(left).filter(Boolean)),
    infoButton(anchor),
  ]);

  // 체크 아이콘(Seed checkmark ghost recipe). 켜지면 브랜드 색, 꺼지면 자리만 지킨다.
  // <svg>는 createElement 로 만들면 그려지지 않는다 — 마크업 문자열로 넣어 진짜 SVG 노드가 되게 한다.
  const CHECK_CLASS = 'seed-checkmark__icon seed-checkmark__icon--variant_ghost'
    + ' seed-checkmark__icon--size_medium-variant_ghost seed-checkmark__icon--variant_ghost-tone_brand jr-check';
  const checkIcon = (on) => el('span', {
    class: 'jr-check-slot',
    html: `<svg class="${CHECK_CLASS}"${on ? ' data-checked' : ''} viewBox="0 0 24 24" fill="none" stroke="currentColor"`
      + ' stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + '<path d="M4 12.5 9.5 18 20 6.5"></path></svg>',
  });
  // 체크 목록의 한 줄. 눌러서 켜고 끈다.
  const checkRow = (label, on, onclick, detail) => listItem({
    title: label, detail, onclick, suffix: checkIcon(on), attrs: { role: 'checkbox', 'aria-checked': String(on) },
  });

  // list-item 한 줄. suffix에는 뱃지·버튼이 들어간다.
  // stack: 부제를 뱃지 아래 **행 전체 폭**으로 깐다. 값이 넷을 넘는 진단 목록에서
  // 375px 한 줄에 들어가게 하려는 것이다 — 부제를 줄이지 않고 자리를 넓힌다 (FRAME §8.1).
  const listItem = ({ title, detail, suffix, onclick, prefix, attrs = {}, stack = false }) => {
    const tag = onclick ? 'button' : 'div';
    const detailNode = detail ? el('span', { class: 'seed-list-item__detail', text: detail }) : null;
    const head = [
      prefix ? el('span', { class: 'seed-list-item__prefix' }, [prefix]) : null,
      el('span', { class: 'seed-list-item__content' }, [
        el('span', { class: 'seed-list-item__title', text: title }),
        stack ? null : detailNode,
      ].filter(Boolean)),
      suffix ? el('span', { class: 'seed-list-item__suffix' }, [].concat(suffix)) : null,
    ].filter(Boolean);
    const node = el(tag, {
      class: `seed-list-item__root jr-row${stack ? ' jr-row--stack' : ''}`,
      type: onclick ? 'button' : null,
      onclick,
      ...attrs,
    }, stack ? [el('span', { class: 'jr-row-head' }, head), detailNode].filter(Boolean) : head);
    return node;
  };

  // 접이식 블록. 네이티브 <details>가 열고 닫기와 키보드 조작을 맡고, 겉모습만 Seed 클래스가 만든다.
  const accordion = (title, body, { open = false, description } = {}) => el('details', {
    class: 'seed-accordion__item seed-accordion__item--variant_separated jr-accordion',
    open,
  }, [
    el('summary', { class: 'seed-accordion__trigger seed-accordion__trigger--size_medium seed-accordion__trigger--variant_separated' }, [
      el('span', { class: 'seed-accordion__body' }, [
        el('span', { class: 'seed-accordion__title seed-accordion__title--size_medium', text: title }),
        description ? el('span', { class: 'seed-accordion__description seed-accordion__description--size_medium', text: description }) : null,
      ]),
      el('span', { class: 'seed-accordion__suffixIcon seed-accordion__suffixIcon--size_medium', 'aria-hidden': 'true', text: '⌄' }),
    ]),
    el('div', { class: 'jr-accordion-body' }, [].concat(body).flat(Infinity)),
  ]);

  const section = (children) => el('div', { class: 'jr-section' }, [].concat(children).flat(Infinity));
  const table = (head, rows) => el('div', { class: 'jr-table-wrap' }, [
    el('table', { class: 'jr-table' }, [
      el('thead', {}, [el('tr', {}, head.map((cell) => el('th', { scope: 'col', text: cell })))]),
      el('tbody', {}, rows.map((row) => el('tr', {}, row.map((cell, index) => el(index === 0 ? 'th' : 'td', index === 0 ? { scope: 'row' } : {}, [
        typeof cell === 'string' || typeof cell === 'number' ? String(cell) : cell,
      ]))))),
    ]),
  ]);

  // ---------------------------------------------------------------- 도메인 헬퍼
  const universityById = new Map(DATA.universities.map((university) => [university.id, university]));
  // 어디가 원자료의 모집단위 이름은 괄호가 앞에 붙거나 붙여 쓴 것이 섞여 있다. 표시만 다듬는다(값은 원문 그대로).
  const deptLabel = (name) => String(name || '')
    .trim()
    .replace(/^\(([^)]+)\)\s*(.+)$/u, '$2 ($1)')
    .replace(/(\S)([([])/gu, '$1 $2')
    .replace(/\s+/gu, ' ');
  const deptKey = (universityId, deptName) => `${universityId}::${deptName}`;
  // 컷의 통계 정의마다 **내 성적을 같은 정의로** 만드는 산식. 정보 탭의 '비교 기준' 표가 그대로 적는다.
  const SCALE_FORMULA = Object.freeze({
    ksi: '(국어 + 수학 + 탐구2평균) / 3',
    ksi1: '(국어 + 수학 + 탐구 상위1) / 3',
    'kor-inq': '(국어 + 탐구2평균) / 2',
    top2: '국어·수학·탐구2평균 중 상위 2개 평균',
    score: '계산 불가',
  });
  const TRACKS = ['전체', '인문', '자연', '의약', '자유전공', '예체능'];
  const BANDS = ['전체', '안정', '적정', '소신', '상향', '위험', '불가', '보류', '기준 불일치'];

  // 등급 → 백분위 환산표. 상대평가 등급 구간의 정확한 중앙값이다 (1등급 96~100 → 98.0 …).
  // 엔진의 GRADE_FLOORS·GRADE_MIDPOINTS를 그대로 읽어 화면과 계산이 절대 어긋나지 않게 한다.
  const GRADE_TABLE = ENGINE.GRADE_MIDPOINTS.map((mid, index) => ({
    grade: index + 1,
    low: ENGINE.GRADE_FLOORS[index],
    high: index === 0 ? 100 : ENGINE.GRADE_FLOORS[index - 1],
    mid,
  }));
  // 목록에서 걸러 내는 세 가지. 토글은 기본으로 켜져 있고 localStorage에 남는다.
  //   예체능 제외    — 실기 비중이 커서 수능 컷만으로는 판정이 어려운 모집단위.
  //   말도 안되는거 제외 — 의·치·한·약·수의 최상위 모집단위와 서울대·연세대·고려대 전체.
  //   여대 제외      — 여자대학교(이화여대·숙명여대). 값은 생성물에 그대로 있고 화면만 감춘다.
  // 관심 목록·공유 링크로 직접 연 모집단위는 숨기지 않는다(아래 hiddenBy 호출부에서 예외).
  const DREAM_UNIVERSITIES = new Set(['snu', 'yonsei', 'korea']);
  // 간호·물리치료·보건 등은 빼지 않는다 — 의·치·한·약·수의만 본다.
  const DREAM_DEPT = /의예|의학과|치의예|치의학|한의예|한의학|약학|수의예|수의학/u;
  // 실기가 있는 예체능만 감춘다 — 실기 없이 수능 100%로 뽑는 예체능(dept.practical === false)은
  // 컷을 그대로 견줄 수 있어 목록에 남는다 (FRAME §9.4, scripts/build-data.mjs PRACTICAL_EXEMPT).
  const isArtsDept = (dept) => dept?.track === '예체능' && dept?.practical === true;
  // 이상치. 펑크·오류 의심만 뱃지를 단다 — 실기·정상은 정보 탭 표에만 남는다.
  const ANOMALY_LABEL = { punk: '펑크 의심', error: '오류 의심', practical: '실기', normal: '정상' };
  const ANOMALY_FLAGGED = new Set(['punk', 'error']);
  const anomalyOf = (dept) => (dept?.anomaly && ANOMALY_LABEL[dept.anomaly.kind] ? dept.anomaly : null);
  const isFlaggedAnomaly = (dept) => Boolean(anomalyOf(dept) && ANOMALY_FLAGGED.has(dept.anomaly.kind));
  const isDreamDept = (universityId, dept) => DREAM_UNIVERSITIES.has(universityId) || DREAM_DEPT.test(String(dept?.name || ''));
  const womenOnlyIds = new Set(DATA.universities.filter((row) => row.womenOnly).map((row) => row.id));
  function hiddenBy(universityId, dept) {
    if (state.filters.noArts && isArtsDept(dept)) return 'arts';
    if (state.filters.noDream && isDreamDept(universityId, dept)) return 'dream';
    if (state.filters.noWomen && womenOnlyIds.has(universityId)) return 'women';
    return null;
  }
  // 관심 학과로 담아 두었거나 지금 목표로 열어 둔 모집단위는 숨김 규칙을 비켜 간다.
  const pinned = (universityId, deptName) => state.favorites.has(deptKey(universityId, deptName))
    || (state.target.university === universityId && state.target.dept === deptName);
  const hiddenNow = (universityId, dept) => (pinned(universityId, dept.name) ? null : hiddenBy(universityId, dept));

  const profile = () => ENGINE.normalizeProfile(state.scores, DATA.scales, DATA.std);
  const profileReady = () => ENGINE.profileComplete(profile());

  // 대학이 실제로 반영하는 지표. 생성물이 rules[id].basisSummary 로 이미 짧은 라벨을 갖고 있다.
  const basisOf = (universityId) => DATA.rules?.[universityId]?.basisSummary || null;
  const basisShort = (universityId) => basisOf(universityId)?.short || '미확인';
  // 표점(또는 등급 배점) 기준 대학은 우리가 백분위로 바꿔 비교한다 — 뱃지 '근사'가 그 사실을 말한다.
  const isApproxBasis = (universityId) => Boolean(basisOf(universityId)?.approxPercentile);

  // 컷 옆 숫자는 **과거에 관측된 연도 폭**이다. 미래 합격선의 신뢰구간이 아니므로 ±를 쓰지 않는다.
  const spreadText = (result) => {
    const cut = result.cut;
    if (!cut) return '';
    const base = `컷 ${fmt(cut.value, 1)}`;
    const range = result.reference?.range;
    if (range && range.years?.length > 1 && range.max > range.min) return `${base} · 관측 ${fmt(range.min, 1)}~${fmt(range.max, 1)}`;
    return base;
  };

  // 등급 입력의 가정값과 구간. 부제 한 줄에 들어가도록 구간은 괄호로 붙인다 (FRAME §8.1).
  const mineWithRange = (result) => (result.bounds
    ? `가정 ${fmt(result.mine, 1)} (${fmt(result.bounds.min, 1)}~${fmt(result.bounds.max, 1)})`
    : `가정 ${fmt(result.mine, 1)}`);

  const saveScores = () => writeStore(STORE.scores, state.scores);
  // 더 보기로 늘린 개수(limit)는 저장하지 않는다 — 새로고침했더니 목록이 수백 줄인 일을 막는다.
  const saveFilters = () => writeStore(STORE.filters, { ...state.filters, limit: undefined });
  const saveFavorites = () => writeStore(STORE.favorites, [...state.favorites]);
  const saveFavUniversities = () => writeStore(STORE.favUniversities, [...state.favUniversities]);
  const isFavUniversity = (universityId) => state.favUniversities.has(universityId);
  function toggleFavUniversity(universityId) {
    if (state.favUniversities.has(universityId)) state.favUniversities.delete(universityId);
    else state.favUniversities.add(universityId);
    saveFavUniversities();
    diagnoseCache.key = null;
  }

  // ---------------------------------------------------------------- URL 공유
  const QUERY_KEYS = {
    k: 'kor', m: 'math', e: 'eng', h: 'hist', i1: 'inq1', i2: 'inq2',
    ke: 'korElective', me: 'mathElective', s1: 'inq1Subject', s2: 'inq2Subject', g: 'gpa', md: 'mode',
  };
  function readQuery() {
    const params = new URLSearchParams(location.search);
    let touched = false;
    for (const [key, field] of Object.entries(QUERY_KEYS)) {
      if (!params.has(key)) continue;
      const value = params.get(key);
      if (value === '') continue;
      state.scores[field] = value;
      touched = true;
    }
    if (touched) {
      state.scores.mode = state.scores.mode === 'grade' ? 'grade' : 'pct';
      saveScores();
      state.view = 'diagnose';
      // 주소에 성적이 남아 있으면 새로고침할 때마다 내가 고친 값을 덮어쓴다. 한 번 읽고 지운다.
      try { globalThis.history?.replaceState?.(null, '', location.pathname); } catch (error) { /* 무시 */ }
    }
  }
  function shareUrl() {
    const params = new URLSearchParams();
    for (const [key, field] of Object.entries(QUERY_KEYS)) {
      const value = state.scores[field];
      if (value !== '' && value !== null && value !== undefined) params.set(key, String(value));
    }
    return `${location.origin}${location.pathname}?${params.toString()}`;
  }

  // ---------------------------------------------------------------- 성적 화면
  const KOR_ELECTIVES = ENGINE.KOR_ELECTIVES;
  const MATH_ELECTIVES = ENGINE.MATH_ELECTIVES;
  const INQ_SUBJECTS = [...ENGINE.SOCIAL_SUBJECTS, ...ENGINE.SCIENCE_SUBJECTS];
  const GRADES = [['', '미입력'], ...Array.from({ length: 9 }, (unused, index) => [String(index + 1), `${index + 1}등급`])];

  // 한 줄 = 라벨 + 컨트롤. 라벨은 진짜 <label>이라 눌러도 입력으로 초점이 간다.
  function inputRow(label, controls, hint, forId) {
    return el('div', { class: 'jr-input-row' }, [
      el('label', { class: 'jr-input-label', for: forId }, [label, hint ? el('span', { class: 'jr-muted', text: ` ${hint}` }) : null]),
      el('span', { class: 'jr-input-controls' }, [].concat(controls)),
    ]);
  }

  function setScore(field, value) {
    state.scores[field] = value;
    saveScores();
    liveRefresh();
  }
  // 성적 화면이 열려 있는 동안 요약과 '진단 보기' 버튼만 즉시 고쳐 그린다.
  // 화면 전체를 다시 그리면 입력하던 칸의 초점이 날아간다.
  let liveRefresh = () => {};

  // 입력 기준을 바꾸면 이미 적은 값도 같이 바꿔 준다 (백분위 96 ↔ 1등급).
  // 등급으로 갔다가 그대로 돌아오면 원래 백분위를 되살린다 — 96이 98로 바뀌어 있으면 안 된다.
  const modeBackup = { pct: null, grade: null, std: null };
  // 영역 키 (도수분포표의 이름). 국어·수학의 백분위는 선택과목이 아니라 영역 전체에서 매겨진다.
  const stdKeyFor = (field) => (field === 'kor' ? '국어' : field === 'math' ? '수학' : `탐구-${state.scores[`${field}Subject`]}`);
  // 백분위 → 표준점수. 도수분포에서 그 백분위에 가장 가까운 점을 되찾는다(같은 백분위가 여럿이면 낮은 쪽).
  function stdFromPercentile(field, pct) {
    const subject = DATA.std?.subjects?.[stdKeyFor(field)];
    const rows = subject?.rows || [];
    if (rows.length === 0 || !Number.isFinite(pct)) return null;
    let best = null;
    for (const [std, , rowPct] of rows) {
      const distance = Math.abs(rowPct - pct);
      if (best === null || distance < best.distance || (distance === best.distance && std < best.std)) {
        best = { std, distance };
      }
    }
    return best ? best.std : null;
  }
  function percentileOfScore(field, value) {
    const read = ENGINE.percentileFromStd(stdKeyFor(field), value, DATA.std);
    return read ? read.pct : null;
  }
  function convertScores(from, to) {
    if (from === to) return;
    const fields = ['kor', 'math', 'inq1', 'inq2'];
    const before = {};
    for (const field of fields) before[field] = state.scores[field];
    const saved = modeBackup[to];
    // 어느 기준으로 가든 백분위를 가운데 두고 옮긴다.
    for (const field of fields) {
      const raw = before[field];
      const number = Number(raw);
      modeBackup[from] = before;
      if (raw === '' || raw === null || raw === undefined || !Number.isFinite(number)) { state.scores[field] = ''; continue; }
      const pct = from === 'grade' ? ENGINE.percentileFromGrade(number)
        : from === 'std' ? percentileOfScore(field, number)
          : Math.min(100, Math.max(0, number));
      if (pct === null) { state.scores[field] = ''; continue; }
      if (to === 'grade') { state.scores[field] = String(ENGINE.gradeFromPercentile(pct)); continue; }
      if (to === 'std') {
        // 표준점수로 갔다가 그대로 돌아왔다 다시 오면 원래 표준점수를 되살린다.
        const back = Number(saved?.[field]);
        const untouched = Number.isFinite(back) && percentileOfScore(field, back) === pct;
        const converted = untouched ? back : stdFromPercentile(field, pct);
        state.scores[field] = converted === null ? '' : String(converted);
        continue;
      }
      const back = Number(saved?.[field]);
      const untouched = Number.isFinite(back)
        && (from === 'grade' ? String(ENGINE.gradeFromPercentile(back)) === String(Math.round(number)) : back === pct);
      state.scores[field] = untouched ? String(saved[field]) : String(pct);
    }
    modeBackup[from] = before;
  }

  // 클립보드가 막혀 있을 수 있다(권한 거부·iframe). 그때는 옛 방식으로, 그것도 안 되면 링크를 보여 준다.
  async function copyText(text) {
    try {
      if (navigator?.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
    } catch (error) { /* 아래 폴백으로 간다 */ }
    try {
      if (!document.body || typeof document.execCommand !== 'function') return false;
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select?.();
      const done = document.execCommand('copy');
      area.remove?.();
      return Boolean(done);
    } catch (error) { return false; }
  }

  const MODES = [['pct', '백분위'], ['grade', '등급'], ['std', '표준점수']];

  function renderScores() {
    const isGrade = state.scores.mode === 'grade';
    const isStd = state.scores.mode === 'std';
    const unit = isGrade ? '등급' : isStd ? '표준점수' : '백분위';
    const modeIndex = Math.max(0, MODES.findIndex(([value]) => value === state.scores.mode));
    const modeControl = el('div', {
      class: 'seed-segmented-control__root jr-segmented',
      role: 'radiogroup',
      'aria-label': '입력 기준',
      style: `--segment-count:${MODES.length};--segment-index:${modeIndex}`,
    }, [
      el('span', { class: 'seed-segmented-control__indicator', 'aria-hidden': 'true' }),
      ...MODES.map(([value, label]) => el('button', {
        type: 'button', role: 'radio', 'aria-checked': String(state.scores.mode === value),
        class: 'seed-segmented-control__item',
        'data-checked': state.scores.mode === value ? '' : null,
        onclick: () => {
          if (state.scores.mode === value) return;
          convertScores(state.scores.mode, value);
          setScore('mode', value);
          render();
        },
      }, [label])),
    ]);

    // 표준점수는 영역마다 최고점이 다르다 — 그 해 실제 만점 표준점수를 범위로 쓴다.
    const stdMax = (field) => {
      const key = field === 'kor' ? '국어' : field === 'math' ? '수학' : `탐구-${state.scores[`${field}Subject`]}`;
      return DATA.std?.subjects?.[key]?.maxStd ?? (field === 'kor' || field === 'math' ? 150 : 80);
    };
    const numberFor = (field, label) => numberInput(state.scores[field], (value) => setScore(field, value), {
      id: `jr-${field}`,
      label: `${label} ${unit}`,
      min: isGrade ? 1 : 0,
      max: isGrade ? 9 : isStd ? stdMax(field) : 100,
      step: isGrade ? 1 : isStd ? 1 : 0.5,
      placeholder: unit,
    });

    // 등급·표준점수로 넣으면 백분위 환산값을 입력 옆 작은 회색 값으로만 적는다 (FRAME §8.1).
    const notes = new Map();
    const noteFor = (field) => {
      const node = el('span', { class: 'jr-input-note num' });
      notes.set(field, node);
      return node;
    };
    const noteText = (field) => {
      const raw = String(state.scores[field] ?? '').trim();
      const number = Number(raw);
      if (raw === '' || !Number.isFinite(number)) return '';
      if (isGrade) return fmt(ENGINE.percentileFromGrade(number), 1);
      if (isStd) {
        const pct = percentileOfScore(field, number);
        return pct === null ? '' : fmt(pct, 0);
      }
      return '';
    };
    const scoreRow = (label, field, elective, electiveLabel) => inputRow(label, [
      elective ? select(elective, state.scores[`${field}Elective`] ?? state.scores[`${field}Subject`],
        (value) => setScore(electiveLabel, value), `${label} 선택과목`) : null,
      isGrade || isStd ? noteFor(field) : null,
      numberFor(field, label),
    ].filter(Boolean), null, `jr-${field}`);

    const rows = section([
      listHeader('성적', unit),
      el('div', { class: 'jr-list jr-inputs' }, [
        scoreRow('국어', 'kor', KOR_ELECTIVES, 'korElective'),
        scoreRow('수학', 'math', MATH_ELECTIVES, 'mathElective'),
        inputRow('영어', [select(GRADES, state.scores.eng, (value) => setScore('eng', value), '영어 등급', 'jr-eng')], null, 'jr-eng'),
        inputRow('한국사', [select(GRADES, state.scores.hist, (value) => setScore('hist', value), '한국사 등급', 'jr-hist')], null, 'jr-hist'),
        scoreRow('탐구 1', 'inq1', INQ_SUBJECTS, 'inq1Subject'),
        scoreRow('탐구 2', 'inq2', INQ_SUBJECTS, 'inq2Subject'),
      ]),
    ]);

    const gpa = section([
      listHeader('내신'),
      el('div', { class: 'jr-list jr-inputs' }, [
        inputRow('교과 평균', [numberInput(state.scores.gpa, (value) => setScore('gpa', value), {
          id: 'jr-gpa', label: '내신 등급', min: 1, max: 9, step: 0.01, placeholder: '등급',
        })], null, 'jr-gpa'),
      ]),
    ]);

    const headStats = stats([['국·수·탐 평균', '—']]);
    const actionButton = button('진단 보기', {
      variant: 'brandSolid', size: 'large',
      onclick: () => { if (profileReady()) go('diagnose'); },
    });
    // 숫자를 고칠 때마다 스탯·환산값·버튼만 다시 그린다(화면을 통째로 그리면 초점이 날아간다).
    liveRefresh = () => {
      const current = profile();
      const average = ENGINE.simpleAverage(current);
      const value = headStats.querySelector?.('.jr-stat-value');
      if (value) value.textContent = fmt(average, 2);
      for (const [field, node] of notes) node.textContent = noteText(field);
      if (ENGINE.profileComplete(current)) {
        actionButton.removeAttribute('disabled');
        actionButton.setAttribute('aria-disabled', 'false');
      } else {
        actionButton.setAttribute('disabled', '');
        actionButton.setAttribute('aria-disabled', 'true');
      }
    };

    const share = el('div', { class: 'jr-actions' }, [
      button(state.copied === true ? '복사함' : '링크 복사', {
        variant: 'neutralOutline',
        onclick: async () => {
          state.copied = (await copyText(shareUrl())) ? true : 'failed';
          render();
          setTimeout(() => {
            if (state.copied === true) { state.copied = false; if (state.view === 'scores') render(); }
          }, 4000);
        },
      }),
      button('지우기', {
        variant: 'ghost',
        onclick: () => { state.scores = { ...EMPTY_SCORES }; saveScores(); render(); },
      }),
    ]);

    // 복사가 막힌 환경에서는 링크를 직접 골라 갈 수 있게 띄운다.
    const fallback = state.copied === 'failed'
      ? section([
        banner('브라우저가 복사를 막았습니다', 'criticalWeak'),
        textInput({ type: 'text', value: shareUrl(), readonly: true, 'aria-label': '성적 공유 주소', onclick: (event) => event.target.select?.() }, 'jr-search'),
      ])
      : null;

    const action = el('div', { class: 'jr-sticky-action' }, [actionButton]);

    liveRefresh();
    const stdBlocks = isStd ? [renderStdReadout(), renderStdScoreList()] : [];
    return [screenHead(headStats, isGrade ? 'convert' : 'scale'), modeControl, rows, gpa, ...stdBlocks,
      favUniversityPicker(), share, fallback, action].filter(Boolean);
  }

  // ---------------------------------------------------------------- 표준점수 계산기
  // 표준점수 입력을 백분위·등급으로 되읽고, 대학이 쓰는 산식으로 환산점수를 낸다.
  // 백분위는 평가원 도수분포 원자료 그대로다 — 표에 없는 점수만 '근사'로 적는다.
  const rawScoreOf = (university, dept) => ENGINE.universityRawScore(
    profile(), DATA.rules[university.id], dept ? dept.track : '인문',
    { std: DATA.std, conv: DATA.conv, universityId: university.id, ruleTrack: dept ? dept.ruleTrack : null,
      metric: basisOf(university.id)?.metric === 'pct' ? 'pct' : 'std' },
  );

  const AREA_LABELS = [['kor', '국어'], ['math', '수학'], ['inq1', '탐구 1'], ['inq2', '탐구 2']];

  // 영역별 표준점수 → 백분위·등급 표. 한 줄이 한 영역이다.
  function stdReadoutRows() {
    const current = profile();
    const rows = [];
    const pick = (field) => {
      if (field === 'kor') return { read: current.kor.read, std: current.kor.std, name: `국어(${current.kor.elective})` };
      if (field === 'math') return { read: current.math.read, std: current.math.std, name: `수학(${current.math.elective})` };
      const slot = current.inquiries.find((row) => row.slot === field);
      return slot ? { read: slot.read, std: slot.std, name: `탐구 ${slot.subject}` } : null;
    };
    for (const [field] of AREA_LABELS) {
      const found = pick(field);
      if (!found || !found.read) continue;
      rows.push({ field, ...found });
    }
    return rows;
  }

  function renderStdReadout() {
    const rows = stdReadoutRows();
    if (rows.length === 0) {
      return section([listHeader('표준점수'), banner('표준점수를 넣으면 백분위로 되읽습니다')]);
    }
    return section([
      listHeader('표준점수', `${DATA.std?.year || EXAM_YEAR}학년도`),
      el('div', { class: 'jr-list' }, rows.map((row) => listItem({
        title: row.name,
        detail: `${fmt(row.std, 0)} · 백분위 ${fmt(row.read.pct, 0)}${row.read.grade ? ` · ${row.read.grade}등급` : ''}`,
        suffix: row.read.exact ? badge('원값', 'positive') : badge('근사', 'warning'),
      }))),
    ]);
  }

  // 대학 하나의 환산점수 한 줄.
  function rawScoreDetail(university, dept, raw) {
    if (!raw) return null;
    const parts = raw.parts.map((part) => `${part.label} ${fmt(part.points, part.points % 1 === 0 ? 0 : 2)}`).join(' + ');
    const scale = raw.max === null ? '' : ` / 만점 ${fmt(raw.max, 2)}`;
    const adjust = (raw.adjustments || []).map((row) => `${row.label} ${signed(row.delta, 2)}`).join(' · ');
    return [parts + scale, adjust, raw.track ? `${raw.track} 기준` : null].filter(Boolean).join(' · ');
  }

  // 목표 탭에 붙는 한 대학짜리 환산점수. 표준점수 모드일 때만 나온다.
  function renderStdScore(university, dept) {
    if (state.scores.mode !== 'std') return null;
    const raw = rawScoreOf(university, dept);
    if (!raw) return accordion('환산점수', [muted('반영비율 미확인')]);
    return accordion('환산점수', [
      el('div', { class: 'jr-list' }, [listItem({
        title: `${university.short} ${fmt(raw.value, raw.basis === 'official' ? 4 : 2)}`,
        detail: rawScoreDetail(university, dept, raw),
        suffix: raw.basis === 'official' ? badge('공식', 'positive') : badge('근사', 'warning'),
      })]),
    ], { open: true });
  }

  // 성적 탭의 대학별 환산점수 목록. 반영비율을 확인한 대학만 줄이 생긴다.
  function renderStdScoreList() {
    const rows = [];
    for (const university of DATA.universities) {
      const dept = university.departments.find((row) => row.track === '인문') || university.departments[0];
      const raw = rawScoreOf(university, dept);
      if (!raw) continue;
      rows.push({ university, dept, raw });
    }
    if (rows.length === 0) return null;
    return accordion('대학별 환산점수', [
      el('div', { class: 'jr-list' }, rows.map(({ university, dept, raw }) => listItem({
        title: `${university.short} ${fmt(raw.value, raw.basis === 'official' ? 4 : 2)}`,
        detail: rawScoreDetail(university, dept, raw),
        suffix: raw.basis === 'official' ? badge('공식', 'positive') : badge('근사', 'warning'),
      }))),
    ], { open: false, description: `${rows.length}곳` });
  }

  // ---------------------------------------------------------------- 진단 화면
  // 대학 43곳·모집단위 1,900여 곳을 매 렌더마다 다시 판정하면 필터 한 번에 100ms를 넘긴다.
  // 성적·계열·체크한 라인/대학·정렬이 그대로면 지난 결과를 그대로 쓴다('더 보기'와 검색은 이 뒤에서 거른다).
  let diagnoseCache = { key: null, rows: null };
  function diagnoseAll() {
    const key = JSON.stringify([state.scores, state.filters.track, state.filters.lines, state.filters.universities, state.filters.sort]);
    if (diagnoseCache.key !== key) {
      diagnoseCache = {
        key,
        rows: ENGINE.diagnose(profile(), DATA, {
          track: state.filters.track,
          universities: checkedUniversityIds(),
          // 기본은 라인 순위(서연고→…)가 1차, 예상 컷 내림차순이 2차다 (FRAME §8.3).
          // '판정별'을 고르면 판정 묶음 안에서 아슬아슬한 순(차이 오름차순)으로 본다.
          sort: state.filters.sort === 'band' ? 'gap' : 'cut',
        }),
      };
    }
    return diagnoseCache.rows;
  }

  function diagnoseRows() {
    const rows = diagnoseAll();
    const query = state.filters.query.trim();
    // 체크한 라인·대학의 교집합. 비어 있으면(서로 어긋나게 체크했으면) 아무것도 남지 않는다.
    const allowed = checkedUniversityIds();
    return rows.filter((row) => {
      if (allowed && !allowed.has(row.universityId)) return false;
      if (row.jeongsi.status === 'no-cut' || row.jeongsi.status === 'no-profile') return false;
      if (hiddenNow(row.universityId, row.dept)) return false;
      if (state.filters.band !== '전체' && bandOf(row.jeongsi)?.label !== state.filters.band) return false;
      if (state.filters.favOnly && !state.favorites.has(deptKey(row.universityId, row.dept.name))) return false;
      if (state.filters.favUniOnly && !isFavUniversity(row.universityId)) return false;
      if (query && !(`${row.universityName} ${row.dept.name}`).includes(query)) return false;
      return true;
    });
  }

  // 관심 대학 고르기. 대학 이름 칩을 눌러 담고, localStorage에 대학 아이디만 남긴다.
  // 관심은 '우선 표시'다 — 목록을 좁히는 것은 아래 라인·대학 체크 목록이 맡는다.
  function favUniversityPicker({ open = false } = {}) {
    const chips = el('div', { class: 'jr-chips jr-chips-wrap' }, DATA.universities.map((university) => el('button', {
      type: 'button',
      'aria-pressed': String(isFavUniversity(university.id)),
      'data-selected': isFavUniversity(university.id) ? '' : null,
      class: 'seed-chip-tabs__trigger seed-chip-tabs__trigger--size_medium seed-chip-tabs__trigger--variant_neutralOutline',
      onclick: () => { toggleFavUniversity(university.id); render(); },
    }, [university.short])));
    const count = state.favUniversities.size;
    return accordion('관심 대학', [
      chips,
      count > 0 ? el('div', { class: 'jr-actions' }, [button('모두 해제', {
        variant: 'ghost', size: 'small',
        onclick: () => { state.favUniversities.clear(); saveFavUniversities(); diagnoseCache.key = null; render(); },
      })]) : null,
    ].filter(Boolean), { open, description: count > 0 ? `${count}곳` : null });
  }

  // 관심 학과 담기. 목표 화면 한 곳에만 둔다 — 목록 행은 제목·값만 지고 간다 (FRAME §8.2).
  function favoriteButton(universityId, deptName) {
    const key = deptKey(universityId, deptName);
    const on = state.favorites.has(key);
    return button(on ? '관심 해제' : '관심 담기', {
      variant: on ? 'neutralSolid' : 'neutralOutline',
      attrs: { 'aria-pressed': String(on) },
      onclick: () => {
        if (on) state.favorites.delete(key); else state.favorites.add(key);
        saveFavorites();
        render();
      },
    });
  }

  // ---- 라인·대학 체크 목록 -------------------------------------------------
  // 두 목록은 AND로 좁힌다: 체크한 라인 안에서, 체크한 대학만. 둘 다 비어 있으면 전체다.
  const checkedLines = () => state.filters.lines.filter((label) => DATA.lines.some((line) => line.label === label));
  const checkedUniversities = () => state.filters.universities.filter((id) => universityById.has(id));
  function checkedUniversityIds() {
    const lines = checkedLines();
    const picks = checkedUniversities();
    if (lines.length === 0 && picks.length === 0) return null;
    const fromLines = lines.length > 0
      ? new Set(DATA.lines.filter((line) => lines.includes(line.label)).flatMap((line) => line.ids))
      : null;
    if (picks.length === 0) return fromLines;
    const set = new Set(picks.filter((id) => !fromLines || fromLines.has(id)));
    return set;
  }
  function toggleFilterList(field, value) {
    const list = state.filters[field];
    const index = list.indexOf(value);
    if (index === -1) list.push(value); else list.splice(index, 1);
    state.filters.limit = 8;
    saveFilters();
    diagnoseCache.key = null;
    render();
  }
  function clearFilterList(field) {
    state.filters[field] = [];
    state.filters.limit = 8;
    saveFilters();
    diagnoseCache.key = null;
    render();
  }

  // 펼쳐진 체크 목록 하나. 라인은 라인 표 순서, 대학은 라인 머리글 아래 라인 순서다.
  function filterChecklist() {
    if (state.filterPanel === 'line') {
      const lines = checkedLines();
      return el('div', { class: 'jr-section' }, [
        listHeader('라인', lines.length > 0 ? `${lines.length}개` : null),
        el('div', { class: 'jr-list' }, [
          ...DATA.lines.map((line) => checkRow(line.label, lines.includes(line.label),
            () => toggleFilterList('lines', line.label), `${line.ids.length}곳`)),
          lines.length > 0 ? checkRow('모두 해제', false, () => clearFilterList('lines')) : null,
        ].filter(Boolean)),
      ]);
    }
    if (state.filterPanel === 'university') {
      const picks = checkedUniversities();
      const lines = checkedLines();
      const visible = DATA.lines.filter((line) => lines.length === 0 || lines.includes(line.label));
      return el('div', { class: 'jr-section' }, [
        listHeader('대학', picks.length > 0 ? `${picks.length}곳` : null),
        ...visible.map((line) => el('div', { class: 'jr-group' }, [
          listHeader(line.label),
          el('div', { class: 'jr-list' }, line.ids.map((id) => {
            const university = universityById.get(id);
            return university ? checkRow(university.short, picks.includes(id), () => toggleFilterList('universities', id)) : null;
          }).filter(Boolean)),
        ])),
        picks.length > 0 ? el('div', { class: 'jr-list' }, [checkRow('모두 해제', false, () => clearFilterList('universities'))]) : null,
      ].filter(Boolean));
    }
    return null;
  }

  function renderDiagnose() {
    if (!profileReady()) {
      return [banner('성적 탭에서 국어·수학·탐구를 먼저 입력하세요', 'criticalWeak'),
        el('div', { class: 'jr-actions' }, [button('성적 입력', { variant: 'brandSolid', onclick: () => go('scores') })])];
    }
    const rows = diagnoseRows();
    const average = ENGINE.simpleAverage(profile());
    const reachable = rows.filter((row) => REACHABLE_BANDS.includes(bandOf(row.jeongsi)?.key)).length;
    const held = rows.filter((row) => row.jeongsi.status === 'hold' || row.jeongsi.status === 'basis-mismatch').length;
    const estimated = profile().mode === 'grade';

    const head = screenHead(stats([
      [estimated ? '국·수·탐 평균 (등급)' : '국·수·탐 평균', fmt(average, 2)],
      ['지원 가능', `${reachable}곳`],
      held > 0 ? ['보류', `${held}곳`] : ['관심', `${state.favorites.size}곳`],
    ]), 'verdict');

    const resetLimit = () => { state.filters.limit = 8; };
    const chip = (label, on, onclick, attrs = {}) => el('button', {
      type: 'button',
      'aria-pressed': String(on),
      'data-selected': on ? '' : null,
      class: 'seed-chip-tabs__trigger seed-chip-tabs__trigger--size_medium seed-chip-tabs__trigger--variant_neutralOutline',
      onclick,
      ...attrs,
    }, [label]);
    const openPanel = (name) => {
      state.filterPanel = state.filterPanel === name ? null : name;
      render();
    };
    const lineCount = checkedLines().length;
    const uniCount = checkedUniversities().length;
    // 한 줄 가로 스크롤 칩. 계열 · 체크 목록 · 관심 · 제외 토글이 모두 이 한 줄에 있다 (FRAME §8.2).
    const chips = el('div', { class: 'jr-chips', role: 'group', 'aria-label': '필터' }, [
      // 체크 목록 칩이 맨 앞이다 — 목록을 좁히는 가장 굵은 손잡이다.
      chip(lineCount > 0 ? `라인 ${lineCount}` : '라인', state.filterPanel === 'line' || lineCount > 0,
        () => openPanel('line'), { 'aria-expanded': String(state.filterPanel === 'line') }),
      chip(uniCount > 0 ? `대학 ${uniCount}` : '대학', state.filterPanel === 'university' || uniCount > 0,
        () => openPanel('university'), { 'aria-expanded': String(state.filterPanel === 'university') }),
      ...TRACKS.map((track) => chip(track, state.filters.track === track, () => {
        state.filters.track = track;
        // 예체능을 골랐는데 '예체능 제외'가 켜져 있으면 아무것도 안 남는다 — 함께 꺼 준다.
        if (track === '예체능') state.filters.noArts = false;
        resetLimit();
        saveFilters();
        render();
      })),
      chip('관심 학과', state.filters.favOnly, () => {
        state.filters.favOnly = !state.filters.favOnly; resetLimit(); saveFilters(); render();
      }),
      chip('관심 대학', state.filters.favUniOnly, () => {
        state.filters.favUniOnly = !state.filters.favUniOnly; resetLimit(); saveFilters(); render();
      }),
      chip('예체능 제외', state.filters.noArts, () => {
        state.filters.noArts = !state.filters.noArts;
        if (state.filters.noArts && state.filters.track === '예체능') state.filters.track = '전체';
        resetLimit();
        saveFilters();
        render();
      }),
      chip('말도 안되는거 제외', state.filters.noDream, () => {
        state.filters.noDream = !state.filters.noDream; resetLimit(); saveFilters(); render();
      }),
      chip('여대 제외', state.filters.noWomen, () => {
        state.filters.noWomen = !state.filters.noWomen; resetLimit(); saveFilters(); render();
      }),
    ]);

    const filters = el('div', { class: 'jr-filters' }, [
      select(BANDS.map((band) => [band, band === '전체' ? '판정 전체' : band]), state.filters.band,
        (value) => { state.filters.band = value; resetLimit(); saveFilters(); render(); }, '판정'),
      select(SORTS, state.filters.sort,
        (value) => { state.filters.sort = value; resetLimit(); saveFilters(); render(); }, '정렬'),
      textInput({
        type: 'search', value: state.filters.query, placeholder: '검색', 'aria-label': '대학·학과 검색',
        oninput: (event) => {
          state.filters.query = event.target.value;
          resetLimit();
          saveFilters();
          renderPanel({ keepFocus: 'search' });
        },
      }, 'jr-search'),
    ]);

    if (rows.length === 0) {
      return [head, chips, filters, filterChecklist(), banner('조건에 맞는 곳이 없습니다')].filter(Boolean);
    }

    const rowItem = (row) => {
      const result = row.jeongsi;
      const band = bandOf(result);
      // 부제는 값만 한 줄 — 접두어는 쓰지 않는다 (FRAME §8.1).
      // 보류·기준 불일치가 남는 행은 사유 두세 단어만 적는다 (FRAME §8.1).
      const detail = result.status === 'basis-mismatch' || result.status === 'hold'
        ? result.hold.reason
        : result.status === 'blocked'
          ? result.score.blockers[0]
          // 등급 입력은 구간 중앙 백분위를 가정값으로 쓴다 — 구간은 괄호로 붙여 한 조각으로 둔다.
          // 추정 행에서는 컷의 연도 관측 범위를 빼고 내 구간만 남긴다: 등급 구간이 훨씬 넓어
          // 두 범위를 나란히 적으면 좁은 폭에서 줄만 밀린다(관측 범위는 '기준 숫자'에 그대로 있다).
          : [result.estimated ? `컷 ${fmt(result.cut.value, 1)}` : spreadText(result),
            result.estimated ? mineWithRange(result) : `내 ${fmt(result.mine, 1)}`,
            result.group ? `${result.group}군` : null, basisShort(row.universityId)].filter(Boolean).join(' · ');
      return listItem({
        title: `${row.universityName} ${deptLabel(row.dept.name)}`,
        detail,
        // 부제가 뱃지 아래 행 전체 폭을 쓴다 — 값을 줄이지 않고 한 줄에 담는다.
        stack: true,
        suffix: [
          // 보류·기준 불일치에는 차이 숫자를 적지 않는다 — 판정한 것처럼 보인다.
          el('span', { class: 'jr-gap num', text: result.status === 'ok' || result.status === 'blocked' ? signed(result.gap, 1) : '—' }),
          result.estimated && result.status === 'ok' ? badge('추정', 'warning') : null,
          // 차이 숫자 → 추정 → 실기 → 이상 → 판정 (FRAME §9.4).
          row.dept.practical === true ? badge('실기', 'neutral') : null,
          isFlaggedAnomaly(row.dept) ? badge('이상', 'critical') : null,
          badge(band.label, BAND_TONE[band.key]),
        ].filter(Boolean),
        onclick: () => {
          state.target = { university: row.universityId, dept: row.dept.name };
          go('target');
        },
      });
    };

    // 관심 대학 묶음. 담아 둔 대학의 모집단위를 맨 위로 올리고, 그 안에서 관심 학과를 앞세운다.
    const starred = (row) => state.favorites.has(deptKey(row.universityId, row.dept.name));
    const favFirst = (list) => [...list.filter(starred), ...list.filter((row) => !starred(row))];
    const favRows = state.favUniversities.size > 0 && !state.filters.favUniOnly
      ? favFirst(rows.filter((row) => isFavUniversity(row.universityId)))
      : [];
    const restRows = favRows.length > 0 ? rows.filter((row) => !isFavUniversity(row.universityId)) : rows;

    const total = rows.length;
    const blocks = [];
    let shown = 0;

    if (favRows.length > 0) {
      const slice = favRows.slice(0, state.filters.limit * 2);
      shown += slice.length;
      blocks.push(el('div', { class: 'jr-section' }, [
        listHeader('관심 대학', `${favRows.length}곳`),
        el('div', { class: 'jr-list' }, slice.map(rowItem)),
      ]));
    }

    if (state.filters.sort === 'band') {
      // 판정별 보기: 머리글이 판정이다.
      const bucket = new Map(BAND_ORDER.map((key) => [key, []]));
      for (const row of restRows) bucket.get(bandOf(row.jeongsi).key)?.push(row);
      for (const key of BAND_ORDER) {
        const list = bucket.get(key) || [];
        if (list.length === 0) continue;
        const slice = list.slice(0, state.filters.limit);
        shown += slice.length;
        blocks.push(el('div', { class: 'jr-section' }, [
          listHeader(bandOf(list[0].jeongsi).label, `${list.length}곳`),
          el('div', { class: 'jr-list' }, slice.map(rowItem)),
        ]));
      }
    } else {
      // 높은 순: 라인 이름이 머리글이다. 대학마다 라인 뱃지를 되풀이하지 않는다 (FRAME §8.3).
      // 라인마다 위에서 limit 곳씩 보여 준다 — 한 라인이 첫 화면을 다 먹지 않게 한다.
      const byLine = new Map();
      for (const row of restRows) {
        const line = universityById.get(row.universityId)?.line || '기타';
        if (!byLine.has(line)) byLine.set(line, []);
        byLine.get(line).push(row);
      }
      for (const [line, list] of byLine) {
        const slice = list.slice(0, state.filters.limit);
        shown += slice.length;
        blocks.push(el('div', { class: 'jr-section' }, [
          listHeader(line, `${list.length}곳`),
          el('div', { class: 'jr-list' }, slice.map(rowItem)),
        ]));
      }
    }

    const more = shown < total
      ? el('div', { class: 'jr-actions' }, [button(`더 보기 ${total - shown}곳`, {
        variant: 'neutralWeak',
        onclick: () => { state.filters.limit += 8; saveFilters(); render(); },
      })])
      : null;

    return [head, chips, filters, filterChecklist(), ...blocks, more].filter(Boolean);
  }

  // ---------------------------------------------------------------- 목표 화면
  // 목표 탭에서 고를 수 있는 대학·모집단위. 진단 목록과 같은 숨김 규칙을 따르되,
  // 지금 열어 둔 곳과 관심 학과는 늘 남긴다(공유 링크로 바로 들어온 경우를 위해).
  const targetDepartments = (university) => {
    const rows = (university.departments || []).filter((dept) => !hiddenNow(university.id, dept));
    return rows.length > 0 ? rows : university.departments || [];
  };
  const targetUniversities = () => {
    // 진단에서 체크한 라인·대학이 있으면 목표 셀렉트도 그 안에서만 고른다(지금 열어 둔 곳은 남긴다).
    const checked = checkedUniversityIds();
    const rows = DATA.universities
      .filter((university) => !checked || checked.has(university.id) || university.id === state.target.university)
      .filter((university) => targetDepartments(university).some((dept) => !hiddenNow(university.id, dept)));
    return rows.length > 0 ? rows : DATA.universities;
  };

  function currentTarget() {
    const university = universityById.get(state.target.university) || targetUniversities().find((row) => row.departments.length > 0);
    if (!university) return null;
    const allowed = targetDepartments(university);
    const dept = university.departments.find((row) => row.name === state.target.dept)
      || allowed.find((row) => Object.keys(row.jeongsi || {}).length > 0)
      || allowed[0]
      || university.departments[0];
    return { university, dept };
  }

  function renderTarget() {
    if (!profileReady()) {
      return [banner('성적을 먼저 입력하세요', 'criticalWeak'),
        el('div', { class: 'jr-actions' }, [button('성적 입력', { variant: 'brandSolid', onclick: () => go('scores') })])];
    }
    const picked = currentTarget();
    if (!picked) return [banner('데이터를 불러오지 못했습니다', 'criticalWeak')];
    const { university, dept } = picked;
    state.target = { university: university.id, dept: dept.name };

    const universityOptions = targetUniversities();
    if (!universityOptions.some((row) => row.id === university.id)) universityOptions.unshift(university);
    const deptOptions = targetDepartments(university);
    if (!deptOptions.some((row) => row.name === dept.name)) deptOptions.unshift(dept);
    // 셀렉트도 라인 순위를 따른다 — 라인 이름을 optgroup 머리글로 쓴다 (FRAME §8.3).
    const favPicks = universityOptions.filter((row) => isFavUniversity(row.id));
    const groups = [];
    if (favPicks.length > 0) groups.push({ label: '관심 대학', options: favPicks.map((row) => [row.id, row.short]) });
    for (const line of DATA.lines) {
      const options = universityOptions.filter((row) => row.line === line.label && !isFavUniversity(row.id));
      if (options.length > 0) groups.push({ label: line.label, options: options.map((row) => [row.id, row.short]) });
    }
    const universitySelect = groupedSelect(groups, university.id,
      (value) => { state.target = { university: value, dept: '' }; render(); }, '대학');
    const pickers = el('div', { class: 'jr-filters' }, [
      universitySelect,
      select(deptOptions.map((row) => [row.name, deptLabel(row.name)]), dept.name, (value) => {
        state.target = { university: university.id, dept: value };
        render();
      }, '모집단위'),
    ]);

    const target = ENGINE.analyzeTarget(profile(), university, dept, DATA.rules[university.id], university.volatility ?? DATA.volatility);
    if (target.status === 'no-cut' || target.status === 'basis-mismatch' || target.status === 'hold') {
      // 사유는 두세 단어만. 무엇이 있어야 판정하는지는 정보 탭의 표가 말한다 (FRAME §8.1).
      const label = target.status === 'basis-mismatch' ? '기준 불일치' : '보류';
      return [screenHead(pickers, 'verdict'),
        el('p', { class: 'jr-verdict-badges' }, [badge(label, 'neutral')]),
        banner(target.hold?.reason || '컷 없음', 'neutralWeak'), renderBasis(dept, target)];
    }

    const targetBand = bandOf(target);
    // 판정 카드: 큰 숫자 하나 + 뱃지 하나 + 값만 한 줄 (FRAME §8.2).
    const held = target.status === 'hold';
    const mineLine = target.estimated
      ? mineWithRange(target)
      : `내 ${target.defLabel === ENGINE.CUT_DEFS['ksi-mean'].label ? '국·수·탐' : '비교값'} ${fmt(target.mine, 1)}`;
    const verdict = el('div', { class: 'jr-verdict' }, [
      el('p', { class: 'jr-verdict-number', text: held ? '—' : signed(target.gap, 1) }),
      el('p', { class: 'jr-verdict-badges' }, [
        badge(targetBand.label, BAND_TONE[targetBand.key]),
        target.estimated ? badge('추정', 'warning') : null,
      ].filter(Boolean)),
      el('p', { class: 'jr-muted', text: `${university.short} ${deptLabel(dept.name)} · ${spreadText(target)} · ${mineLine}` }),
      // 등급 입력일 때만: 구간 하한·상한에서의 판정을 값으로만 한 줄 (FRAME §8.1).
      target.gapRange ? el('p', { class: 'jr-muted', text: `구간 하한 ${target.gapRange.minBand.label} · 상한 ${target.gapRange.maxBand.label}` }) : null,
    ].filter(Boolean));

    const plan = target.plan;
    const planBlock = plan ? section([
      listHeader('필요한 상승', plan.need > 0 ? `${fmt(plan.need, 1)}점` : '충족'),
      el('div', { class: 'jr-list' }, [
        ...plan.subjects.map((subject) => listItem({
          title: subject.label,
          detail: plan.need > 0
            ? (subject.reachable
              ? `${fmt(subject.current, 1)} → ${fmt(subject.targetPct, 1)}`
              : `${fmt(subject.current, 1)} · 100까지 올려도 ${fmt(subject.shortfall, 1)} 모자람`)
            : fmt(subject.current, 1),
          suffix: plan.best && plan.best.key === subject.key && plan.need > 0
            ? badge('추천', 'brand')
            : el('span', { class: 'jr-muted num', text: `${Math.round(subject.share * 100)}%` }),
        })),
        plan.uniform > 0 ? listItem({
          title: '전 영역 균등',
          detail: `${fmt(plan.uniform, 1)}점씩`,
        }) : null,
        plan.english && plan.english.steps.length > 0 ? listItem({
          title: `영어 ${plan.english.current}등급`,
          detail: plan.english.steps.map((step) => `${step.grade}등급 ${signed(step.gain, 2)}`).join(' · '),
          suffix: plan.english.enough ? badge(`${plan.english.enough.grade}등급`, 'positive') : null,
        }) : null,
      ].filter(Boolean)),
    ]) : null;

    // 조건·가감점은 문장이 아니라 값 한 줄짜리 행으로 적는다 (FRAME §8.1).
    const conditions = [];
    if (plan && plan.blockers.length > 0) {
      conditions.push(listItem({ title: '지원 제한', detail: plan.blockers.join(' · '), suffix: badge('불가', 'critical') }));
    }
    if (plan && plan.adjustments.length > 0) {
      conditions.push(listItem({ title: '가감점', detail: plan.adjustments.map((row) => `${row.label} ${signed(row.delta, 2)}`).join(' · ') }));
    }
    if (target.score?.bestOfNotes?.length > 0) {
      conditions.push(listItem({ title: '우수 영역 순', detail: target.score.bestOfNotes.join(' · ') }));
    }
    if (target.floor?.cleared) {
      conditions.push(listItem({
        title: '100%컷',
        detail: `${fmt(target.floor.value, 1)} · ${target.floor.year}학년도`,
        suffix: badge('넘김', 'positive'),
      }));
    }
    if (target.index) {
      conditions.push(listItem({
        title: '반영비율 지수', detail: `${fmt(target.index.value, 1)} · 컷과 눈금이 달라 차이를 내지 않음`,
        suffix: badge('참고', 'neutral'),
      }));
    }
    if (held) conditions.push(listItem({ title: '보류', detail: target.hold.reason, suffix: badge('보류', 'neutral') }));
    if ((target.compare?.assumptions || []).length > 0) {
      conditions.push(listItem({ title: '가정한 값', detail: target.compare.assumptions.join(' · '), suffix: badge('추정', 'warning') }));
    }
    if (target.defLabel && target.defLabel !== ENGINE.CUT_DEFS['ksi-mean'].label) {
      conditions.push(listItem({ title: '컷 정의', detail: target.defLabel, suffix: badge('같은 정의', 'neutral') }));
    }
    conditions.push(listItem({ title: '반영 지표', detail: basisOf(university.id)?.text || '미확인', suffix: badge(basisShort(university.id), isApproxBasis(university.id) ? 'warning' : 'neutral') }));
    const conditionBlock = section([listHeader('조건'), el('div', { class: 'jr-list' }, conditions)]);

    const compare = renderCompare(university, dept);

    const favAction = el('div', { class: 'jr-actions' }, [favoriteButton(university.id, dept.name)]);

    return [screenHead(pickers, 'verdict'), verdict, favAction, planBlock, conditionBlock, renderStdScore(university, dept),
      renderBasis(dept, target), renderSusi(target), compare].filter(Boolean);
  }

  function renderBasis(dept, target) {
    const reference = target.reference || ENGINE.jeongsiReference(dept);
    const yearRows = (reference.series || []).slice().reverse().map((row) => [
      `${row.year}학년도`,
      fmt(row.value, 1),
      row.kind,
      row.basis === 'derived' ? '대학 공식값의 연도 변화량으로 환산' : (row.basis === 'official' ? '대학 공식 발표' : '어디가 공개값'),
    ]);
    const meta = [];
    const cuts = [];
    for (const [year, row] of Object.entries(dept.jeongsi || {}).sort().reverse()) {
      meta.push([
        `${year}학년도`, row.quota ?? '—', row.rate ?? '—',
        row.fill === null || row.fill === undefined ? '—'
          : `${row.fill}명${row.fillRate === null || row.fillRate === undefined ? '' : ` (${fmt(row.fillRate, 0)}%)`}`,
        row.lastWait ?? '—', row.group ? `${row.group}군` : '—',
      ]);
      if (row.metric === 'pct') {
        cuts.push([`${year}학년도`, fmt(row.cut50, 1), fmt(row.cut70, 1), fmt(row.cut100, 1), row.kind || '—']);
      }
    }
    const officialRows = Object.entries(dept.official || {}).sort().reverse().map(([year, row]) => [
      `${year}학년도`, fmt(row.cut70 ?? row.avg, 2), row.kind || '—', row.note || '',
    ]);

    // 이상치 한 줄. 값만 적는다 — 이상이 아니면 행 자체가 없다 (FRAME §9.4).
    const anomaly = anomalyOf(dept);
    return accordion('기준 숫자', [
      anomaly ? el('div', { class: 'jr-list' }, [listItem({
        title: '이상 신호',
        suffix: el('span', { class: 'jr-gap num', text: `${ANOMALY_LABEL[anomaly.kind]} · ${signed(-anomaly.gap, 1)}` }),
      })]) : null,
      yearRows.length > 0 ? table(['연도', '컷', '종류', '출처'], yearRows) : muted('연도별 컷 자료 없음'),
      cuts.length > 0 ? table(['연도', '50%컷', '70%컷', '100%컷', '종류'], cuts) : null,
      meta.length > 0 ? table(['연도', '모집인원', '경쟁률', '추합', '예비번호', '군'], meta) : null,
      officialRows.length > 0 ? table(['연도', '값', '종류', '설명'], officialRows) : null,
      reference.primary?.url ? el('p', { class: 'jr-muted' }, [
        el('a', { class: 'jr-link', href: reference.primary.url, target: '_blank', rel: 'noreferrer noopener', text: '출처' }),
      ]) : null,
    ].filter(Boolean));
  }

  function renderSusi(target) {
    const rows = [];
    for (const [kind, label] of [['gyogwa', '학생부교과'], ['hakjong', '학생부종합']]) {
      const result = target[kind];
      if (!result) continue;
      rows.push(listItem({
        title: `${label} ${result.typeName || ''}`.trim(),
        detail: `${result.year}학년도 ${fmt(result.cut, 2)}등급 · 차이 ${signed(result.gap, 2)}`,
        suffix: badge(result.band.label, BAND_TONE[result.band.key]),
      }));
    }
    if (rows.length === 0) {
      const gpa = ENGINE.normalizeProfile(state.scores, DATA.scales).gpa;
      return accordion('수시', [muted(gpa === null ? '내신 등급을 넣으면 비교합니다' : '공개된 수시 결과 없음')]);
    }
    return accordion('수시', [el('div', { class: 'jr-list' }, rows)]);
  }

  function renderCompare(university, dept) {
    const keys = [...state.favorites].slice(0, 3);
    const picks = [];
    for (const key of keys) {
      const [universityId, deptName] = key.split('::');
      const other = universityById.get(universityId);
      const otherDept = other?.departments.find((row) => row.name === deptName);
      if (other && otherDept) picks.push({ university: other, dept: otherDept });
    }
    // 관심 학과가 모자라면 관심 대학에서 같은 계열의 대표 모집단위를 채워 넣는다.
    for (const universityId of state.favUniversities) {
      if (picks.length >= 3) break;
      const other = universityById.get(universityId);
      if (!other || picks.some((row) => row.university.id === universityId)) continue;
      const sameTrack = other.departments.filter((row) => row.track === dept.track && Object.keys(row.jeongsi || {}).length > 0);
      const otherDept = sameTrack[0] || other.departments[0];
      if (otherDept) picks.push({ university: other, dept: otherDept });
    }
    if (!picks.some((row) => row.university.id === university.id && row.dept.name === dept.name) && picks.length < 3) {
      picks.unshift({ university, dept });
    }
    // 진단 목록과 같은 숨김 규칙. 관심 학과와 지금 보는 곳은 pinned 라 그대로 남는다.
    const visible = picks.filter((pick) => !hiddenNow(pick.university.id, pick.dept));
    picks.length = 0;
    picks.push(...visible);
    if (picks.length < 2) return null;
    // 진단 목록과 같은 정렬 — 예상 컷이 높은 곳부터, 같으면 대학 라인 순.
    const rows = picks
      .map((pick) => ({
        pick,
        universityOrder: pick.university.order ?? 0,
        dept: pick.dept,
        jeongsi: ENGINE.evaluateJeongsi(profile(), pick.university, pick.dept, DATA.rules[pick.university.id], pick.university.volatility ?? DATA.volatility),
      }))
      .sort(ENGINE.byCutDesc)
      .map(({ pick, jeongsi: result }) => [
        `${pick.university.short} ${deptLabel(pick.dept.name)}`,
        result.cut ? fmt(result.cut.value, 1) : '—',
        result.mine === null || result.mine === undefined ? '—' : fmt(result.mine, 1),
        result.status === 'ok' || result.status === 'blocked' ? signed(result.gap, 1) : '—',
        bandOf(result) ? badge(bandOf(result).label, BAND_TONE[bandOf(result).key]) : '—',
      ]);
    return section([
      listHeader('비교', `${picks.length}곳`),
      table(['모집단위', '컷', '국·수·탐', '차이', '판정'], rows),
    ]);
  }

  // ---------------------------------------------------------------- 반영 화면
  function renderRules() {
    const universityId = state.rulesUniversity;
    const university = universityById.get(universityId) || DATA.universities[0];
    const rule = DATA.rules[university.id];

    // 라인 이름을 optgroup 머리글로 쓴다 — 셀렉트도 라인 순위를 따른다 (FRAME §8.3).
    const picker = el('div', { class: 'jr-filters' }, [
      groupedSelect(DATA.lines.map((line) => ({
        label: line.label,
        options: DATA.universities.filter((row) => row.line === line.label).map((row) => [row.id, row.short]),
      })), university.id, (value) => {
        state.rulesUniversity = value;
        render();
      }, '대학'),
    ]);
    const head = screenHead(picker, 'basis');

    if (!rule) return [head, banner('반영 방법 자료 없음')];

    const trackBlocks = (rule.tracks || []).map((track, index) => {
      const weights = track.weights || {};
      const unit = track.unit === 'points' ? '점' : '%';
      const english = track.english || {};
      const history = track.history || {};
      // 비율이 0인 영역은 '0점'이 아니라 어떻게 반영되는지를 적는다.
      const zeroText = (label) => {
        if (label === '영어') return english.method ? `비율 없이 ${english.method}` : '가감점으로만 반영';
        if (label === '한국사') return history.method ? `비율 없이 ${history.method}` : '가감점으로만 반영';
        return '미반영';
      };
      const weightRows = [
        ['국어', weights.kor ?? 0], ['수학', weights.math ?? 0], ['영어', weights.eng ?? 0], ['탐구', weights.inq ?? 0],
      ].map(([label, value]) => [label, Number(value) > 0 ? `${numText(value)}${unit}` : zeroText(label)]);
      for (const group of track.bestOf || []) {
        weightRows.push([`${group.areas.map((area) => ENGINE.SUBJECT_LABEL[area]).join('·')} 우수 순`, group.weights.map(numText).join(' / ')]);
      }
      const englishRow = Object.entries(english.table || {}).map(([grade, value]) => `${grade}등급 ${numText(value)}`);
      const historyRow = Object.entries(history.table || {}).map(([grade, value]) => `${grade}등급 ${numText(value)}`);
      const inquiry = track.inquiry || {};
      const extras = [];
      if (inquiry.count) extras.push(`탐구 ${inquiry.count}과목 반영`);
      if (inquiry.allowed) extras.push(`응시 범위 ${inquiry.allowed}`);
      if (inquiry.scienceBonus) extras.push(`과탐 가산 ${Math.round(inquiry.scienceBonus * 1000) / 10}%`);
      if (inquiry.socialBonus) extras.push(`사탐 가산 ${Math.round(inquiry.socialBonus * 1000) / 10}%`);
      if (track.mathBonus) extras.push(`미적분·기하 가산 ${Math.round(track.mathBonus * 1000) / 10}%`);

      return accordion(`${track.name} 계열`, [
        track.appliesTo ? muted(track.appliesTo) : null,
        table(['영역', '반영'], weightRows),
        englishRow.length > 0 ? el('p', { class: 'jr-muted', text: `영어(${english.method || '반영'}): ${englishRow.join(' · ')}` }) : null,
        historyRow.length > 0 ? el('p', { class: 'jr-muted', text: `한국사(${history.method || '반영'}): ${historyRow.join(' · ')}` }) : null,
        extras.length > 0 ? el('p', { class: 'jr-muted', text: extras.join(' · ') }) : null,
        [english.note, history.note, inquiry.note, track.note].filter(Boolean).map((note) => el('p', { class: 'jr-muted', text: prose(note) })),
      ].filter(Boolean), { open: index === 0 });
    });

    const exam = DATA.scales?.exams?.[EXAM_YEAR];
    const cutRows = [];
    if (exam) {
      for (const [key, subject] of Object.entries(exam.subjects)) {
        if (!key.startsWith('국어-') && !key.startsWith('수학-')) continue;
        const byGrade = new Map((subject.grades || []).map((row) => [row.grade, row.raw]));
        cutRows.push([key.replace('-', ' '), byGrade.get(1) ?? '—', byGrade.get(2) ?? '—', byGrade.get(3) ?? '—', subject.maxStd ?? '—']);
      }
    }

    const source = (rule.sources || [])[0];
    const summary = basisOf(university.id);
    return [
      head,
      section([
        listHeader('반영 지표'),
        el('div', { class: 'jr-list' }, [listItem({
          title: summary?.label || '미확인',
          detail: summary?.text || null,
          suffix: badge(summary?.short || '미확인', summary?.approxPercentile ? 'warning' : 'neutral'),
        })]),
      ]),
      section([listHeader('수능 반영', `${rule.year || 2027}학년도`), ...trackBlocks]),
      rule.changes2027 ? accordion('2027 변경', [muted(prose(rule.changes2027))]) : null,
      cutRows.length > 0 ? section([
        listHeader('원점수 컷', exam.status === 'final' ? '실채점' : '가채점'),
        el('div', { class: 'jr-list' }, cutRows.map(([subject, first, second, third, maxStd]) => listItem({
          title: subject,
          detail: `1등급 ${first} · 2등급 ${second} · 3등급 ${third}`,
          suffix: el('span', { class: 'jr-muted num', text: `표점 ${maxStd}` }),
        }))),
      ]) : null,
      accordion('수능 체제', [
        muted(DATA.scales?.policy2027?.summary || '공통+선택 체제가 유지됩니다.'),
        ...(DATA.scales?.policy2027?.sources || []).map((row) => el('p', { class: 'jr-muted' }, [
          el('a', { class: 'jr-link', href: row.url, target: '_blank', rel: 'noreferrer noopener', text: row.title }),
        ])),
      ]),
      source ? el('p', { class: 'jr-muted' }, [
        el('a', { class: 'jr-link', href: source.url, target: '_blank', rel: 'noreferrer noopener', text: source.title }),
      ]) : null,
    ].filter(Boolean);
  }

  // ---------------------------------------------------------------- 정보 화면
  // 지금 성적으로 판정이 안 나오는 곳을 사유별로 센다. 정보 탭의 '남는 상태' 표가 쓴다.
  // 사유는 네 가지뿐이다 — 그 밖의 이유로는 보류하지 않는다.
  const STATUS_REASON = Object.freeze({
    blocked: ['불가', '과탐 필수·미적분 필수 미충족'],
    hold: ['보류', '그 정의에 필요한 영역 미입력'],
    'basis-mismatch': ['기준 불일치', '환산점수 눈금으로만 공개된 컷'],
    'no-cut': ['컷 없음', '백분위 정시 결과 미공개'],
    'no-profile': ['성적 미입력', '국어·수학·탐구를 넣으면 판정'],
  });
  const STATUS_ORDER = ['hold', 'basis-mismatch', 'no-cut', 'no-profile', 'blocked'];
  // 전수 집계는 필터를 걸지 않는다 — 성적이 그대로면 지난 결과를 쓴다(진단 캐시와 따로 둔다).
  let statusCache = { key: null, counts: null };
  function statusCounts() {
    const key = JSON.stringify(state.scores);
    if (statusCache.key === key) return statusCache.counts;
    const counts = { total: 0, ok: 0 };
    if (!profileReady()) {
      const total = DATA.universities.reduce((sum, row) => sum + row.departments.length, 0);
      statusCache = { key, counts: { total, ok: 0, 'no-profile': total } };
      return statusCache.counts;
    }
    for (const row of ENGINE.diagnose(profile(), DATA, {})) {
      counts.total += 1;
      counts[row.jeongsi.status] = (counts[row.jeongsi.status] || 0) + 1;
    }
    statusCache = { key, counts };
    return counts;
  }
  function statusRows() {
    const counts = statusCounts();
    return STATUS_ORDER
      .filter((key) => (counts[key] || 0) > 0)
      .map((key) => [STATUS_REASON[key][0], STATUS_REASON[key][1], `${counts[key]}곳`]);
  }

  // 컷의 통계 정의별 모집단위 수. 정보 탭의 '비교 기준' 표가 쓴다.
  function cutDefCounts() {
    const counts = {};
    for (const university of DATA.universities) {
      for (const dept of university.departments) {
        const seen = new Set();
        for (const row of Object.values(dept.jeongsi || {})) {
          if ((row.metric || 'pct') !== 'pct' || typeof row.cut70 !== 'number') continue;
          seen.add(row.def || ENGINE.COMPARE_BASIS);
        }
        for (const key of seen) counts[key] = (counts[key] || 0) + 1;
      }
    }
    return counts;
  }

  function unconfirmedNotes() {
    const found = [];
    for (const [id, rule] of Object.entries(DATA.rules || {})) {
      const university = universityById.get(id);
      const seen = new Set();
      const walk = (node) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(walk); return; }
        for (const [key, value] of Object.entries(node)) {
          if (key === 'note' && typeof value === 'string' && /미확인|확인되지 않|표기되지 않/u.test(value)) {
            if (!seen.has(value)) { seen.add(value); found.push(`${university?.short || id}: ${value}`); }
          } else walk(value);
        }
      };
      walk(rule.tracks);
    }
    return found;
  }

  // 어디가(학점나비)가 정수로만 실은 컷이 얼마나 남았는지 센다. 정보 탭이 대학 이름을 그대로 나열한다.
  function cutPrecision() {
    let total = 0;
    let exact = 0;
    const integerOnly = [];
    const partial = [];
    for (const university of DATA.universities) {
      let rows = 0;
      let fixed = 0;
      for (const dept of university.departments) {
        // 판정에 가장 크게 걸리는 최신 연도 컷만 센다.
        const year = Object.keys(dept.jeongsi || {}).sort().at(-1);
        const row = year ? dept.jeongsi[year] : null;
        if (!row || row.metric !== 'pct' || typeof row.cut70 !== 'number') continue;
        rows += 1;
        if (!Number.isInteger(row.cut70)) fixed += 1;
      }
      if (rows === 0) continue;
      total += rows;
      exact += fixed;
      if (fixed === 0) integerOnly.push(university.short);
      else if (fixed < rows) partial.push({ short: university.short, exact: fixed, total: rows });
    }
    partial.sort((left, right) => (right.exact / right.total) - (left.exact / left.total));
    return { total, exact, integerOnly, partial };
  }

  // 정확도 아코디언. 숫자는 scripts/accuracy-report.mjs가 데이터에서 세어 넣은 DATA.accuracy 뿐이다.
  function renderAccuracy() {
    const accuracy = DATA.accuracy;
    if (!accuracy) return null;
    const percent = (value) => `${fmt(value, 1)}%`;
    const coverage = Object.values(accuracy.coverage).filter((row) => row.count > 0);
    const gap = accuracy.gap;
    return [
      listHeader('정확도', `모집단위 ${accuracy.departments}곳`),
      // 출처 등급 — docs/AUDIT.md §1의 잣대. 값·표만 둔다 (FRAME §8.1).
      accuracy.sourceGrades ? accordion('출처 등급', [
        table(['등급', '뜻', '모집단위', '비율'], accuracy.sourceGrades.rows.map((row) => [
          row.key, row.label, String(row.count), percent(row.rate),
        ])),
        table(['등급', '대학'], accuracy.sourceGrades.rows.filter((row) => row.count > 0).map((row) => [
          row.key, row.universities.join(' · '),
        ])),
      ]) : null,
      accordion('기준값 출처', [
        table(['출처', '모집단위', '비율'], coverage.map((row) => [row.label, String(row.count), percent(row.rate)])),
      ]),
      gap.pairs > 0 ? accordion('어디가 값과의 차이', [
        table(['지표', '값'], [
          ['짝', String(gap.pairs)],
          ['평균 절대차', fmt(gap.meanAbs, 2)],
          ['중앙값 절대차', fmt(gap.medianAbs, 2)],
          ['95번째 절대차', fmt(gap.p95Abs, 2)],
          ['최대 절대차', fmt(gap.maxAbs, 2)],
          ['95% 구간', `${numText(fmt(gap.low, 2))} ~ ${numText(fmt(gap.high, 2))}`],
        ]),
        table(['대학', '짝', '평균', '최대'],
          gap.byUniversity.map((row) => [row.short, String(row.pairs), fmt(row.meanAbs, 2), fmt(row.maxAbs, 2)])),
      ]) : null,
      accordion('민감도', [
        table(['성적', '판정한 곳', '±0.5', '±1.0'], accuracy.sensitivity.map((row) => [
          row.label, String(row.judged),
          `${row.shifts[0].changed} (${percent(row.shifts[0].rate)})`,
          `${row.shifts[1].changed} (${percent(row.shifts[1].rate)})`,
        ])),
      ]),
      accordion('반영 규칙', [
        table(['항목', '값'], [
          ['대학', `${accuracy.rules.universities}곳`],
          ['계열 트랙', `${accuracy.rules.tracks}개`],
          ['비율 확인', `${accuracy.rules.weightedTracks}개`],
          ['미확인 항목', `${accuracy.rules.unconfirmed}건`],
          ['50%컷 역전', `${accuracy.columns.flipped}/${accuracy.columns.rows} (${percent(accuracy.columns.rate)})`],
        ]),
        table(['반영 지표', '대학 수'],
          Object.entries(accuracy.rules.basisCounts).sort((left, right) => right[1] - left[1]).map(([label, count]) => [label, String(count)])),
      ]),
    ].filter(Boolean);
  }

  // 계열 중앙값에서 크게 떨어진 2026 컷. 생성물이 이미 판정해 둔 값을 표로만 옮긴다
  // (scripts/anomalies.mjs · FRAME §9.4). 설명문은 쓰지 않고 표 끝에 기준 한 줄만 적는다.
  function anomalyRows() {
    const rows = [];
    for (const university of DATA.universities) {
      for (const dept of university.departments) {
        const anomaly = anomalyOf(dept);
        if (!anomaly) continue;
        rows.push({ university, dept, anomaly });
      }
    }
    return rows.sort((left, right) => right.anomaly.gap - left.anomaly.gap);
  }

  function renderAnomalies() {
    const rows = anomalyRows();
    if (rows.length === 0) return [];
    return [
      listHeader('이상치', `${rows.length}곳`),
      table(['대학', '모집단위', '2026 컷', '계열 중앙값', '차', '분류'], rows.map((row) => [
        row.university.short,
        deptLabel(row.dept.name),
        fmt(row.dept.jeongsi?.['2026']?.cut70, 1),
        fmt(row.anomaly.median, 1),
        signed(-row.anomaly.gap, 1),
        ANOMALY_LABEL[row.anomaly.kind],
      ])),
      muted('기준: (중앙값 − 값) > max(3, 2.5 × MAD)'),
    ];
  }

  // 정보 탭의 절. ⓘ 버튼이 이 아이디로 찾아온다.
  const aboutSection = (anchor, children) => el('div', { class: 'jr-section', id: `jr-about-${anchor}` }, [].concat(children).flat(Infinity).filter(Boolean));

  function renderAbout() {
    const sources = [
      DATA.sources?.results && { title: DATA.sources.results.title, url: DATA.sources.results.url, note: DATA.sources.results.note },
      DATA.sources?.rules && { title: DATA.sources.rules.title, url: DATA.sources.rules.url, note: DATA.sources.rules.note },
      ...(DATA.scales?.exams?.[EXAM_YEAR]?.sources || []).map((row) => ({ title: row.title, url: row.url })),
    ].filter(Boolean);

    const universitySources = DATA.universities
      .filter((university) => university.departments.some((dept) => Object.keys(dept.official || {}).length > 0))
      .map((university) => `${university.short} 연도 표준편차 ${university.volatility === null ? '—' : fmt(university.volatility, 1)}`);

    const unconfirmed = unconfirmedNotes();
    const precision = cutPrecision();
    const bands = ENGINE.VERDICT_BANDS;
    // 컷 중앙값 순은 여기 표에만 남는다 — 화면의 대학 순서는 라인 순위다 (FRAME §8.3).
    const byMedian = DATA.universities
      .filter((row) => typeof row.medianCut === 'number')
      .slice()
      .sort((left, right) => right.medianCut - left.medianCut);

    return [
      aboutSection('verdict', [
        listHeader('판정'),
        table(['판정', '차이'], bands.map((band, index, all) => [
          band.label,
          band.min === -Infinity
            ? `${signed(all[index - 1].min, 1)} 미만`
            : index === 0 ? `${signed(band.min, 1)} 이상` : `${signed(band.min, 1)} ~ ${signed(all[index - 1].min, 1)}`,
        ]).concat([
          ['추정', '등급 입력 · 구간 중앙 백분위로 판정'],
          ['불가', '지원 자격 미충족'],
          ['보류', '필요한 영역 미입력'],
          ['기준 불일치', '환산점수 눈금 · 계산 불가'],
        ])),
      ]),
      aboutSection('scale', [
        listHeader('비교 기준'),
        table(['항목', '값'], [
          ['척도', '컷의 통계 정의 그대로 · 기본은 국·수·탐(2) 백분위 단순평균'],
          ['기준값', '어디가 70%컷 (최근 순 0.6·0.3·0.1 가중)'],
          ['차이', '같은 정의로 계산한 내 값 − 예상 컷'],
          ['등급 입력', '등급 구간의 중앙 백분위로 판정 · 뱃지 추정'],
          ['백분위 입력', '추정 없이 판정'],
          ['관측 범위', '연도별 최소~최대 · 과거 관측값 · 판정을 바꾸지 않음'],
          ['추가합격·충원율', '참고 · 판정에 쓰지 않음'],
        ]),
        table(['값', '컷에서 빼는가'], [
          ['국·수·탐(2) 백분위 단순평균', '뺀다'],
          ['반영비율 가중 지수 (영어 포함)', '빼지 않는다'],
          ['대학 공식 환산점수', '빼지 않는다'],
          ['배점 근사 환산점수', '빼지 않는다'],
        ]),
        // 정의마다 내 성적을 **같은 정의로** 만들어 뺀다. 정의가 다르다는 이유로 보류하지 않는다.
        table(['컷의 통계 정의', '모집단위', '내 계산'], Object.entries(cutDefCounts()).map(([key, count]) => [
          ENGINE.cutDefInfo(key).label,
          `${count}곳`,
          ENGINE.cutDefInfo(key).comparable
            ? `${SCALE_FORMULA[ENGINE.cutScale(key)] || '—'}${ENGINE.cutDefInfo(key).approx ? ' · 근사' : ''}`
            : '계산 불가',
        ])),
        listHeader('남는 상태', `${statusCounts().total}곳 기준`),
        table(['상태', '사유', '곳'], statusRows()),
      ]),
      aboutSection('convert', [
        // 성적 탭의 ⓘ가 등급 모드에서 여기로 온다 — 안내 문장은 화면이 아니라 이 표에만 둔다.
        listHeader('등급 → 백분위'),
        table(['등급', '백분위 구간', '환산'],
          GRADE_TABLE.map((row) => [`${row.grade}등급`, `${fmt(row.low, 0)} ~ ${fmt(row.high, 0)}`, fmt(row.mid, 1)])),
        table(['입력', '판정'], [
          ['등급', '구간 중앙 백분위로 판정 · 뱃지 추정'],
          ['백분위', '추정이 아닌 판정'],
          ['표준점수', '도수분포로 백분위를 읽어 판정'],
        ]),
      ]),
      aboutSection('order', [
        listHeader('대학 순서', '라인 순위'),
        el('div', { class: 'jr-list' }, DATA.lines.map((line) => listItem({
          title: line.label,
          detail: line.ids.map((id) => universityById.get(id)?.short || id).join(' · '),
        }))),
        accordion('컷 중앙값 순', [
          table(['대학', '라인', '중앙값'], byMedian.map((row) => [row.short, row.line, fmt(row.medianCut, 1)])),
        ]),
      ]),
      aboutSection('basis', [
        listHeader('대학별 반영 지표', `표점 ${DATA.universities.filter((row) => isApproxBasis(row.id)).length}곳`),
        el('div', { class: 'jr-list' }, DATA.universities.map((university) => listItem({
          title: university.short,
          detail: basisOf(university.id)?.text || '미확인',
          suffix: badge(basisShort(university.id), isApproxBasis(university.id) ? 'warning' : 'neutral'),
        }))),
      ]),
      aboutSection('accuracy', renderAccuracy() || []),
      aboutSection('anomalies', renderAnomalies()),
      aboutSection('sources', [
        listHeader('출처'),
        el('div', { class: 'jr-list' }, sources.map((row) => listItem({
          title: row.title,
          detail: String(row.url || '').replace(/^https?:\/\//u, '').split('/')[0],
          suffix: el('a', { class: 'jr-link', href: row.url, target: '_blank', rel: 'noreferrer noopener', text: '열기' }),
        }))),
        accordion('공식값을 함께 쓴 대학', [muted(universitySources.length > 0 ? universitySources.join(' · ') : '없음')],
          { description: `${universitySources.length}곳` }),
      ]),
      aboutSection('limits', [
        listHeader('한계'),
        accordion('확인 못 한 규칙', [
          el('div', { class: 'jr-list' }, unconfirmed.map((note) => listItem({ title: note }))),
        ], { description: `${unconfirmed.length}건` }),
        accordion('컷 정밀도', [
          table(['항목', '값'], [
            ['최근 연도 컷', `${precision.total}곳`],
            ['소수 원값', `${precision.exact}곳`],
            ['정수뿐', `${precision.total - precision.exact}곳`],
          ]),
          precision.integerOnly.length > 0 ? muted(precision.integerOnly.join(' · ')) : null,
          precision.partial.length > 0 ? muted(precision.partial.map((row) => `${row.short} ${row.exact}/${row.total}`).join(' · ')) : null,
        ].filter(Boolean), { description: `정수뿐 ${precision.integerOnly.length}곳` }),
        accordion('그 밖의 한계', [
          el('div', { class: 'jr-list' }, [
            listItem({ title: '환산점수만 공개된 모집단위', detail: '기준 불일치 · 계산 불가' }),
            listItem({ title: '탐구 변환표준점수', detail: '대학 표가 없으면 가산 규칙으로만 반영' }),
            listItem({ title: '대학 공식값과 어디가 값', detail: '수준을 섞지 않고 변화량만 사용' }),
            listItem({ title: '모집단위 개편', detail: '이름이 바뀐 곳은 연도를 잇지 못함' }),
          ]),
        ]),
      ]),
      favUniversityPicker(),
      muted(`${DATA.generatedAt} · 대학 ${DATA.universities.length}곳 · 모집단위 ${DATA.universities.reduce((sum, row) => sum + row.departments.length, 0)}곳`),
    ];
  }

  // ---------------------------------------------------------------- 렌더 · 라우팅
  const VIEWS = {
    scores: renderScores, diagnose: renderDiagnose, target: renderTarget, rules: renderRules, about: renderAbout,
  };

  function renderPanel({ keepFocus } = {}) {
    const panel = document.getElementById('panel');
    const active = document.activeElement;
    const selectionStart = active && active.selectionStart;
    panel.replaceChildren();
    let children;
    try {
      children = VIEWS[state.view]();
    } catch (error) {
      children = [banner(`화면을 그리지 못했습니다: ${error.message}`, 'criticalWeak')];
    }
    for (const child of children.filter(Boolean)) panel.append(child);
    // ⓘ 로 넘어왔으면 그 절을 화면에 올린다.
    if (state.view === 'about' && state.aboutFocus) {
      const anchor = panel.querySelector?.(`#jr-about-${state.aboutFocus}`);
      state.aboutFocus = null;
      if (anchor && typeof anchor.scrollIntoView === 'function') {
        anchor.scrollIntoView({ block: 'start' });
      }
    }
    if (keepFocus === 'search') {
      const search = panel.querySelector('.jr-search input') || panel.querySelector('.jr-search');
      if (search) {
        search.focus();
        if (selectionStart !== null && selectionStart !== undefined) {
          try { search.setSelectionRange(selectionStart, selectionStart); } catch (error) { /* number 입력 등은 무시 */ }
        }
      }
    }
  }

  function syncTabs() {
    for (const tab of document.querySelectorAll('.seed-tabs__trigger')) {
      const on = tab.dataset.view === state.view;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      if (on) tab.setAttribute('data-selected', ''); else tab.removeAttribute('data-selected');
    }
    syncTabIndicator();
  }

  // 탭 밑줄. Seed 는 위치를 CSS 변수(--indicator-left/width)로 받는다.
  function syncTabIndicator() {
    const indicator = document.querySelector('.seed-tabs__indicator');
    const active = document.querySelector('.seed-tabs__trigger[data-selected]');
    if (!indicator || !active || typeof indicator.style?.setProperty !== 'function') return;
    if (!Number.isFinite(active.offsetWidth) || active.offsetWidth === 0) return;
    indicator.style.setProperty('--indicator-left', `${active.offsetLeft}px`);
    indicator.style.setProperty('--indicator-width', `${active.offsetWidth}px`);
  }

  function render() {
    syncTabs();
    renderPanel();
  }

  function go(view) {
    state.view = view;
    writeStore(STORE.view, view);
    render();
    window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------------- 테마
  const THEMES = [['system', '시스템'], ['light-only', '밝게'], ['dark-only', '어둡게']];
  // 다른 페이지 안에 얹혀 도는 경우(단일 파일 번들), 호스트가 <html data-theme="dark|light">로
  // 테마를 정한다. 그때는 우리가 고르지 않고 호스트를 따라간다.
  function hostTheme() {
    const value = document.documentElement.getAttribute?.('data-theme');
    if (value === 'dark') return 'dark-only';
    if (value === 'light') return 'light-only';
    return null;
  }
  function applyTheme(mode, { remember = true } = {}) {
    document.documentElement.setAttribute('data-seed-color-mode', mode);
    const label = THEMES.find(([value]) => value === mode)?.[1] || '시스템';
    const toggle = document.getElementById('themeToggle');
    if (toggle) {
      toggle.textContent = label;
      toggle.setAttribute('aria-label', `테마 바꾸기 — 지금 ${label}`);
    }
    if (remember) writeStore(STORE.theme, mode);
  }
  function followHostTheme() {
    const forced = hostTheme();
    const toggle = document.getElementById('themeToggle');
    if (!forced) return false;
    applyTheme(forced, { remember: false });
    if (toggle) toggle.hidden = true;
    return true;
  }

  // ---------------------------------------------------------------- 시작
  function start() {
    if (!DATA || !ENGINE) {
      document.getElementById('panel').append(banner('데이터를 불러오지 못했습니다.', 'criticalWeak'));
      return;
    }
    readQuery();

    const tabs = [...document.querySelectorAll('.seed-tabs__trigger')];
    tabs.forEach((tab, index) => {
      tab.type = 'button';
      tab.addEventListener('click', () => go(tab.dataset.view));
      tab.addEventListener('keydown', (event) => {
        const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        if (step === 0) return;
        event.preventDefault();
        const next = tabs[(index + step + tabs.length) % tabs.length];
        next.focus();
        go(next.dataset.view);
      });
    });

    const stored = readStore(STORE.theme, 'system');
    if (!followHostTheme()) applyTheme(['system', 'light-only', 'dark-only'].includes(stored) ? stored : 'system');
    // 호스트가 나중에 테마를 바꿔도 따라간다.
    if (typeof MutationObserver === 'function') {
      new MutationObserver(followHostTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }
    document.getElementById('themeToggle').addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-seed-color-mode') || 'system';
      const index = THEMES.findIndex(([value]) => value === current);
      applyTheme(THEMES[(index + 1) % THEMES.length][0]);
    });

    if (!VIEWS[state.view]) state.view = 'scores';
    render();
    // 글자 크기·창 폭이 바뀌면 탭 밑줄 자리도 다시 잡는다.
    globalThis.addEventListener?.('resize', syncTabIndicator);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
