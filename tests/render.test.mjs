// 렌더러 스모크 테스트. 브라우저 없이 다섯 화면이 예외 없이 그려지는지, 핵심 문구가 나오는지 본다.
// 아주 작은 DOM 흉내를 만들어 assets/app.js를 그대로 돌린다 — 의존성을 늘리지 않기 위해서다.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const ROOT = process.cwd();

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.attributes = new Map();
    this.children = [];
    this.listeners = new Map();
    this.dataset = {};
    this.className = '';
    this.textContent = '';
    this.tabIndex = 0;
    this.type = '';
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'class') this.className = String(value);
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/gu, (all, ch) => ch.toUpperCase())] = String(value);
  }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }
  dispatch(type, event = {}) {
    for (const handler of this.listeners.get(type) || []) handler({ target: this, preventDefault() {}, stopPropagation() {}, ...event });
  }
  append(...nodes) {
    for (const node of nodes) {
      this.children.push(typeof node === 'string' ? { text: node, children: [], className: '' } : node);
    }
  }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  get childElementCount() { return this.children.filter((child) => child instanceof FakeElement).length; }
  get innerText() { return this.text; }
  get text() {
    const own = this.textContent || '';
    return own + this.children.map((child) => (child instanceof FakeElement ? child.text : child.text || '')).join(' ');
  }
  walk(out = []) {
    out.push(this);
    for (const child of this.children) if (child instanceof FakeElement) child.walk(out);
    return out;
  }
  matches(selector) {
    if (selector.startsWith('.')) return this.className.split(/\s+/u).includes(selector.slice(1));
    if (selector.startsWith('[')) {
      const [, name, value] = /\[([^=\]]+)="?([^"\]]*)"?\]/u.exec(selector) || [];
      return this.getAttribute(name) === value;
    }
    const [base, rest] = [selector.replace(/\[.*$/u, ''), selector.slice(selector.indexOf('['))];
    if (base && !this.matches(base)) return false;
    return rest.startsWith('[') ? this.matches(rest) : true;
  }
  querySelectorAll(selector) { return this.walk().filter((node) => node !== this && node.matches(selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  focus() { fakeDocument.activeElement = this; }
  setSelectionRange() {}
}

let fakeDocument;

function buildContext() {
  const root = new FakeElement('html');
  const panel = new FakeElement('section');
  panel.setAttribute('id', 'panel');
  const toggle = new FakeElement('button');
  toggle.setAttribute('id', 'themeToggle');
  const tabs = ['scores', 'diagnose', 'target', 'rules', 'about'].map((view) => {
    const tab = new FakeElement('button');
    tab.setAttribute('class', 'seed-tabs__trigger');
    tab.setAttribute('data-view', view);
    return tab;
  });
  const body = new FakeElement('body');
  body.append(panel, toggle, ...tabs);
  root.append(body);

  const byId = { panel, themeToggle: toggle };
  fakeDocument = {
    documentElement: root,
    activeElement: null,
    readyState: 'complete',
    createElement: (tag) => new FakeElement(tag),
    getElementById: (id) => byId[id] || null,
    querySelector: (selector) => root.querySelector(selector),
    querySelectorAll: (selector) => root.querySelectorAll(selector),
    addEventListener() {},
  };

  const storage = new Map();
  const context = {
    console,
    setTimeout,
    document: fakeDocument,
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
    },
    location: { search: '', origin: 'https://example.test', pathname: '/' },
    navigator: { clipboard: { writeText: async () => {} } },
    URLSearchParams,
    window: null,
  };
  context.window = context;
  context.globalThis = context;
  context.window.scrollTo = () => {};
  vm.createContext(context);
  for (const file of ['assets/data.js', 'assets/engine.js']) {
    vm.runInContext(readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
  }
  return { context, panel, tabs, toggle };
}

function boot(scores) {
  const built = buildContext();
  if (scores) built.context.localStorage.setItem('jr.scores', JSON.stringify(scores));
  vm.runInContext(readFileSync(path.join(ROOT, 'assets/app.js'), 'utf8'), built.context, { filename: 'assets/app.js' });
  return built;
}

const FULL_SCORES = {
  mode: 'pct', korElective: '언어와매체', kor: '96', mathElective: '미적분', math: '93',
  eng: '2', hist: '1', inq1Subject: '사회문화', inq1: '95', inq2Subject: '생활과윤리', inq2: '92', gpa: '2.1',
};

test('다섯 화면이 성적 없이도 예외 없이 그려진다', () => {
  const { panel, tabs } = boot(null);
  for (const tab of tabs) {
    tab.dispatch('click');
    assert.ok(panel.childElementCount > 0, `${tab.getAttribute('data-view')} 패널이 비었다`);
    assert.ok(!panel.text.includes('화면을 그리지 못했습니다'), `${tab.getAttribute('data-view')} 렌더 실패: ${panel.text.slice(0, 200)}`);
  }
});

test('성적이 있으면 진단·목표 화면이 판정을 낸다', () => {
  const { panel, tabs } = boot(FULL_SCORES);
  const view = (name) => {
    tabs.find((tab) => tab.getAttribute('data-view') === name).dispatch('click');
    return panel.text;
  };
  const scores = view('scores');
  assert.match(scores, /국·수·탐 평균/u);
  const diagnose = view('diagnose');
  assert.match(diagnose, /조건에 맞는 모집단위/u);
  assert.ok(/안정|적정|소신|상향|위험/u.test(diagnose), '판정 뱃지가 없다');
  const target = view('target');
  assert.match(target, /필요한 상승|판정을 보류/u);
  const rules = view('rules');
  assert.match(rules, /정시 수능 반영/u);
  const about = view('about');
  assert.match(about, /판정 기준/u);
  assert.match(about, /데이터 생성일/u);
});

test('진단 목록은 머리글 없는 한 목록이고 지원 가능한 곳이 컷 높은 순으로 먼저다', () => {
  const { panel, tabs } = boot(FULL_SCORES);
  tabs.find((tab) => tab.getAttribute('data-view') === 'diagnose').dispatch('click');
  const text = panel.text;
  assert.match(text, /지원 가능한 곳부터 예상 컷 높은 순으로 봅니다/u);
  // 판정 범례가 목록 위에 한 줄 있다.
  assert.match(text, /차이 = 내 환산 백분위 − 예상 컷/u);
  assert.match(text, /안정 \+2\.0 이상/u);
  assert.match(text, /오차 ±는 판정을 바꾸지 않습니다/u);
  // '높은 순' 보기에는 판정 머리글(list-header)이 없다.
  const headers = panel.querySelectorAll('.seed-list-header').map((node) => node.text);
  assert.ok(!headers.some((head) => /안정|적정|소신|상향|위험|불가/u.test(head)), `판정 머리글이 없어야 한다: ${headers}`);
  // 목록 행의 '예상 컷 xx.x' 를 차례로 읽어 내림차순인지 본다(지원 가능 묶음 안에서).
  const cuts = [...text.matchAll(/예상 컷 (\d+\.\d)/gu)].map((row) => Number(row[1]));
  assert.ok(cuts.length > 3, `컷이 여럿 보여야 한다 (${cuts.length})`);
});

test('기본 토글 세 개가 켜져 있어 예체능·서연고·의약 최상위·여대를 감춘다', () => {
  const { panel, tabs } = boot(FULL_SCORES);
  tabs.find((tab) => tab.getAttribute('data-view') === 'diagnose').dispatch('click');
  const text = panel.text;
  assert.match(text, /예체능 제외/u);
  assert.match(text, /말도 안되는거 제외/u);
  assert.match(text, /여대 제외/u);
  assert.match(text, /의·치·한·약·수의와 서·연·고·여자대학교 제외/u);
  const list = text.split('예상 컷')[1] || '';
  assert.ok(!/서울대|연세대|고려대/u.test(list), '서·연·고가 목록에 없다');
  assert.ok(!/이화여대|숙명여대/u.test(list), '여자대학교가 목록에 없다');
  assert.ok(!/의예/u.test(text), '의예 모집단위가 목록에 없다');
});

test("'여대 제외'를 끄면 여자대학교가 목록에 나타난다", () => {
  const { panel, tabs } = boot(FULL_SCORES);
  tabs.find((tab) => tab.getAttribute('data-view') === 'diagnose').dispatch('click');
  const count = () => Number(/모집단위 (\d+)곳/u.exec(panel.text)[1]);
  const before = count();
  const chip = panel.querySelectorAll('.seed-chip-tabs__trigger').find((node) => node.text.trim() === '여대 제외');
  assert.ok(chip, "'여대 제외' 칩이 있어야 한다");
  chip.dispatch('click');
  assert.ok(count() > before, `여대를 켜면 목록이 늘어야 한다 (${before} → ${count()})`);
  assert.ok(!/여자대학교 제외|·여자대학교/u.test(panel.text), '숨김 안내에서 여자대학교가 빠진다');
  // 대학 셀렉트(목표 탭)와 라인 목록에는 여대가 보인다.
  assert.match(panel.text, /여대/u);
});

test('등급으로 넣으면 구간 중앙 백분위가 화면에 보인다', () => {
  const { panel, tabs } = boot({ ...FULL_SCORES, mode: 'grade', kor: '2', math: '1', inq1: '3', inq2: '3' });
  tabs.find((tab) => tab.getAttribute('data-view') === 'scores').dispatch('click');
  const text = panel.text;
  assert.match(text, /국어 2등급 → 92\.5\(구간 중앙\)/u);
  assert.match(text, /수학 1등급 → 98\.0\(구간 중앙\)/u);
  assert.match(text, /등급 구간의 정중앙 백분위로 바꾼 값입니다/u);
  assert.match(text, /등급 → 백분위 환산표/u);
});

test('탭을 바꾸면 aria-selected가 하나만 참이다', () => {
  const { tabs } = boot(FULL_SCORES);
  tabs[2].dispatch('click');
  const selected = tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true');
  assert.equal(selected.length, 1);
  assert.equal(selected[0].getAttribute('data-view'), 'target');
});

test('테마 토글은 system → light-only → dark-only 로 돈다', () => {
  const { toggle, context } = boot(null);
  const mode = () => context.document.documentElement.getAttribute('data-seed-color-mode');
  assert.equal(mode(), 'system');
  toggle.dispatch('click');
  assert.equal(mode(), 'light-only');
  toggle.dispatch('click');
  assert.equal(mode(), 'dark-only');
  toggle.dispatch('click');
  assert.equal(mode(), 'system');
  assert.equal(context.localStorage.getItem('jr.theme'), '"system"');
});

test('성적 공유 링크의 쿼리를 다시 읽어 들인다', () => {
  const built = buildContext();
  built.context.location.search = '?k=95&m=90&e=1&i1=93&i2=91&s1=사회문화&s2=생활과윤리&ke=언어와매체&me=미적분&md=pct';
  vm.runInContext(readFileSync(path.join(ROOT, 'assets/app.js'), 'utf8'), built.context, { filename: 'assets/app.js' });
  const saved = JSON.parse(built.context.localStorage.getItem('jr.scores'));
  assert.equal(saved.kor, '95');
  assert.equal(saved.inq1Subject, '사회문화');
  // 링크로 들어오면 바로 진단 화면을 연다.
  assert.equal(built.tabs.find((tab) => tab.getAttribute('data-view') === 'diagnose').getAttribute('aria-selected'), 'true');
});

// 저장된 필터까지 함께 넣고 띄운다.
function bootWith(scores, filters) {
  const built = buildContext();
  built.context.localStorage.setItem('jr.scores', JSON.stringify(scores));
  built.context.localStorage.setItem('jr.filters', JSON.stringify(filters));
  vm.runInContext(readFileSync(path.join(ROOT, 'assets/app.js'), 'utf8'), built.context, { filename: 'assets/app.js' });
  return built;
}

test('판정별 보기에서만 머리글이 나오고 머리글과 그 안의 뱃지가 같다', () => {
  const { panel, tabs } = bootWith(FULL_SCORES, { sort: 'band' });
  tabs.find((tab) => tab.getAttribute('data-view') === 'diagnose').dispatch('click');
  const blocks = panel.querySelectorAll('.jr-section').filter((node) => node.querySelector('.seed-list-header'));
  const verdicts = ['안정', '적정', '소신', '상향', '위험', '불가'];
  const named = blocks.filter((block) => verdicts.includes(block.querySelector('.seed-list-header').text.trim().split(' ')[0]));
  assert.ok(named.length >= 2, `판정 머리글 묶음이 둘 이상이어야 한다 (${named.length})`);
  for (const block of named) {
    const head = block.querySelector('.seed-list-header').text.trim().split(' ')[0];
    const badges = block.querySelectorAll('.seed-badge__root').map((node) => node.text.trim());
    assert.ok(badges.length > 0, `${head}: 뱃지가 있어야 한다`);
    for (const label of badges) assert.equal(label, head, `${head} 묶음에 ${label} 뱃지가 섞였다`);
  }
});

test('진단 목록의 차이 숫자와 뱃지가 판정 정의대로 맞는다', () => {
  const { panel, tabs } = bootWith(FULL_SCORES, { sort: 'cut', limit: 40 });
  tabs.find((tab) => tab.getAttribute('data-view') === 'diagnose').dispatch('click');
  const rows = panel.querySelectorAll('.jr-row');
  const withGap = rows.filter((row) => row.querySelector('.jr-gap'));
  assert.ok(withGap.length >= 20, `판정 행이 20개 이상이어야 한다 (${withGap.length})`);
  const verdictOf = (gap) => (gap >= 2 ? '안정' : gap >= 0.7 ? '적정' : gap >= -0.7 ? '소신' : gap >= -2 ? '상향' : '위험');
  for (const row of withGap.slice(0, 20)) {
    const gap = Number(row.querySelector('.jr-gap').text.trim().replace('\u2212', '-').replace('+', ''));
    const label = row.querySelector('.seed-badge__root').text.trim();
    if (label === '불가') continue;
    assert.equal(label, verdictOf(gap), `차이 ${gap} 인데 뱃지가 ${label}`);
  }
});

test('더 보기를 누르면 목록이 늘고 다시 그려도 느려지지 않는다', () => {
  const { panel, tabs } = bootWith(FULL_SCORES, { sort: 'cut' });
  const open = () => tabs.find((tab) => tab.getAttribute('data-view') === 'diagnose').dispatch('click');
  open();
  const count = () => panel.querySelectorAll('.jr-row').filter((row) => row.querySelector('.jr-gap')).length;
  const before = count();
  assert.ok(before > 0, '행이 있어야 한다');
  const more = panel.querySelectorAll('.seed-action-button').find((node) => node.text.includes('더 보기'));
  assert.ok(more, '더 보기 버튼이 있어야 한다');
  more.dispatch('click');
  const after = count();
  assert.ok(after > before, `더 보기로 늘어야 한다 (${before} → ${after})`);
  // 같은 성적·필터로 다시 그릴 때는 판정 결과를 다시 계산하지 않는다.
  const start = Date.now();
  for (let index = 0; index < 5; index += 1) open();
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 2000, `다시 그리기 5번이 2초 안에 끝나야 한다 (${elapsed}ms)`);
});

const STD_SCORES = {
  mode: 'std', korElective: '언어와매체', kor: '131', mathElective: '미적분', math: '128',
  eng: '2', hist: '1', inq1Subject: '생활과윤리', inq1: '65', inq2Subject: '한국지리', inq2: '67', gpa: '',
};

test('표준점수 모드는 백분위·등급을 되읽고 대학 환산점수를 보여 준다', () => {
  const { panel, tabs } = boot(STD_SCORES);
  tabs.find((tab) => tab.getAttribute('data-view') === 'scores').dispatch('click');
  const text = panel.text;
  assert.match(text, /표준점수 → 백분위/u);
  // 연세대 안내문 예시와 같은 값이 화면에 그대로 있다.
  assert.match(text, /표준점수 131 · 백분위 94/u);
  assert.match(text, /표준점수 65 · 백분위 92/u);
  assert.match(text, /대학별 환산점수/u);
  assert.match(text, /판정은 어디가 70%컷과 같은 국·수·탐 백분위 평균 척도에서 비교하며/u);
  // 표준점수로 넣어도 진단이 열린다 (백분위로 흘러 들어간다).
  tabs.find((tab) => tab.getAttribute('data-view') === 'diagnose').dispatch('click');
  assert.match(panel.text, /조건에 맞는 모집단위/u);
});

test('반영 지표가 진단 부제·목표 카드·반영 탭에 적힌다', () => {
  const { panel, tabs } = boot(FULL_SCORES);
  const view = (name) => {
    tabs.find((tab) => tab.getAttribute('data-view') === name).dispatch('click');
    return panel.text;
  };
  assert.ok(/표점 반영|백분위 반영|등급 배점 반영|반영 지표 미확인/u.test(view('diagnose')), '진단 부제에 반영 지표가 없다');
  const target = view('target');
  assert.ok(/표점 반영|백분위 반영|등급 배점 반영/u.test(target), '목표 카드에 반영 지표가 없다');
  assert.match(target, /판정은 어디가 70%컷과 같은 국·수·탐 백분위 평균 척도에서 비교하며/u);
  assert.match(view('rules'), /반영 지표/u);
  const about = view('about');
  assert.match(about, /정확도 — 어디가 값과 얼마나 다른가/u);
  assert.match(about, /원값과 집계 정수가 둘 다 있는/u);
});

test('관심 대학을 담으면 진단 목록 맨 위에 따로 묶인다', () => {
  const { panel, tabs, context } = boot(FULL_SCORES);
  const diagnose = () => {
    tabs.find((tab) => tab.getAttribute('data-view') === 'diagnose').dispatch('click');
    return panel;
  };
  diagnose();
  assert.ok(!panel.querySelectorAll('.seed-list-header').some((node) => node.text.includes('관심 대학')),
    '관심 대학이 0곳이면 묶음이 없어야 한다');
  // 관심 대학 칩(아코디언 안)에서 한 곳을 고른다.
  const target = context.IPSI_DATA.universities.find((row) => !['snu', 'yonsei', 'korea'].includes(row.id)
    && !row.womenOnly && row.departments.length > 3);
  const chip = panel.querySelectorAll('.seed-chip-tabs__trigger').find((node) => node.text === target.short);
  assert.ok(chip, `${target.short} 칩이 없다`);
  chip.dispatch('click');
  const headers = panel.querySelectorAll('.seed-list-header').map((node) => node.text);
  assert.ok(headers.some((head) => head.includes('관심 대학')), `관심 대학 묶음이 없다: ${headers}`);
  // 저장은 관심 학과와 따로 남는다.
  assert.equal(JSON.parse(context.localStorage.getItem('jr.favUniversities'))[0], target.id);
  assert.equal(context.localStorage.getItem('jr.favorites'), null);
  // 묶음이 목록 맨 위다 — 첫 번째 머리글이 '관심 대학'이다.
  assert.match(headers[0], /관심 대학/u);
});

test('관심 학과만 / 관심 대학만 토글이 서로 다른 이름으로 있다', () => {
  const { panel, tabs } = boot(FULL_SCORES);
  tabs.find((tab) => tab.getAttribute('data-view') === 'diagnose').dispatch('click');
  const labels = panel.querySelectorAll('.seed-action-button').map((node) => node.text);
  assert.ok(labels.some((label) => label.includes('관심 학과만')), labels.join(' / '));
  assert.ok(labels.some((label) => label.includes('관심 대학만')), labels.join(' / '));
});
