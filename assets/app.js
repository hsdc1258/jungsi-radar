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
    eng: '2', hist: '3',
    inq1Subject: '생활과윤리', inq1: '',
    inq2Subject: '사회문화', inq2: '',
    gpa: '',
  };
  const state = {
    view: readStore(STORE.view, 'scores'),
    scores: { ...EMPTY_SCORES, ...readStore(STORE.scores, {}) },
    filters: { track: '전체', line: '전체', band: '전체', query: '', favOnly: false, limit: 8, ...readStore(STORE.filters, {}) },
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
  const fmt = (value, digits = 1) => (typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—');
  const muted = (text) => el('p', { class: 'jr-muted', text });

  const BAND_TONE = { safe: 'positive', fit: 'brand', reach: 'neutral', stretch: 'warning', risky: 'critical' };
  // 목록에 보여 주는 순서. 결정에 가장 도움이 되는 '적정·소신'을 위에 둔다.
  const BAND_ORDER = ['fit', 'reach', 'stretch', 'safe', 'risky'];
  const badge = (label, tone = 'neutral') => el('span', {
    class: `seed-badge__root seed-badge__root--size_medium seed-badge__root--variant_weak seed-badge__root--tone_${tone}-variant_weak`,
  }, [el('span', { class: 'seed-badge__label', text: label })]);

  const button = (label, { variant = 'neutralWeak', size = 'medium', onclick, attrs = {} } = {}) => el('button', {
    type: 'button',
    class: `seed-action-button seed-action-button--variant_${variant} seed-action-button--size_${size} seed-action-button--layout_withText seed-action-button--size_${size}-layout_withText`,
    onclick,
    ...attrs,
  }, [label]);

  const select = (options, value, onchange, label) => {
    const node = el('select', {
      class: 'seed-select-trigger__root seed-select-trigger__root--size_medium jr-select',
      'aria-label': label,
      onchange: (event) => onchange(event.target.value),
    });
    for (const option of options) {
      const [optionValue, optionLabel] = Array.isArray(option) ? option : [option, option];
      node.append(el('option', { value: optionValue, selected: String(optionValue) === String(value) }, [optionLabel]));
    }
    return node;
  };

  const numberInput = (value, onchange, { label, min = 0, max = 100, step = 1, placeholder = '' }) => el('input', {
    type: 'number', value, min, max, step, placeholder, inputmode: 'decimal',
    'aria-label': label,
    class: 'seed-text-input__root seed-text-input__root--variant_outline seed-text-input__root--size_medium jr-number',
    oninput: (event) => onchange(event.target.value),
  });

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
  const deptKey = (universityId, deptName) => `${universityId}::${deptName}`;
  const TRACKS = ['전체', '인문', '자연', '의약', '자유전공', '예체능'];
  const BANDS = ['전체', '안정', '적정', '소신', '상향', '위험'];

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
    if (typeof result.spread === 'number' && result.spread > 0) return `${base} ± ${fmt(result.spread, 1)}`;
    return base;
  };

  const saveScores = () => writeStore(STORE.scores, state.scores);
  const saveFilters = () => writeStore(STORE.filters, state.filters);
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
  const GRADES = Array.from({ length: 9 }, (unused, index) => [String(index + 1), `${index + 1}등급`]);

  function inputRow(label, controls, hint) {
    return el('div', { class: 'jr-input-row' }, [
      el('span', { class: 'jr-input-label' }, [label, hint ? el('span', { class: 'jr-muted', text: ` ${hint}` }) : null]),
      el('span', { class: 'jr-input-controls' }, [].concat(controls)),
    ]);
  }

  function setScore(field, value) {
    state.scores[field] = value;
    saveScores();
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
        onclick: () => { setScore('mode', value); render(); },
      }, [label])),
    ]);

    const numberFor = (field, label) => numberInput(state.scores[field], (value) => setScore(field, value), {
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
          select(KOR_ELECTIVES, state.scores.korElective, (value) => { setScore('korElective', value); }, '국어 선택과목'),
          numberFor('kor', '국어'),
        ]),
        inputRow('수학', [
          select(MATH_ELECTIVES, state.scores.mathElective, (value) => { setScore('mathElective', value); }, '수학 선택과목'),
          numberFor('math', '수학'),
        ]),
        inputRow('영어', [select(GRADES, state.scores.eng, (value) => setScore('eng', value), '영어 등급')], '등급'),
        inputRow('한국사', [select(GRADES, state.scores.hist, (value) => setScore('hist', value), '한국사 등급')], '등급'),
        inputRow('탐구 1', [
          select(INQ_SUBJECTS, state.scores.inq1Subject, (value) => setScore('inq1Subject', value), '탐구 1 과목'),
          numberFor('inq1', '탐구 1'),
        ]),
        inputRow('탐구 2', [
          select(INQ_SUBJECTS, state.scores.inq2Subject, (value) => setScore('inq2Subject', value), '탐구 2 과목'),
          numberFor('inq2', '탐구 2'),
        ]),
      ]),
    ]);

    const gpa = section([
      listHeader('내신 등급', '선택'),
      el('div', { class: 'jr-list jr-inputs' }, [
        inputRow('학생부 교과 평균', [numberInput(state.scores.gpa, (value) => setScore('gpa', value), {
          label: '내신 등급', min: 1, max: 9, step: 0.01, placeholder: '등급',
        })], '수시 참고용'),
      ]),
    ]);

    const average = ENGINE.simpleAverage(profile());
    const summary = average === null
      ? banner('국어·수학·탐구를 채우면 진단이 열립니다.')
      : callout('국·수·탐 평균', `${fmt(average, 2)} 백분위 — 어디가 공개값과 같은 기준입니다.`, 'informative');

    const share = el('div', { class: 'jr-actions' }, [
      button(state.copied ? '링크를 복사했습니다' : '성적 링크 복사', {
        variant: 'neutralOutline',
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(shareUrl());
            state.copied = true;
          } catch (error) {
            state.copied = false;
          }
          render();
          setTimeout(() => { state.copied = false; }, 4000);
        },
      }),
      button('입력 지우기', {
        variant: 'ghost',
        onclick: () => { state.scores = { ...EMPTY_SCORES }; saveScores(); render(); },
      }),
    ]);

    const action = el('div', { class: 'jr-sticky-action' }, [
      button('진단 보기', {
        variant: 'brandSolid', size: 'large',
        onclick: () => { go('diagnose'); },
        attrs: profileReady() ? {} : { disabled: true, 'aria-disabled': 'true' },
      }),
    ]);

    return [modeControl, summary, rows, gpa, share, action];
  }

  // ---------------------------------------------------------------- 진단 화면
  function diagnoseRows() {
    const rows = ENGINE.diagnose(profile(), DATA, { track: state.filters.track, universities: lineUniversities() });
    const query = state.filters.query.trim();
    return rows.filter((row) => {
      if (row.jeongsi.status === 'no-cut' || row.jeongsi.status === 'no-profile') return false;
      if (state.filters.band !== '전체' && row.jeongsi.band?.label !== state.filters.band) return false;
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
      class: `seed-action-button seed-action-button--variant_${on ? 'neutralSolid' : 'ghost'} seed-action-button--size_xsmall seed-action-button--layout_withText seed-action-button--size_xsmall-layout_withText jr-fav`,
      'aria-pressed': String(on),
      'aria-label': `${deptName} 관심 학과 ${on ? '해제' : '저장'}`,
      onclick: (event) => {
        event.stopPropagation();
        if (on) state.favorites.delete(key); else state.favorites.add(key);
        saveFavorites();
        render();
      },
    }, [on ? '관심' : '관심 저장']);
  }

  function renderDiagnose() {
    if (!profileReady()) {
      return [banner('성적 탭에서 국어·수학·탐구를 먼저 입력하세요.', 'criticalWeak'),
        el('div', { class: 'jr-actions' }, [button('성적 입력하러 가기', { variant: 'brandSolid', onclick: () => go('scores') })])];
    }
    const rows = diagnoseRows();
    const average = ENGINE.simpleAverage(profile());

    const chips = el('div', { class: 'seed-chip-tabs__list seed-chip-tabs__list--size_medium jr-chips', role: 'tablist', 'aria-label': '계열' }, TRACKS.map((track) => el('button', {
      type: 'button', role: 'tab',
      'aria-selected': String(state.filters.track === track),
      'data-selected': state.filters.track === track ? '' : null,
      class: 'seed-chip-tabs__trigger seed-chip-tabs__trigger--size_medium seed-chip-tabs__trigger--variant_neutralOutline',
      onclick: () => { state.filters.track = track; state.filters.limit = 8; saveFilters(); render(); },
    }, [track])));

    const filters = el('div', { class: 'jr-filters' }, [
      select([['전체', '라인 전체'], ...DATA.lines.map((line) => [line.label, line.label])], state.filters.line,
        (value) => { state.filters.line = value; state.filters.limit = 8; saveFilters(); render(); }, '대학 라인'),
      select(BANDS.map((band) => [band, band === '전체' ? '판정 전체' : band]), state.filters.band,
        (value) => { state.filters.band = value; state.filters.limit = 8; saveFilters(); render(); }, '판정'),
      el('input', {
        type: 'search', value: state.filters.query, placeholder: '대학·학과 검색', 'aria-label': '대학·학과 검색',
        class: 'seed-text-input__root seed-text-input__root--variant_outline seed-text-input__root--size_medium jr-search',
        oninput: (event) => {
          state.filters.query = event.target.value;
          state.filters.limit = 8;
          saveFilters();
          renderPanel({ keepFocus: 'search' });
        },
      }),
      button(state.filters.favOnly ? '관심만 보기 켬' : '관심만 보기', {
        variant: state.filters.favOnly ? 'neutralSolid' : 'neutralOutline', size: 'small',
        onclick: () => { state.filters.favOnly = !state.filters.favOnly; saveFilters(); render(); },
        attrs: { 'aria-pressed': String(state.filters.favOnly) },
      }),
    ]);

    const summary = callout('내 국·수·탐 평균',
      `${fmt(average, 2)} 백분위 · 조건에 맞는 모집단위 ${rows.length}곳 · 관심 ${state.favorites.size}곳`, 'informative');

    if (rows.length === 0) {
      return [summary, chips, filters, banner('조건에 맞는 모집단위가 없습니다. 필터를 넓혀 보세요.')];
    }

    const grouped = new Map(BAND_ORDER.map((key) => [key, []]));
    for (const row of rows) grouped.get(row.jeongsi.band.key)?.push(row);

    // 판정마다 같은 수만 먼저 보여 준다 — '안정'이 목록을 다 차지해 '적정'이 묻히지 않게 한다.
    const perGroup = state.filters.limit;
    const blocks = [];
    let shown = 0;
    for (const key of BAND_ORDER) {
      const group = grouped.get(key) || [];
      if (group.length === 0) continue;
      const slice = group.slice(0, perGroup);
      shown += slice.length;
      blocks.push(el('div', { class: 'jr-section' }, [
        listHeader(group[0].jeongsi.band.label, `${group.length}곳`),
        el('div', { class: 'jr-list' }, slice.map((row) => {
          const result = row.jeongsi;
          return listItem({
            title: `${row.universityName} ${row.dept.name}`,
            detail: `${spreadText(result)} · 내 환산 ${fmt(result.mine, 1)}${result.group ? ` · ${result.group}군` : ''}`,
            suffix: [
              el('span', { class: 'jr-gap num', text: `${result.gap > 0 ? '+' : ''}${fmt(result.gap, 1)}` }),
              badge(result.band.label, BAND_TONE[result.band.key]),
              favoriteButton(row.universityId, row.dept.name),
            ],
            onclick: () => {
              state.target = { university: row.universityId, dept: row.dept.name };
              go('target');
            },
          });
        })),
      ]));
    }

    const total = rows.length;
    const more = shown < total
      ? el('div', { class: 'jr-actions' }, [button(`더 보기 (판정별 ${state.filters.limit}곳씩 · 남은 ${total - shown}곳)`, {
        variant: 'neutralWeak',
        onclick: () => { state.filters.limit += 8; saveFilters(); render(); },
      })])
      : null;

    return [summary, chips, filters, ...blocks, more];
  }

  // ---------------------------------------------------------------- 목표 화면
  function currentTarget() {
    const university = universityById.get(state.target.university) || DATA.universities.find((row) => row.departments.length > 0);
    if (!university) return null;
    const dept = university.departments.find((row) => row.name === state.target.dept)
      || university.departments.find((row) => Object.keys(row.jeongsi || {}).length > 0)
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

    const pickers = el('div', { class: 'jr-filters' }, [
      select(DATA.universities.map((row) => [row.id, `${row.short} (${row.line})`]), university.id, (value) => {
        state.target = { university: value, dept: '' };
        render();
      }, '대학'),
      select(university.departments.map((row) => [row.name, row.name]), dept.name, (value) => {
        state.target = { university: university.id, dept: value };
        render();
      }, '모집단위'),
    ]);

    const target = ENGINE.analyzeTarget(profile(), university, dept, DATA.rules[university.id], university.volatility ?? DATA.volatility);
    if (target.status === 'no-cut') {
      return [pickers, banner('이 모집단위는 백분위로 공개된 정시 결과가 없어 판정을 보류합니다.', 'neutralWeak'),
        renderBasis(dept, target)];
    }

    const verdict = el('div', { class: 'jr-verdict' }, [
      el('p', { class: 'jr-muted', text: `${university.short} ${dept.name} · ${dept.track}` }),
      el('p', { class: 'jr-verdict-number', text: `${target.gap > 0 ? '+' : ''}${fmt(target.gap, 1)}` }),
      el('p', {}, [badge(target.band.label, BAND_TONE[target.band.key]), el('span', { class: 'jr-verdict-note', text: ` 내 환산 ${fmt(target.mine, 1)} · ${spreadText(target)}` })]),
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
              : `이 영역만으로는 닿지 않습니다 (현재 ${fmt(subject.current, 1)})`)
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
          detail: plan.english.steps.map((step) => `${step.grade}등급 +${fmt(step.gain, 2)}`).join(' · '),
          suffix: plan.english.enough ? badge(`${plan.english.enough.grade}등급이면 충분`, 'positive') : null,
        }) : null,
      ].filter(Boolean)),
    ]) : null;

    const notes = [];
    if (plan && plan.blockers.length > 0) notes.push(callout('지원 제한', plan.blockers.join(' · '), 'critical'));
    if (plan && plan.adjustments.length > 0) {
      notes.push(callout('선택과목·가감점',
        plan.adjustments.map((row) => `${row.label} ${row.delta > 0 ? '+' : ''}${fmt(row.delta, 2)}`).join(' · '), 'warning'));
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
        detail: `${result.year}학년도 70%컷 ${fmt(result.cut, 2)}등급 · 내 내신과의 차이 ${result.gap > 0 ? '+' : ''}${fmt(result.gap, 2)}`,
        suffix: badge(result.band.label, BAND_TONE[result.band.key]),
      }));
    }
    if (rows.length === 0) {
      return accordion('수시 참고', [muted('내신 등급을 입력하면 같은 학과의 수시 컷과 비교합니다.')]);
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
    if (picks.length < 2) {
      return section([
        listHeader('비교'),
        banner('진단 화면에서 관심 학과를 두 곳 이상 저장하면 같은 성적으로 나란히 비교합니다.'),
      ]);
    }
    const rows = picks.map((pick) => {
      const result = ENGINE.evaluateJeongsi(profile(), pick.university, pick.dept, DATA.rules[pick.university.id], pick.university.volatility ?? DATA.volatility);
      return [
        `${pick.university.short} ${pick.dept.name}`,
        result.cut ? fmt(result.cut.value, 1) : '—',
        result.mine === undefined ? '—' : fmt(result.mine, 1),
        result.gap === undefined ? '—' : `${result.gap > 0 ? '+' : ''}${fmt(result.gap, 1)}`,
        result.band ? badge(result.band.label, BAND_TONE[result.band.key]) : '—',
      ];
    });
    return section([
      listHeader('비교', `관심 학과 ${picks.length}곳`),
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
      const weightRows = [
        ['국어', weights.kor ?? 0], ['수학', weights.math ?? 0], ['영어', weights.eng ?? 0], ['탐구', weights.inq ?? 0],
      ].map(([label, value]) => [label, `${value}${unit}`]);
      for (const group of track.bestOf || []) {
        weightRows.push([`${group.areas.map((area) => ENGINE.SUBJECT_LABEL[area]).join('·')} 우수 순`, group.weights.join(' / ')]);
      }
      const english = track.english || {};
      const englishRow = Object.entries(english.table || {}).map(([grade, value]) => `${grade}등급 ${value}`);
      const history = track.history || {};
      const historyRow = Object.entries(history.table || {}).map(([grade, value]) => `${grade}등급 ${value}`);
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
        [english.note, history.note, inquiry.note, track.note].filter(Boolean).map((note) => el('p', { class: 'jr-muted', text: note })),
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
      rule.changes2027 ? callout('2027학년도 변경', rule.changes2027, 'informative') : null,
      cutRows.length > 0 ? section([
        listHeader(`${EXAM_YEAR}학년도 수능 선택과목 원점수 컷`, exam.status === 'final' ? '실채점 확정' : '가채점 예상'),
        table(['과목', '1등급', '2등급', '3등급', '만점 표준점수'], cutRows),
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
      callout('판정 기준', ENGINE.VERDICT_BANDS.map((band) => (
        band.min === -Infinity ? `${band.label} 컷 −2점 미만` : `${band.label} 컷 ${band.min > 0 ? '+' : ''}${band.min}점 이상`
      )).join(' · '), 'informative'),
      section([
        listHeader('계산 방법'),
        el('div', { class: 'jr-list' }, [
          listItem({ title: '기준값', detail: '가용한 연도의 컷을 최근 순 0.6·0.3·0.1로 가중 평균한 값입니다.' }),
          listItem({ title: '오차', detail: '연도별 최소~최대 폭의 절반입니다. 한 해뿐이면 그 대학 학과들의 연도별 표준편차 중앙값을 씁니다.' }),
          listItem({ title: '내 환산', detail: '대학별 영역 반영비율로 가중 평균한 뒤 영어·한국사 가감점과 선택과목 가산을 백분위 단위로 더합니다.' }),
        ]),
      ]),
      section([
        listHeader('출처'),
        el('div', { class: 'jr-list' }, sources.map((row) => listItem({
          title: row.title,
          detail: row.note || row.url,
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
      const search = panel.querySelector('.jr-search');
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
  }

  function render() {
    syncTabs();
    renderPanel();
  }

  function go(view) {
    state.view = view;
    writeStore(STORE.view, view);
    render();
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'auto' : 'auto' });
  }

  // ---------------------------------------------------------------- 테마
  const THEMES = [['system', '시스템'], ['light-only', '밝게'], ['dark-only', '어둡게']];
  function applyTheme(mode) {
    document.documentElement.setAttribute('data-seed-color-mode', mode);
    const label = THEMES.find(([value]) => value === mode)?.[1] || '시스템';
    const toggle = document.getElementById('themeToggle');
    toggle.textContent = label;
    toggle.setAttribute('aria-label', `테마 바꾸기 — 지금 ${label}`);
    writeStore(STORE.theme, mode);
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
    applyTheme(['system', 'light-only', 'dark-only'].includes(stored) ? stored : 'system');
    document.getElementById('themeToggle').addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-seed-color-mode') || 'system';
      const index = THEMES.findIndex(([value]) => value === current);
      applyTheme(THEMES[(index + 1) % THEMES.length][0]);
    });

    if (!VIEWS[state.view]) state.view = 'scores';
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
