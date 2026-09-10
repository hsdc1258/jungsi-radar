// 화면. 데이터(assets/data.js)와 엔진(assets/engine.js)을 받아 탭 하나를 통째로 그린다.
// 컴포넌트는 Seed Design recipe 클래스(.seed-*)만 쓴다 — docs/FRAME.md 밖의 패턴을 만들지 않는다.
(() => {
  'use strict';

  const DATA = globalThis.IPSI_DATA;
  const ENGINE = globalThis.IPSI_ENGINE;
  const EXAM_YEAR = '2026';

  // ---------------------------------------------------------------- 저장소
  const STORE = { scores: 'jr.scores', filters: 'jr.filters', favorites: 'jr.favorites', theme: 'jr.theme', view: 'jr.view' };
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
    filters: { track: '전체', line: '전체', band: '전체', query: '', favOnly: false, sort: 'cut', noArts: true, noDream: true, limit: 8, ...readStore(STORE.filters, {}) },
    favorites: new Set(readStore(STORE.favorites, [])),
    target: { university: '', dept: '' },
    rulesUniversity: 'snu',
    copied: false,
  };

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

  const BAND_TONE = { safe: 'positive', fit: 'brand', reach: 'neutral', stretch: 'warning', risky: 'critical', blocked: 'critical' };
  // 지원 자격이 막힌 모집단위(과탐 필수·미적분 필수 등)는 점수와 무관하게 '불가'다.
  const BLOCKED_BAND = Object.freeze({ key: 'blocked', label: '불가' });
  // 판정은 엔진이 낸 값 하나만 쓴다(ENGINE.VERDICT_BANDS). 화면이 따로 계산하지 않는다.
  const bandOf = (result) => (result?.status === 'blocked' ? BLOCKED_BAND : result?.band || null);
  // 판정 범례 한 줄. 엔진의 띠 표에서 그대로 만들어 두 화면이 같은 문장을 쓴다.
  const verdictLegend = () => {
    const bands = ENGINE.VERDICT_BANDS;
    const parts = bands.map((band, index) => {
      const upper = index === 0 ? null : bands[index - 1].min;
      if (band.min === -Infinity) return `${band.label} ${signed(upper, 1)} 미만`;
      if (upper === null) return `${band.label} ${signed(band.min, 1)} 이상`;
      return `${band.label} ${signed(band.min, 1)} ~ ${signed(upper, 1)}`;
    });
    return `차이 = 내 환산 백분위 − 예상 컷 · ${parts.join(' · ')} · 불가 지원 자격 미충족 (오차 ±는 판정을 바꾸지 않습니다)`;
  };
  // 목록에 보여 주는 순서: 안정 → 적정 → 소신 → 상향 → 위험 → 불가.
  const BAND_ORDER = ['safe', 'fit', 'reach', 'stretch', 'risky', 'blocked'];
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

  const callout = (title, description, tone = 'neutral') => el('div', {
    class: `seed-callout__root seed-callout__root--tone_${tone}`,
  }, [el('div', { class: 'seed-callout__content' }, [
    title && el('strong', { class: `seed-callout__title seed-callout__title--tone_${tone}`, text: title }),
    el('p', { class: `seed-callout__description seed-callout__description--tone_${tone}`, text: description }),
  ])]);

  const banner = (text, variant = 'neutralWeak') => el('div', {
    class: `seed-inline-banner__root seed-inline-banner__root--variant_${variant}`,
  }, [el('div', { class: 'seed-inline-banner__content' }, [
    el('p', { class: `seed-inline-banner__description seed-inline-banner__description--variant_${variant}`, text }),
  ])]);

  const listHeader = (text, suffix) => el('div', {
    class: 'seed-list-header seed-list-header--variant_boldSolid',
  }, [el('span', { text }), suffix ? el('span', { class: 'jr-muted', text: suffix }) : null]);

  // list-item 한 줄. suffix에는 뱃지·버튼이 들어간다.
  const listItem = ({ title, detail, suffix, onclick, prefix }) => {
    const tag = onclick ? 'button' : 'div';
    const node = el(tag, {
      class: 'seed-list-item__root jr-row',
      type: onclick ? 'button' : null,
      onclick,
    }, [
      prefix ? el('span', { class: 'seed-list-item__prefix' }, [prefix]) : null,
      el('span', { class: 'seed-list-item__content' }, [
        el('span', { class: 'seed-list-item__title', text: title }),
        detail ? el('span', { class: 'seed-list-item__detail', text: detail }) : null,
      ]),
      suffix ? el('span', { class: 'seed-list-item__suffix' }, [].concat(suffix)) : null,
    ]);
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
  const TRACKS = ['전체', '인문', '자연', '의약', '자유전공', '예체능'];
  const BANDS = ['전체', '안정', '적정', '소신', '상향', '위험', '불가'];

  // 등급 → 백분위 환산표. 상대평가 등급 구간의 정확한 중앙값이다 (1등급 96~100 → 98.0 …).
  // 엔진의 GRADE_FLOORS·GRADE_MIDPOINTS를 그대로 읽어 화면과 계산이 절대 어긋나지 않게 한다.
  const GRADE_TABLE = ENGINE.GRADE_MIDPOINTS.map((mid, index) => ({
    grade: index + 1,
    low: ENGINE.GRADE_FLOORS[index],
    high: index === 0 ? 100 : ENGINE.GRADE_FLOORS[index - 1],
    mid,
  }));
  const gradeMidText = (grade) => {
    const row = GRADE_TABLE[Math.min(9, Math.max(1, Math.round(Number(grade)))) - 1];
    return `${row.grade}등급 → ${fmt(row.mid, 1)}(구간 중앙)`;
  };

  // 목록에서 걸러 내는 두 가지. 토글은 기본으로 켜져 있고 localStorage에 남는다.
  //   예체능 제외    — 실기 비중이 커서 수능 컷만으로는 판정이 어려운 모집단위.
  //   말도 안되는거 제외 — 의·치·한·약·수의 최상위 모집단위와 서울대·연세대·고려대 전체.
  // 관심 목록·공유 링크로 직접 연 모집단위는 숨기지 않는다(아래 hiddenBy 호출부에서 예외).
  const DREAM_UNIVERSITIES = new Set(['snu', 'yonsei', 'korea']);
  // 간호·물리치료·보건 등은 빼지 않는다 — 의·치·한·약·수의만 본다.
  const DREAM_DEPT = /의예|의학과|치의예|치의학|한의예|한의학|약학|수의예|수의학/u;
  const isArtsDept = (dept) => dept?.track === '예체능';
  const isDreamDept = (universityId, dept) => DREAM_UNIVERSITIES.has(universityId) || DREAM_DEPT.test(String(dept?.name || ''));
  function hiddenBy(universityId, dept) {
    if (state.filters.noArts && isArtsDept(dept)) return 'arts';
    if (state.filters.noDream && isDreamDept(universityId, dept)) return 'dream';
    return null;
  }
  // 관심 학과로 담아 두었거나 지금 목표로 열어 둔 모집단위는 숨김 규칙을 비켜 간다.
  const pinned = (universityId, deptName) => state.favorites.has(deptKey(universityId, deptName))
    || (state.target.university === universityId && state.target.dept === deptName);
  const hiddenNow = (universityId, dept) => (pinned(universityId, dept.name) ? null : hiddenBy(universityId, dept));

  const profile = () => ENGINE.normalizeProfile(state.scores, DATA.scales);
  const profileReady = () => ENGINE.profileComplete(profile());

  const lineUniversities = () => {
    if (state.filters.line === '전체') return null;
    const line = DATA.lines.find((row) => row.label === state.filters.line);
    return line ? new Set(line.ids) : null;
  };

  const spreadText = (result) => {
    const cut = result.cut;
    if (!cut) return '';
    const base = `예상 컷 ${fmt(cut.value, 1)}`;
    if (typeof result.spread === 'number' && result.spread > 0) return `${base} ±${fmt(result.spread, 1)}`;
    return base;
  };

  const saveScores = () => writeStore(STORE.scores, state.scores);
  // 더 보기로 늘린 개수(limit)는 저장하지 않는다 — 새로고침했더니 목록이 수백 줄인 일을 막는다.
  const saveFilters = () => writeStore(STORE.filters, { ...state.filters, limit: undefined });
  const saveFavorites = () => writeStore(STORE.favorites, [...state.favorites]);

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
  const modeBackup = { pct: null, grade: null };
  function convertScores(from, to) {
    if (from === to) return;
    const fields = ['kor', 'math', 'inq1', 'inq2'];
    const before = {};
    for (const field of fields) before[field] = state.scores[field];
    const saved = modeBackup[to];
    for (const field of fields) {
      const raw = before[field];
      const number = Number(raw);
      if (raw === '' || raw === null || raw === undefined || !Number.isFinite(number)) { state.scores[field] = ''; continue; }
      if (to === 'grade') {
        state.scores[field] = String(ENGINE.gradeFromPercentile(Math.min(100, Math.max(0, number))));
        continue;
      }
      const back = Number(saved?.[field]);
      const untouched = Number.isFinite(back) && String(ENGINE.gradeFromPercentile(back)) === String(Math.round(number));
      state.scores[field] = untouched ? String(saved[field]) : String(ENGINE.percentileFromGrade(number));
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

  function renderScores() {
    const isGrade = state.scores.mode === 'grade';
    const unit = isGrade ? '등급' : '백분위';
    const modeControl = el('div', {
      class: 'seed-segmented-control__root jr-segmented',
      role: 'radiogroup',
      'aria-label': '입력 기준',
      style: '--segment-count:2;--segment-index:' + (isGrade ? 1 : 0),
    }, [
      el('span', { class: 'seed-segmented-control__indicator', 'aria-hidden': 'true' }),
      ...[['pct', '백분위'], ['grade', '등급']].map(([value, label]) => el('button', {
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

    const numberFor = (field, label) => numberInput(state.scores[field], (value) => setScore(field, value), {
      id: `jr-${field}`,
      label: `${label} ${unit}`,
      min: isGrade ? 1 : 0,
      max: isGrade ? 9 : 100,
      step: isGrade ? 1 : 0.5,
      placeholder: unit,
    });

    const rows = section([
      listHeader('영역별 성적', `${unit} 입력`),
      el('div', { class: 'jr-list jr-inputs' }, [
        inputRow('국어', [
          select(KOR_ELECTIVES, state.scores.korElective, (value) => setScore('korElective', value), '국어 선택과목'),
          numberFor('kor', '국어'),
        ], null, 'jr-kor'),
        inputRow('수학', [
          select(MATH_ELECTIVES, state.scores.mathElective, (value) => setScore('mathElective', value), '수학 선택과목'),
          numberFor('math', '수학'),
        ], null, 'jr-math'),
        inputRow('영어', [select(GRADES, state.scores.eng, (value) => setScore('eng', value), '영어 등급', 'jr-eng')], '등급', 'jr-eng'),
        inputRow('한국사', [select(GRADES, state.scores.hist, (value) => setScore('hist', value), '한국사 등급', 'jr-hist')], '등급', 'jr-hist'),
        inputRow('탐구 1', [
          select(INQ_SUBJECTS, state.scores.inq1Subject, (value) => setScore('inq1Subject', value), '탐구 1 과목'),
          numberFor('inq1', '탐구 1'),
        ], null, 'jr-inq1'),
        inputRow('탐구 2', [
          select(INQ_SUBJECTS, state.scores.inq2Subject, (value) => setScore('inq2Subject', value), '탐구 2 과목'),
          numberFor('inq2', '탐구 2'),
        ], null, 'jr-inq2'),
      ]),
    ]);

    const gpa = section([
      listHeader('내신 등급', '선택'),
      el('div', { class: 'jr-list jr-inputs' }, [
        inputRow('학생부 교과 평균', [numberInput(state.scores.gpa, (value) => setScore('gpa', value), {
          id: 'jr-gpa', label: '내신 등급', min: 1, max: 9, step: 0.01, placeholder: '등급',
        })], '수시 참고용', 'jr-gpa'),
      ]),
    ]);

    const summary = el('div', { class: 'jr-summary' });
    // 등급 입력일 때 "2등급 → 92.5(구간 중앙)" 처럼 무엇으로 바뀌었는지 그 자리에서 보여 준다.
    const conversion = el('div', { class: 'jr-summary' });
    const gradeTable = isGrade ? accordion('등급 → 백분위 환산표', [
      muted('상대평가 등급 구간의 정확한 중앙값을 씁니다. 백분위 ↔ 등급을 오갈 때도 같은 표입니다.'),
      table(['등급', '백분위 구간', '환산 백분위'],
        GRADE_TABLE.map((row) => [`${row.grade}등급`, `${fmt(row.low, 0)} ~ ${fmt(row.high, 0)}`, fmt(row.mid, 1)])),
    ]) : null;
    const actionButton = button('진단 보기', {
      variant: 'brandSolid', size: 'large',
      onclick: () => { if (profileReady()) go('diagnose'); },
    });
    // 숫자를 고칠 때마다 요약과 버튼만 다시 그린다.
    liveRefresh = () => {
      const current = profile();
      const average = ENGINE.simpleAverage(current);
      const note = state.scores.mode === 'grade'
        ? '등급 구간의 정중앙 백분위로 바꾼 값입니다.'
        : '어디가 공개값과 같은 기준입니다.';
      summary.replaceChildren(average === null
        ? banner('국어·수학·탐구를 채우면 진단이 열립니다.')
        : callout('국·수·탐 평균', `${fmt(average, 2)} 백분위 — ${note}`, 'informative'));
      if (state.scores.mode === 'grade') {
        const parts = [['kor', '국어'], ['math', '수학'], ['inq1', '탐구 1'], ['inq2', '탐구 2']]
          .filter(([field]) => String(state.scores[field] ?? '').trim() !== '' && Number.isFinite(Number(state.scores[field])))
          .map(([field, label]) => `${label} ${gradeMidText(state.scores[field])}`);
        conversion.replaceChildren(parts.length > 0
          ? callout('등급 → 백분위 환산', parts.join(' · '), 'neutral')
          : banner('등급을 넣으면 구간 중앙 백분위로 바꿔 보여 줍니다.'));
      } else {
        conversion.replaceChildren();
      }
      if (ENGINE.profileComplete(current)) {
        actionButton.removeAttribute('disabled');
        actionButton.setAttribute('aria-disabled', 'false');
      } else {
        actionButton.setAttribute('disabled', '');
        actionButton.setAttribute('aria-disabled', 'true');
      }
    };

    const share = el('div', { class: 'jr-actions' }, [
      button(state.copied === true ? '링크를 복사했습니다' : '성적 링크 복사', {
        variant: 'neutralOutline',
        onclick: async () => {
          state.copied = (await copyText(shareUrl())) ? true : 'failed';
          render();
          setTimeout(() => {
            if (state.copied === true) { state.copied = false; if (state.view === 'scores') render(); }
          }, 4000);
        },
      }),
      button('입력 지우기', {
        variant: 'ghost',
        onclick: () => { state.scores = { ...EMPTY_SCORES }; saveScores(); render(); },
      }),
    ]);

    // 복사가 막힌 환경에서는 링크를 직접 골라 갈 수 있게 띄운다.
    const fallback = state.copied === 'failed'
      ? section([
        banner('브라우저가 복사를 막았습니다. 아래 주소를 길게 눌러 복사하세요.', 'criticalWeak'),
        textInput({ type: 'text', value: shareUrl(), readonly: true, 'aria-label': '성적 공유 주소', onclick: (event) => event.target.select?.() }, 'jr-search'),
      ])
      : null;

    const action = el('div', { class: 'jr-sticky-action' }, [actionButton]);

    liveRefresh();
    return [modeControl, summary, conversion, gradeTable, rows, gpa, share, fallback, action].filter(Boolean);
  }

  // ---------------------------------------------------------------- 진단 화면
  // 대학 40곳·모집단위 1,800여 곳을 매 렌더마다 다시 판정하면 필터 한 번에 100ms를 넘긴다.
  // 성적·계열·라인·정렬이 그대로면 지난 결과를 그대로 쓴다('더 보기'와 검색은 이 뒤에서 거른다).
  let diagnoseCache = { key: null, rows: null };
  function diagnoseAll() {
    const key = JSON.stringify([state.scores, state.filters.track, state.filters.line, state.filters.sort]);
    if (diagnoseCache.key !== key) {
      diagnoseCache = {
        key,
        rows: ENGINE.diagnose(profile(), DATA, {
          track: state.filters.track,
          universities: lineUniversities(),
          // 기본은 예상 컷 내림차순 — 갈 수 있는 가장 높은 곳부터 낮은 곳까지.
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
    return rows.filter((row) => {
      if (row.jeongsi.status === 'no-cut' || row.jeongsi.status === 'no-profile') return false;
      if (hiddenNow(row.universityId, row.dept)) return false;
      if (state.filters.band !== '전체' && bandOf(row.jeongsi)?.label !== state.filters.band) return false;
      if (state.filters.favOnly && !state.favorites.has(deptKey(row.universityId, row.dept.name))) return false;
      if (query && !(`${row.universityName} ${row.dept.name}`).includes(query)) return false;
      return true;
    });
  }

  function favoriteButton(universityId, deptName) {
    const key = deptKey(universityId, deptName);
    const on = state.favorites.has(key);
    return el('button', {
      type: 'button',
      class: `seed-action-button seed-action-button--variant_${on ? 'neutralSolid' : 'neutralOutline'} seed-action-button--size_xsmall seed-action-button--layout_withText seed-action-button--size_xsmall-layout_withText jr-fav`,
      'aria-pressed': String(on),
      'aria-label': `${deptName} 관심 학과 ${on ? '해제' : '저장'}`,
      onclick: (event) => {
        event.stopPropagation();
        if (on) state.favorites.delete(key); else state.favorites.add(key);
        saveFavorites();
        render();
      },
    }, ['관심']);
  }

  function renderDiagnose() {
    if (!profileReady()) {
      return [banner('성적 탭에서 국어·수학·탐구를 먼저 입력하세요.', 'criticalWeak'),
        el('div', { class: 'jr-actions' }, [button('성적 입력하러 가기', { variant: 'brandSolid', onclick: () => go('scores') })])];
    }
    const rows = diagnoseRows();
    const average = ENGINE.simpleAverage(profile());

    const trackTabs = el('div', { class: 'seed-chip-tabs__list seed-chip-tabs__list--size_medium jr-chips-tabs', role: 'tablist', 'aria-label': '계열' }, TRACKS.map((track) => el('button', {
      type: 'button', role: 'tab',
      'aria-selected': String(state.filters.track === track),
      'data-selected': state.filters.track === track ? '' : null,
      class: 'seed-chip-tabs__trigger seed-chip-tabs__trigger--size_medium seed-chip-tabs__trigger--variant_neutralOutline',
      onclick: () => {
        state.filters.track = track;
        // 예체능을 골랐는데 '예체능 제외'가 켜져 있으면 아무것도 안 남는다 — 함께 꺼 준다.
        if (track === '예체능') state.filters.noArts = false;
        state.filters.limit = 8;
        saveFilters();
        render();
      },
    }, [track])));
    // 토글 칩. 계열 칩과 같은 줄에 둔다.
    const toggleChip = (label, on, onclick) => el('button', {
      type: 'button',
      'aria-pressed': String(on),
      'data-selected': on ? '' : null,
      class: 'seed-chip-tabs__trigger seed-chip-tabs__trigger--size_medium seed-chip-tabs__trigger--variant_neutralOutline',
      onclick,
    }, [label]);
    const chips = el('div', { class: 'jr-chips' }, [
      trackTabs,
      toggleChip('예체능 제외', state.filters.noArts, () => {
        state.filters.noArts = !state.filters.noArts;
        if (state.filters.noArts && state.filters.track === '예체능') state.filters.track = '전체';
        state.filters.limit = 8;
        saveFilters();
        render();
      }),
      toggleChip('말도 안되는거 제외', state.filters.noDream, () => {
        state.filters.noDream = !state.filters.noDream;
        state.filters.limit = 8;
        saveFilters();
        render();
      }),
    ]);

    const filters = el('div', { class: 'jr-filters' }, [
      select([['전체', '라인 전체'], ...DATA.lines.map((line) => [line.label, line.label])], state.filters.line,
        (value) => { state.filters.line = value; state.filters.limit = 8; saveFilters(); render(); }, '대학 라인'),
      select(BANDS.map((band) => [band, band === '전체' ? '판정 전체' : band]), state.filters.band,
        (value) => { state.filters.band = value; state.filters.limit = 8; saveFilters(); render(); }, '판정'),
      select(SORTS, state.filters.sort,
        (value) => { state.filters.sort = value; state.filters.limit = 8; saveFilters(); render(); }, '정렬'),
      textInput({
        type: 'search', value: state.filters.query, placeholder: '대학·학과 검색', 'aria-label': '대학·학과 검색',
        oninput: (event) => {
          state.filters.query = event.target.value;
          state.filters.limit = 8;
          saveFilters();
          renderPanel({ keepFocus: 'search' });
        },
      }, 'jr-search'),
      button(state.filters.favOnly ? '관심만 보기 켬' : '관심만 보기', {
        variant: state.filters.favOnly ? 'neutralSolid' : 'neutralOutline', size: 'small',
        onclick: () => { state.filters.favOnly = !state.filters.favOnly; saveFilters(); render(); },
        attrs: { 'aria-pressed': String(state.filters.favOnly) },
      }),
    ]);

    const legend = el('p', { class: 'jr-muted jr-legend', text: verdictLegend() });
    const sortNote = state.filters.sort === 'band' ? '판정별로 묶어' : '지원 가능한 곳부터 예상 컷 높은 순으로';
    const hiddenNote = [state.filters.noArts ? '예체능' : null, state.filters.noDream ? '의·치·한·약·수의와 서·연·고' : null]
      .filter(Boolean).join('·');
    const summary = callout('내 국·수·탐 평균',
      `${fmt(average, 2)} 백분위 · 조건에 맞는 모집단위 ${rows.length}곳을 ${sortNote} 봅니다 · 관심 ${state.favorites.size}곳${hiddenNote ? ` · ${hiddenNote} 제외` : ''}`, 'informative');

    const note = state.filters.track === '예체능'
      ? banner('예체능은 실기 비중이 커서 수능 컷만으로는 판정이 어렵습니다. 참고로만 보세요.')
      : null;

    if (rows.length === 0) {
      const off = [state.filters.noArts ? '예체능 제외' : null, state.filters.noDream ? '말도 안되는거 제외' : null].filter(Boolean);
      const empty = state.filters.favOnly && state.favorites.size === 0
        ? '관심 학과가 아직 없습니다. 목록에서 관심을 눌러 담아 보세요.'
        : off.length > 0
          ? `조건에 맞는 모집단위가 없습니다. 필터를 넓히거나 ${off.join('·')} 토글을 꺼 보세요.`
          : '조건에 맞는 모집단위가 없습니다. 필터를 넓혀 보세요.';
      return [summary, chips, filters, note, banner(empty)].filter(Boolean);
    }

    const rowItem = (row) => {
      const result = row.jeongsi;
      const band = bandOf(result);
      const detail = result.status === 'blocked'
        ? `${result.score.blockers[0]} · ${spreadText(result)}`
        : `${spreadText(result)} · 내 환산 ${fmt(result.mine, 1)}${result.group ? ` · ${result.group}군` : ''}`;
      return listItem({
        title: `${row.universityName} ${deptLabel(row.dept.name)}`,
        detail,
        suffix: [
          el('span', { class: 'jr-gap num', text: signed(result.gap, 1) }),
          badge(band.label, BAND_TONE[band.key]),
          favoriteButton(row.universityId, row.dept.name),
        ],
        onclick: () => {
          state.target = { university: row.universityId, dept: row.dept.name };
          go('target');
        },
      });
    };

    const total = rows.length;
    const blocks = [];
    let shown = 0;
    let moreLabel = '';

    if (state.filters.sort === 'band') {
      // 판정별 보기에서만 머리글을 쓴다. 머리글과 그 안의 뱃지는 언제나 같은 판정이다.
      const bucket = new Map(BAND_ORDER.map((key) => [key, []]));
      for (const row of rows) bucket.get(bandOf(row.jeongsi).key)?.push(row);
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
      moreLabel = `더 보기 (판정별 ${state.filters.limit}곳씩 · 남은 ${total - shown}곳)`;
    } else {
      // 높은 순: 머리글 없는 한 목록. 지원 가능한 곳(안정·적정·소신)을 예상 컷 높은 순으로 먼저
      // 늘어놓고, 그 뒤에 상향·위험·불가를 같은 방식으로 잇는다. 판정은 행마다 뱃지가 말한다.
      const reachable = rows.filter((row) => REACHABLE_BANDS.includes(bandOf(row.jeongsi).key));
      const hard = rows.filter((row) => !REACHABLE_BANDS.includes(bandOf(row.jeongsi).key));
      const ordered = [...reachable, ...hard];
      const slice = ordered.slice(0, state.filters.limit * 2);
      shown = slice.length;
      if (slice.length > 0) blocks.push(el('div', { class: 'jr-section' }, [el('div', { class: 'jr-list' }, slice.map(rowItem))]));
      moreLabel = `더 보기 (남은 ${total - shown}곳)`;
    }

    const more = shown < total
      ? el('div', { class: 'jr-actions' }, [button(moreLabel, {
        variant: 'neutralWeak',
        onclick: () => { state.filters.limit += 8; saveFilters(); render(); },
      })])
      : null;

    return [summary, legend, chips, filters, note, ...blocks, more].filter(Boolean);
  }

  // ---------------------------------------------------------------- 목표 화면
  // 목표 탭에서 고를 수 있는 대학·모집단위. 진단 목록과 같은 숨김 규칙을 따르되,
  // 지금 열어 둔 곳과 관심 학과는 늘 남긴다(공유 링크로 바로 들어온 경우를 위해).
  const targetDepartments = (university) => {
    const rows = (university.departments || []).filter((dept) => !hiddenNow(university.id, dept));
    return rows.length > 0 ? rows : university.departments || [];
  };
  const targetUniversities = () => {
    const rows = DATA.universities.filter((university) => targetDepartments(university).some((dept) => !hiddenNow(university.id, dept)));
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
      return [banner('성적을 먼저 입력하면 목표 학과를 계산합니다.', 'criticalWeak'),
        el('div', { class: 'jr-actions' }, [button('성적 입력하러 가기', { variant: 'brandSolid', onclick: () => go('scores') })])];
    }
    const picked = currentTarget();
    if (!picked) return [banner('데이터를 불러오지 못했습니다.', 'criticalWeak')];
    const { university, dept } = picked;
    state.target = { university: university.id, dept: dept.name };

    const universityOptions = targetUniversities();
    if (!universityOptions.some((row) => row.id === university.id)) universityOptions.unshift(university);
    const deptOptions = targetDepartments(university);
    if (!deptOptions.some((row) => row.name === dept.name)) deptOptions.unshift(dept);
    const pickers = el('div', { class: 'jr-filters' }, [
      select(universityOptions.map((row) => [row.id, `${row.short} (${row.line})`]), university.id, (value) => {
        state.target = { university: value, dept: '' };
        render();
      }, '대학'),
      select(deptOptions.map((row) => [row.name, deptLabel(row.name)]), dept.name, (value) => {
        state.target = { university: university.id, dept: value };
        render();
      }, '모집단위'),
    ]);

    const target = ENGINE.analyzeTarget(profile(), university, dept, DATA.rules[university.id], university.volatility ?? DATA.volatility);
    if (target.status === 'no-cut') {
      return [pickers, banner('이 모집단위는 백분위로 공개된 정시 결과가 없어 판정을 보류합니다.', 'neutralWeak'),
        renderBasis(dept, target)];
    }

    const targetBand = bandOf(target);
    const verdict = el('div', { class: 'jr-verdict' }, [
      el('p', { class: 'jr-muted', text: `${university.short} ${deptLabel(dept.name)} · ${dept.track}` }),
      el('p', { class: 'jr-verdict-number', text: signed(target.gap, 1) }),
      el('p', {}, [badge(targetBand.label, BAND_TONE[targetBand.key]), el('span', { class: 'jr-verdict-note', text: ` 내 환산 ${fmt(target.mine, 1)} · ${spreadText(target)}` })]),
      el('p', { class: 'jr-muted', text: `${target.cut.kind} 기준${target.cut.derived ? ' (지난해 값은 대학 공식 발표의 연도 변화량으로 맞춘 값)' : ''}` }),
    ]);

    const plan = target.plan;
    const planBlock = plan ? section([
      listHeader('필요한 상승', plan.need > 0 ? `적정까지 ${fmt(plan.need, 1)}점` : '이미 적정 위'),
      el('div', { class: 'jr-list' }, [
        ...plan.subjects.map((subject) => listItem({
          title: subject.label,
          detail: plan.need > 0
            ? (subject.reachable
              ? `${fmt(subject.current, 1)} → ${fmt(subject.targetPct, 1)} (이 영역만 올릴 때)`
              : `100까지 올려도 ${fmt(subject.shortfall, 1)}점 모자랍니다 (현재 ${fmt(subject.current, 1)})`)
            : `현재 ${fmt(subject.current, 1)} · 반영 비중 ${Math.round(subject.share * 100)}%`,
          suffix: plan.best && plan.best.key === subject.key && plan.need > 0
            ? badge('추천', 'brand')
            : el('span', { class: 'jr-muted num', text: `비중 ${Math.round(subject.share * 100)}%` }),
        })),
        plan.uniform > 0 ? listItem({
          title: '모든 영역 균등 상승',
          detail: `전 영역을 ${fmt(plan.uniform, 1)}점씩 올리면 적정선에 닿습니다.`,
        }) : null,
        plan.english && plan.english.steps.length > 0 ? listItem({
          title: `영어 ${plan.english.current}등급 상승 효과`,
          detail: plan.english.steps.map((step) => `${step.grade}등급 ${signed(step.gain, 2)}`).join(' · '),
          suffix: plan.english.enough ? badge(`${plan.english.enough.grade}등급이면 충분`, 'positive') : null,
        }) : null,
      ].filter(Boolean)),
    ]) : null;

    const notes = [];
    if (plan && plan.blockers.length > 0) notes.push(callout('지원 제한', plan.blockers.join(' · '), 'critical'));
    if (plan && plan.adjustments.length > 0) {
      notes.push(callout('선택과목·가감점',
        plan.adjustments.map((row) => `${row.label} ${signed(row.delta, 2)}`).join(' · '), 'warning'));
    }
    if (target.score?.bestOfNotes?.length > 0) {
      notes.push(callout('우수 영역 순 반영', target.score.bestOfNotes.join(' · '), 'neutral'));
    }

    const compare = renderCompare(university, dept);

    return [pickers, verdict, planBlock, ...notes, renderBasis(dept, target), renderSusi(target), compare].filter(Boolean);
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
    for (const [year, row] of Object.entries(dept.jeongsi || {}).sort().reverse()) {
      meta.push([`${year}학년도`, row.quota ?? '—', row.rate ?? '—', row.fill ?? '—', row.group ? `${row.group}군` : '—']);
    }
    const officialRows = Object.entries(dept.official || {}).sort().reverse().map(([year, row]) => [
      `${year}학년도`, fmt(row.cut70 ?? row.avg, 2), row.kind || '—', row.note || '',
    ]);

    return accordion('기준이 된 숫자', [
      yearRows.length > 0 ? table(['연도', '컷', '종류', '출처'], yearRows) : muted('연도별 컷 자료가 없습니다.'),
      meta.length > 0 ? table(['연도', '모집인원', '경쟁률', '충원', '군'], meta) : null,
      officialRows.length > 0 ? el('div', {}, [
        el('p', { class: 'jr-muted', text: '대학이 직접 낸 값(정의가 대학마다 다릅니다)' }),
        table(['연도', '값', '종류', '설명'], officialRows),
      ]) : null,
      reference.primary?.url ? el('p', { class: 'jr-muted' }, [
        el('a', { href: reference.primary.url, target: '_blank', rel: 'noreferrer noopener', text: '출처 열기' }),
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
        detail: `${result.year}학년도 70%컷 ${fmt(result.cut, 2)}등급 · 내 내신과의 차이 ${signed(result.gap, 2)}`,
        suffix: badge(result.band.label, BAND_TONE[result.band.key]),
      }));
    }
    if (rows.length === 0) {
      const gpa = ENGINE.normalizeProfile(state.scores, DATA.scales).gpa;
      return accordion('수시 참고', [muted(gpa === null
        ? '내신 등급을 입력하면 같은 학과의 수시 컷과 비교합니다.'
        : '이 모집단위는 어디가에 공개된 수시 결과가 없습니다.')]);
    }
    return accordion('수시 참고', [el('div', { class: 'jr-list' }, rows)]);
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
    if (!picks.some((row) => row.university.id === university.id && row.dept.name === dept.name) && picks.length < 3) {
      picks.unshift({ university, dept });
    }
    // 진단 목록과 같은 숨김 규칙. 관심 학과와 지금 보는 곳은 pinned 라 그대로 남는다.
    const visible = picks.filter((pick) => !hiddenNow(pick.university.id, pick.dept));
    picks.length = 0;
    picks.push(...visible);
    if (picks.length < 2) {
      return section([
        listHeader('비교'),
        banner('진단 화면에서 관심 학과를 두 곳 이상 저장하면 같은 성적으로 나란히 비교합니다.'),
      ]);
    }
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
        result.mine === undefined ? '—' : fmt(result.mine, 1),
        result.gap === undefined ? '—' : signed(result.gap, 1),
        bandOf(result) ? badge(bandOf(result).label, BAND_TONE[bandOf(result).key]) : '—',
      ]);
    return section([
      listHeader('비교', `관심 학과 ${picks.length}곳 · 예상 컷 높은 순`),
      table(['모집단위', '예상 컷', '내 환산', '차이', '판정'], rows),
    ]);
  }

  // ---------------------------------------------------------------- 반영 화면
  function renderRules() {
    const universityId = state.rulesUniversity;
    const university = universityById.get(universityId) || DATA.universities[0];
    const rule = DATA.rules[university.id];

    const picker = el('div', { class: 'jr-filters' }, [
      select(DATA.universities.map((row) => [row.id, `${row.short} (${row.line})`]), university.id, (value) => {
        state.rulesUniversity = value;
        render();
      }, '대학'),
    ]);

    if (!rule) return [picker, banner('이 대학의 반영 방법 자료가 없습니다.')];

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
    return [
      picker,
      section([listHeader(`${university.name} 정시 수능 반영`, `${rule.year || 2027}학년도`), ...trackBlocks]),
      rule.changes2027 ? callout('2027학년도 변경', prose(rule.changes2027), 'informative') : null,
      cutRows.length > 0 ? section([
        listHeader(`${EXAM_YEAR}학년도 수능 선택과목 원점수 컷`, exam.status === 'final' ? '실채점 확정' : '가채점 예상'),
        el('div', { class: 'jr-list' }, cutRows.map(([subject, first, second, third, maxStd]) => listItem({
          title: subject,
          detail: `1등급 ${first} · 2등급 ${second} · 3등급 ${third}`,
          suffix: el('span', { class: 'jr-muted num', text: `만점 표준점수 ${maxStd}` }),
        }))),
      ]) : null,
      accordion('2027학년도 수능 체제', [
        muted(DATA.scales?.policy2027?.summary || '공통+선택 체제가 유지됩니다.'),
        ...(DATA.scales?.policy2027?.sources || []).map((row) => el('p', { class: 'jr-muted' }, [
          el('a', { href: row.url, target: '_blank', rel: 'noreferrer noopener', text: row.title }),
        ])),
      ]),
      source ? el('p', { class: 'jr-muted' }, [
        el('a', { href: source.url, target: '_blank', rel: 'noreferrer noopener', text: source.title }),
      ]) : null,
    ].filter(Boolean);
  }

  // ---------------------------------------------------------------- 정보 화면
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

  function renderAbout() {
    const sources = [
      DATA.sources?.results && { title: DATA.sources.results.title, url: DATA.sources.results.url, note: DATA.sources.results.note },
      DATA.sources?.rules && { title: DATA.sources.rules.title, url: DATA.sources.rules.url, note: DATA.sources.rules.note },
      ...(DATA.scales?.exams?.[EXAM_YEAR]?.sources || []).map((row) => ({ title: row.title, url: row.url })),
    ].filter(Boolean);

    const universitySources = DATA.universities
      .filter((university) => university.departments.some((dept) => Object.keys(dept.official || {}).length > 0))
      .map((university) => `${university.short} (${university.volatility === null ? '연도 변동폭 없음' : `연도 변동폭 ±${fmt(university.volatility, 1)}`})`);

    const unconfirmed = unconfirmedNotes();

    return [
      callout('판정 기준', verdictLegend(), 'informative'),
      section([
        listHeader('판정 표', '경계값은 위쪽 판정에 든다'),
        table(['판정', '차이 (내 환산 − 예상 컷)'], ENGINE.VERDICT_BANDS.map((band, index, all) => [
          band.label,
          band.min === -Infinity
            ? `${signed(all[index - 1].min, 1)} 미만`
            : index === 0 ? `${signed(band.min, 1)} 이상` : `${signed(band.min, 1)} 이상 ${signed(all[index - 1].min, 1)} 미만`,
        ]).concat([['불가', '지원 자격 미충족 (과탐 필수·미적분 필수 등)']])),
        muted('차이는 소수 첫째 자리로 반올림한 값이고, 그 값으로 판정합니다. 오차(±)는 판정을 바꾸지 않습니다.'),
      ]),
      section([
        listHeader('계산 방법'),
        el('div', { class: 'jr-list' }, [
          listItem({ title: '기준값', detail: '가용한 연도의 컷을 최근 순 0.6·0.3·0.1로 가중 평균한 값입니다.' }),
          listItem({ title: '오차', detail: '연도별 최소~최대 폭의 절반입니다. 한 해뿐이면 그 대학 학과들의 연도별 표준편차 중앙값을 씁니다.' }),
          listItem({ title: '내 환산', detail: '대학별 영역 반영비율로 가중 평균한 뒤 영어·한국사 가감점과 선택과목 가산을 백분위 단위로 더합니다.' }),
          listItem({ title: '등급 입력', detail: `등급은 그 구간의 정중앙 백분위로 바꿉니다 (${GRADE_TABLE.map((row) => `${row.grade}등급 ${fmt(row.mid, 1)}`).join(' · ')}).` }),
        ]),
      ]),
      accordion('등급 → 백분위 환산표', [
        muted('상대평가 등급 구간의 정확한 중앙값입니다. 백분위 ↔ 등급을 오갈 때도 같은 표를 씁니다.'),
        table(['등급', '백분위 구간', '환산 백분위'],
          GRADE_TABLE.map((row) => [`${row.grade}등급`, `${fmt(row.low, 0)} ~ ${fmt(row.high, 0)}`, fmt(row.mid, 1)])),
      ]),
      section([
        listHeader('출처'),
        el('div', { class: 'jr-list' }, sources.map((row) => listItem({
          title: row.title,
          detail: row.note || String(row.url || '').replace(/^https?:\/\//u, '').split('/')[0],
          suffix: el('a', { class: 'jr-link', href: row.url, target: '_blank', rel: 'noreferrer noopener', text: '열기' }),
        }))),
      ]),
      section([
        listHeader('대학 공식 입시결과를 함께 쓴 대학'),
        universitySources.length > 0 ? muted(universitySources.join(' · ')) : muted('없음'),
      ]),
      accordion(`한계 — 아직 확인하지 못한 규칙 ${unconfirmed.length}건`, [
        muted('아래 항목은 시행계획 원문에서 값을 찾지 못해 비워 두거나 가정했습니다. 판정에 그만큼 오차가 있습니다.'),
        el('div', { class: 'jr-list' }, unconfirmed.map((note) => listItem({ title: note }))),
      ]),
      accordion('어디가 값의 정밀도', [
        muted('우리가 쓰는 어디가 70%컷은 집계 페이지가 정수로만 싣습니다. 대학이 낸 원값은 소수 둘째 자리까지 있어(경희대 의예 98.95 등) 최대 1점 가까이 차이가 납니다.'),
        muted('표본 105곳을 대학 공식 발표와 대조해 95곳을 원값으로 고쳤고, 그중 50곳은 0.5점을 넘게 달랐습니다. 나머지 모집단위는 아직 정수 값 그대로입니다 — 판정이 한 칸 옮겨 갈 수 있습니다.'),
      ]),
      accordion('그 밖의 한계', [
        el('div', { class: 'jr-list' }, [
          listItem({ title: '환산점수만 공개된 모집단위', detail: '백분위로 되돌리면 오차가 커서 판정을 보류합니다.' }),
          listItem({ title: '탐구 변환표준점수', detail: '대학이 표를 공개하지 않아 가산 규칙으로만 반영합니다.' }),
          listItem({ title: '대학이 낸 값과 어디가 값', detail: '정의가 달라 수준을 섞지 않고, 연도 사이 변화량만 빌려 씁니다.' }),
          listItem({ title: '모집단위 개편', detail: '연도별로 이름이 바뀐 모집단위는 이어 붙이지 못한 경우가 있습니다.' }),
        ]),
      ]),
      muted(`데이터 생성일 ${DATA.generatedAt} · 대학 ${DATA.universities.length}곳 · 모집단위 ${DATA.universities.reduce((sum, row) => sum + row.departments.length, 0)}곳`),
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
