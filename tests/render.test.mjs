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
  // 아주 작은 선택자만 흉내 낸다: 태그·.클래스·#아이디·[속성="값"] 과 그것들을 이어 붙인 것.
  matches(selector) {
    const parts = String(selector).match(/\[[^\]]*\]|[.#]?[A-Za-z0-9_-]+/gu) || [];
    return parts.every((part) => {
      if (part.startsWith('.')) return this.className.split(/\s+/u).includes(part.slice(1));
      if (part.startsWith('#')) return this.getAttribute('id') === part.slice(1);
      if (part.startsWith('[')) {
        const [, name, value] = /\[([^=\]]+)="?([^"\]]*)"?\]/u.exec(part) || [];
        return value === undefined ? this.attributes.has(name) : this.getAttribute(name) === value;
      }
      return this.tagName === part.toUpperCase();
    });
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
  // ⓘ 는 상단바에 있다 — 패널이 아니라 index.html 이 들고 있는 버튼이다 (FRAME §9.2).
  const info = new FakeElement('button');
  info.setAttribute('id', 'infoButton');
  const tabs = ['scores', 'diagnose', 'target', 'rules', 'about'].map((view) => {
    const tab = new FakeElement('button');
    tab.setAttribute('class', 'seed-tabs__trigger');
    tab.setAttribute('data-view', view);
    return tab;
  });
  const body = new FakeElement('body');
  body.append(panel, toggle, info, ...tabs);
  root.append(body);

  const byId = { panel, themeToggle: toggle, infoButton: info };
  fakeDocument = {
    documentElement: root,
    activeElement: null,
    readyState: 'complete',
    createElement: (tag) => new FakeElement(tag),
    getElementById: (id) => byId[id] || null,
    querySelector: (selector) => root.querySelector(selector),
    querySelectorAll: (selector) => root.querySelectorAll(selector),
    addEventListener() {},
    body,
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
  return { context, panel, tabs, toggle, info };
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
  assert.match(diagnose, /지원 가능/u);
  assert.ok(/안정|적정|소신|상향|위험/u.test(diagnose), '판정 뱃지가 없다');
  // 컷 옆 숫자는 관측 범위이지 신뢰구간이 아니다 — ± 를 쓰지 않는다 (FRAME §8.2).
  assert.ok(!/컷 \d+\.\d ±/u.test(diagnose), '± 표기가 남아 있다');
  // L2 행의 부제는 컷과 내가 **같은 눈금**(지수)이다 (FRAME §10.4).
  assert.match(diagnose, /지수 컷 \d+\.\d · 내 \d+\.\d · [가나다]군 · 반영비율/u);
  const target = view('target');
  assert.match(target, /필요한 상승|정시 결과가 없습니다/u);
  const rules = view('rules');
  assert.match(rules, /수능 반영/u);
  const about = view('about');
  assert.match(about, /판정/u);
  assert.match(about, /비교 기준/u);
});

test('진단 목록은 라인 이름을 머리글로 쓰고 라인 순위대로 나온다', () => {
  const { panel, tabs, context } = boot(FULL_SCORES);
  tabs.find((tab) => tab.getAttribute('data-view') === 'diagnose').dispatch('click');
  const lineOrder = context.IPSI_DATA.lines.map((row) => row.label);
  const headers = panel.querySelectorAll('.seed-list-header').map((node) => node.text.trim().split(' ')[0]);
  const lineHeaders = headers.filter((head) => lineOrder.includes(head));
  assert.ok(lineHeaders.length >= 2, `라인 머리글이 둘 이상이어야 한다: ${headers}`);
  const ranks = lineHeaders.map((head) => lineOrder.indexOf(head));
  for (let index = 1; index < ranks.length; index += 1) {
    assert.ok(ranks[index] > ranks[index - 1], `라인 순위대로여야 한다: ${lineHeaders.join(' → ')}`);
  }
  // 설명문·범례·필터 상태 문장은 화면에 없다 (FRAME §8.1).
  const text = panel.text;
  for (const gone of ['차이 = 내 환산', '봅니다', '제외 토글', '조건에 맞는 모집단위']) {
    assert.ok(!text.includes(gone), `'${gone}' 문구가 남아 있다`);
  }
  // 부제는 값만 한 줄이다 — '예상 컷'·'내 환산' 접두어가 없다.
  const details = panel.querySelectorAll('.seed-list-item__detail').map((node) => node.text);
  assert.ok(details.some((detail) => /^컷 \d/u.test(detail.trim())), `부제가 값으로 시작해야 한다: ${details[0]}`);
  assert.ok(!details.some((detail) => detail.includes('내 환산')), '부제에 내 환산이 남아 있다');
});

test('기본 토글 세 개가 켜져 있어 예체능·서연고·의약 최상위·여대를 감춘다', () => {
  const { panel, tabs } = boot(FULL_SCORES);
  tabs.find((tab) => tab.getAttribute('data-view') === 'diagnose').dispatch('click');
  const text = panel.text;
  assert.match(text, /예체능 제외/u);
  assert.match(text, /말도 안되는거 제외/u);
  assert.match(text, /여대 제외/u);
  const list = text.split('컷 ')[1] || '';
  assert.ok(!/서울대|연세대|고려대/u.test(list), '서·연·고가 목록에 없다');
  assert.ok(!/이화여대|숙명여대/u.test(list), '여자대학교가 목록에 없다');
  assert.ok(!/의예/u.test(text), '의예 모집단위가 목록에 없다');
});

test("'여대 제외'를 끄면 여자대학교가 목록에 나타난다", () => {
  const { panel, tabs } = boot(FULL_SCORES);
  tabs.find((tab) => tab.getAttribute('data-view') === 'diagnose').dispatch('click');
  const count = () => panel.querySelectorAll('.jr-row').filter((row) => row.querySelector('.jr-gap')).length
    + panel.querySelectorAll('.seed-action-button').filter((node) => node.text.includes('더 보기')).length * 1000;
  const before = count();
  const chip = panel.querySelectorAll('.seed-chip-tabs__trigger').find((node) => node.text.trim() === '여대 제외');
  assert.ok(chip, "'여대 제외' 칩이 있어야 한다");
  chip.dispatch('click');
  assert.ok(count() >= before, `여대를 켜면 목록이 줄지 않는다 (${before} → ${count()})`);
  assert.ok(/이화여대|숙명여대|여대/u.test(panel.text), '여자대학교가 보인다');
});

test('등급으로 넣으면 구간 중앙 백분위가 화면에 보인다', () => {
  const { panel, tabs } = boot({ ...FULL_SCORES, mode: 'grade', kor: '2', math: '1', inq1: '3', inq2: '3' });
  tabs.find((tab) => tab.getAttribute('data-view') === 'scores').dispatch('click');
  // 환산값은 입력 옆 작은 회색 값 하나로만 적는다 (FRAME §8.1).
  const notes = panel.querySelectorAll('.jr-input-note').map((node) => node.text.trim());
  assert.deepEqual(notes.slice(0, 2), ['92.5', '98.0'], `환산값이 입력 옆에 있어야 한다: ${notes}`);
  assert.ok(!panel.text.includes('구간 중앙'), '설명 문구가 남아 있다');
  // 정의는 정보 탭 표에만 있다.
  tabs.find((tab) => tab.getAttribute('data-view') === 'about').dispatch('click');
  assert.match(panel.text, /등급 → 백분위/u);
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
    // 판정 뱃지 말고도 한 행에 모의·추정·근사·참고·실기·이상이 함께 붙는다
    // (FRAME §9.4·§10.1) — 판정 뱃지만 본다.
    const EXTRA = new Set(['추정', '모의', '목표', '근사', '참고', '실기', '이상', '미확인']);
    const badges = block.querySelectorAll('.seed-badge__root')
      .map((node) => node.text.trim())
      .filter((label) => !EXTRA.has(label));
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
    // \ud310\uc815 \ubc43\uc9c0\ub294 \uc5b8\uc81c\ub098 \ub9c8\uc9c0\ub9c9\uc774\ub2e4 \u2014 \uc55e\uc5d0\ub294 \ubaa8\uc758\u00b7\ucc38\uace0 \uac19\uc740 \uc0c1\ud0dc \ubc43\uc9c0\uac00 \uc120\ub2e4 (FRAME \u00a710.1).
    const label = row.querySelectorAll('.seed-badge__root').at(-1).text.trim();
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
  // 연세대 안내문 예시와 같은 값이 화면에 그대로 있다.
  assert.match(text, /131 · 백분위 94/u);
  assert.match(text, /65 · 백분위 92/u);
  assert.match(text, /대학별 환산점수/u);
  // 표준점수로 넣어도 진단이 열린다 (백분위로 흘러 들어간다).
  tabs.find((tab) => tab.getAttribute('data-view') === 'diagnose').dispatch('click');
  assert.match(panel.text, /지원 가능/u);
});

test('반영 지표가 진단 부제·목표 카드·반영 탭에 적힌다', () => {
  const { panel, tabs } = boot(FULL_SCORES);
  const view = (name) => {
    tabs.find((tab) => tab.getAttribute('data-view') === name).dispatch('click');
    return panel.text;
  };
  assert.ok(/표점|백분위|미확인/u.test(view('diagnose')), '진단 부제에 반영 지표가 없다');
  const target = view('target');
  assert.match(target, /반영 지표/u);
  assert.match(view('rules'), /반영 지표/u);
  const about = view('about');
  assert.match(about, /정확도/u);
  assert.match(about, /어디가 값과의 차이/u);
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
  // 관심 대학 칩(성적 탭 아코디언 안)에서 한 곳을 고른다.
  const target = context.IPSI_DATA.universities.find((row) => !['snu', 'yonsei', 'korea'].includes(row.id)
    && !row.womenOnly && row.departments.length > 3);
  tabs.find((tab) => tab.getAttribute('data-view') === 'scores').dispatch('click');
  const chip = panel.querySelectorAll('.seed-chip-tabs__trigger').find((node) => node.text === target.short);
  assert.ok(chip, `${target.short} 칩이 없다`);
  chip.dispatch('click');
  diagnose();
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
  const chips = panel.querySelectorAll('.seed-chip-tabs__trigger').map((node) => node.text.trim());
  assert.ok(chips.includes('관심 학과'), chips.join(' / '));
  assert.ok(chips.includes('관심 대학'), chips.join(' / '));
});

// ---------------------------------------------------------------- 라인·대학 체크 목록
// 진단 화면의 필터 두 개. 라인 체크와 대학 체크는 AND로 좁히고 둘 다 localStorage에 남는다.
function openDiagnose(built) {
  built.tabs.find((tab) => tab.getAttribute('data-view') === 'diagnose').dispatch('click');
  return built.panel;
}
const chipNamed = (panel, name) => panel.querySelectorAll('.seed-chip-tabs__trigger')
  .find((node) => node.text.trim().split(' ')[0] === name);
const checkRowNamed = (panel, name) => panel.querySelectorAll('[role="checkbox"]')
  .find((node) => node.querySelector('.seed-list-item__title')?.text.trim() === name);
const lineHeaders = (panel, lines) => panel.querySelectorAll('.seed-list-header')
  .map((node) => node.text.trim().split(' ')[0])
  .filter((head) => lines.includes(head));
const rowTitles = (panel) => panel.querySelectorAll('.jr-row')
  .filter((row) => row.querySelector('.jr-gap'))
  .map((row) => row.querySelector('.seed-list-item__title').text.trim());

test('라인 체크리스트: 체크한 라인의 머리글과 대학만 남는다', () => {
  const built = boot(FULL_SCORES);
  const panel = openDiagnose(built);
  const lines = built.context.IPSI_DATA.lines.map((row) => row.label);
  chipNamed(panel, '라인').dispatch('click');
  assert.ok(checkRowNamed(panel, '서성한'), '라인 체크 목록이 펼쳐져야 한다');
  checkRowNamed(panel, '서성한').dispatch('click');
  checkRowNamed(panel, '중경외시').dispatch('click');
  assert.deepEqual([...new Set(lineHeaders(panel, lines))].sort(), ['served'].slice(0, 0).concat(['서성한', '중경외시']).sort());
  // 칩에는 체크 수만 적힌다.
  assert.equal(chipNamed(panel, '라인').text.trim(), '라인 2');
  // 저장된다.
  const saved = JSON.parse(built.context.localStorage.getItem('jr.filters'));
  assert.deepEqual(saved.lines, ['서성한', '중경외시']);
  // 모두 해제하면 전체로 돌아온다.
  checkRowNamed(panel, '모두 해제').dispatch('click');
  assert.ok(lineHeaders(panel, lines).length > 2, '해제하면 라인이 다시 늘어난다');
  assert.deepEqual(JSON.parse(built.context.localStorage.getItem('jr.filters')).lines, []);
});

test('대학 체크리스트: 체크한 대학만 남고 라인 체크와 AND로 좁힌다', () => {
  const built = boot(FULL_SCORES);
  const panel = openDiagnose(built);
  chipNamed(panel, '대학').dispatch('click');
  checkRowNamed(panel, '서강대').dispatch('click');
  checkRowNamed(panel, '중앙대').dispatch('click');
  assert.equal(chipNamed(panel, '대학').text.trim(), '대학 2');
  let titles = rowTitles(panel);
  assert.ok(titles.length > 0, '행이 있어야 한다');
  assert.ok(titles.every((title) => title.startsWith('서강대') || title.startsWith('중앙대')), titles.slice(0, 3).join(' / '));
  // 라인 '서성한'을 함께 체크하면 그 라인 밖의 중앙대는 빠진다(AND).
  chipNamed(panel, '라인').dispatch('click');
  checkRowNamed(panel, '서성한').dispatch('click');
  titles = rowTitles(panel);
  assert.ok(titles.length > 0, 'AND 결과가 비면 안 된다');
  assert.ok(titles.every((title) => title.startsWith('서강대')), titles.slice(0, 3).join(' / '));
  const saved = JSON.parse(built.context.localStorage.getItem('jr.filters'));
  assert.deepEqual(saved.lines, ['서성한']);
  assert.deepEqual(saved.universities, ['sogang', 'cau']);
});

test('체크한 대학이 있으면 목표 탭 셀렉트도 그 대학만 보여 준다', () => {
  const built = bootWith(FULL_SCORES, { universities: ['sogang', 'cau'] });
  built.tabs.find((tab) => tab.getAttribute('data-view') === 'target').dispatch('click');
  const options = built.panel.querySelectorAll('option').map((node) => node.text.trim());
  const universities = built.context.IPSI_DATA.universities;
  const shown = universities.filter((row) => options.includes(row.short)).map((row) => row.id);
  assert.deepEqual(shown.sort(), ['cau', 'sogang']);
});

test('ⓘ 는 상단바에 하나뿐이고 탭마다 다른 절로 보낸다', () => {
  const built = boot(FULL_SCORES);
  const anchors = { scores: 'scale', diagnose: 'verdict', target: 'verdict', rules: 'basis' };
  for (const [view, anchor] of Object.entries(anchors)) {
    built.tabs.find((tab) => tab.getAttribute('data-view') === view).dispatch('click');
    // 화면 안에는 ⓘ 가 없다 (FRAME §9.2).
    assert.equal(built.panel.querySelectorAll('.jr-info').length, 0, `${view}: 화면 안에 ⓘ 가 남아 있다`);
    assert.equal(built.info.hidden, false, `${view}: 상단바 ⓘ 가 보여야 한다`);
    assert.equal(built.info.getAttribute('data-anchor'), anchor, `${view}: ⓘ 목적지`);
    built.info.dispatch('click');
    assert.equal(built.tabs.find((tab) => tab.getAttribute('data-view') === 'about').getAttribute('aria-selected'), 'true',
      `${view}: ⓘ 가 정보 탭을 연다`);
    assert.ok(built.panel.querySelector(`#jr-about-${anchor}`), `정보 탭에 ${anchor} 절이 있다`);
    // 정보 탭에서는 ⓘ 를 감춘다.
    assert.equal(built.info.hidden, true, '정보 탭에서는 ⓘ 가 숨는다');
  }
});

test('등급 모드에서는 ⓘ 가 등급 표로 간다', () => {
  const built = boot({ ...FULL_SCORES, mode: 'grade', kor: '2', math: '1', inq1: '3', inq2: '3' });
  built.tabs.find((tab) => tab.getAttribute('data-view') === 'scores').dispatch('click');
  assert.equal(built.info.getAttribute('data-anchor'), 'convert');
});

test('계열은 셀렉트로, 나머지 필터는 줄바꿈하는 칩으로 나온다', () => {
  const { panel, tabs } = boot(FULL_SCORES);
  tabs.find((tab) => tab.getAttribute('data-view') === 'diagnose').dispatch('click');
  // 칩 목록은 FRAME §9.1 의 일곱 개뿐이다 — 계열 칩은 없다.
  const chips = panel.querySelector('.jr-chips').querySelectorAll('.seed-chip-tabs__trigger').map((node) => node.text.trim());
  assert.deepEqual(chips, ['라인', '대학', '관심 학과', '관심 대학', '예체능 제외', '말도 안되는거 제외', '여대 제외']);
  for (const gone of ['인문', '자연', '자유전공']) {
    assert.ok(!chips.includes(gone), `계열 칩 '${gone}' 이 남아 있다`);
  }
  // 계열 셀렉트가 셀렉트 줄 맨 앞이다.
  const selects = panel.querySelector('.jr-filters').querySelectorAll('.jr-select');
  assert.equal(selects.length, 3, '계열·판정·정렬 셋이다');
  assert.equal(selects[0].getAttribute('aria-label'), '계열');
  const options = selects[0].querySelectorAll('option').map((node) => node.text.trim());
  assert.deepEqual(options, ['계열 전체', '인문', '자연', '예체능', '의약', '자유전공']);
  // 검색은 셀렉트 줄 아래 한 줄이다.
  assert.ok(panel.querySelector('.jr-search-row').querySelector('[type="search"]'), '검색이 제 줄에 있어야 한다');
});

test('계열 셀렉트로 예체능을 고르면 예체능 제외 칩이 꺼진다', () => {
  const { panel, tabs, context } = boot(FULL_SCORES);
  tabs.find((tab) => tab.getAttribute('data-view') === 'diagnose').dispatch('click');
  const track = panel.querySelector('.jr-filters').querySelectorAll('.jr-select').find((node) => node.getAttribute('aria-label') === '계열');
  track.dispatch('change', { target: { value: '예체능' } });
  const saved = JSON.parse(context.localStorage.getItem('jr.filters'));
  assert.equal(saved.track, '예체능');
  assert.equal(saved.noArts, false, '예체능 제외가 함께 꺼져야 한다');
  const arts = panel.querySelector('.jr-chips').querySelectorAll('.seed-chip-tabs__trigger').find((node) => node.text.trim() === '예체능 제외');
  assert.equal(arts.getAttribute('aria-pressed'), 'false');
});

test('라인과 대학을 어긋나게 체크하면 목록이 비고 안내 한 줄만 남는다', () => {
  // 서성한 라인 + 중앙대(중경외시)는 교집합이 없다.
  const built = bootWith(FULL_SCORES, { lines: ['서성한'], universities: ['cau'] });
  const panel = openDiagnose(built);
  assert.equal(rowTitles(panel).length, 0, '행이 없어야 한다');
  assert.match(panel.text, /조건에 맞는 곳이 없습니다/u);
});

// ---------------------------------------------------------------- 비교 기준 회귀 (화면)
const GRADE_SCORES = {
  mode: 'grade', korElective: '화법과작문', kor: '3', mathElective: '확률과통계', math: '4',
  eng: '2', hist: '4', inq1Subject: '정치와법', inq1: '3', inq2Subject: '사회문화', inq2: '3',
};

test('등급만 넣으면 진단 화면이 추정 뱃지와 가정값·구간을 보여 준다', () => {
  const { panel, tabs } = boot(GRADE_SCORES);
  tabs.find((tab) => tab.getAttribute('data-view') === 'diagnose').dispatch('click');
  const text = panel.text;
  // 스탯 줄이 등급 추정임을 밝힌다.
  assert.match(text, /국·수·탐 평균 \(등급\)/u);
  assert.match(text, /78\.17/u);
  // 등급 입력은 보류하지 않는다 — 구간 중앙 백분위로 판정하고 '추정'이라 적는다.
  assert.ok(!/보류\s*\d+곳/u.test(text), '등급 입력에 보류 묶음이 남아 있다');
  assert.match(text, /추정/u);
  // 부제는 값만 — 가정값과 구간이 숫자로만 실린다.
  // 부제는 한 줄 — 구간은 가정값 괄호로 붙는다.
  assert.match(text, /가정 78\.2 \(71\.3~84\.0\)/u);
  assert.ok(!/·\s*구간 71\.3~84\.0/u.test(text), '구간이 따로 떨어진 조각으로 남아 있다');
  // 컷 옆 숫자는 관측 범위이지 신뢰구간이 아니다 — ± 를 쓰지 않는다.
  assert.ok(!/컷 \d+\.\d ±/u.test(text), '± 표기가 남아 있다');
  // 추정 행에는 컷의 연도 관측 범위를 적지 않는다 — 내 구간이 훨씬 넓어 줄만 밀린다.
  assert.ok(!/관측 \d+\.\d~\d+\.\d/u.test(text), '추정 행에 관측 범위가 남아 있다');
  // 판정 셀렉트에는 보류·기준 불일치가 그대로 남는다(성적이 비면 쓰인다).
  assert.match(text, /기준 불일치/u);
});

test('등급 입력의 목표 화면은 구간 하한·상한의 판정을 한 줄로 적는다', () => {
  const { panel, tabs } = boot(GRADE_SCORES);
  tabs.find((tab) => tab.getAttribute('data-view') === 'diagnose').dispatch('click');
  const search = panel.querySelector('[type="search"]');
  search.value = '숭실대 사회복지';
  search.dispatch('input');
  const row = panel.querySelectorAll('.jr-row').find((node) => node.text.includes('숭실대 사회복지'));
  assert.ok(row, '숭실대 사회복지학부 행이 없다');
  row.dispatch('click');
  const text = panel.text;
  // 어디가 70% 학생의 영역별 성적표가 들어오면서 이 행은 L2(반영비율 지수)가 됐다.
  // 판정 카드 부제는 지수 눈금이고 평균 백분위는 셋째 조각으로만 적는다 (FRAME §10.4).
  assert.match(text, /지수 컷 87\.5 · 내 지수 83\.5 · 평균 백분위 78\.2/u);
  assert.match(text, /비교 입결 2026 70% 학생 지수 87\.5 · 50% 90\.5 · 반영비율/u);
  // 구간도 지수 눈금에서 다시 계산돼(지수 78.2~88.0 · 컷 87.5) 상한 판정이 안정에서 소신이 됐다.
  // 요점은 하한·상한을 한 줄로 함께 적는다는 것이다 (docs/MODEL.md §4).
  assert.match(text, /구간 하한 위험 · 상한 소신/u);
  assert.match(text, /추정/u);
  assert.ok(!/판정 보류/u.test(text), '등급 입력에 보류 카드가 남아 있다');
});

test('정보 화면이 컷 정의별 내 계산과 남는 상태를 표로 적는다', () => {
  const { panel, tabs } = boot(GRADE_SCORES);
  tabs.find((tab) => tab.getAttribute('data-view') === 'about').dispatch('click');
  const text = panel.text;
  // 정의마다 내 성적을 같은 정의로 만든다.
  assert.match(text, /\(국어 \+ 수학 \+ 탐구2평균\) \/ 3/u);
  assert.match(text, /\(국어 \+ 수학 \+ 탐구 상위1\) \/ 3/u);
  // '(국어 + 탐구2평균) / 2'(건국대 예체능)는 어디가 원값이 들어오면서 데이터에서 사라졌다 —
  // 표는 데이터에 실제로 남아 있는 정의만 적는다.
  assert.match(text, /국어·수학·탐구2평균 중 상위 2개 평균/u);
  // 등급 입력 안내는 정보 탭에만 둔다.
  assert.match(text, /등급 구간의 중앙 백분위로 판정/u);
  assert.match(text, /백분위 입력/u);
  // 남는 상태는 사유 한 줄씩.
  assert.match(text, /남는 상태/u);
  assert.match(text, /과탐 필수·미적분 필수 미충족/u);
});

test('목표 화면은 반영비율 지수를 컷과 빼지 않는다고 적는다', () => {
  const { panel, tabs } = boot(FULL_SCORES);
  tabs.find((tab) => tab.getAttribute('data-view') === 'target').dispatch('click');
  const text = panel.text;
  assert.match(text, /반영비율 지수/u);
  assert.match(text, /컷과 눈금이 달라 차이를 내지 않음/u);
  // 판정 카드는 판정이 선 눈금으로 적는다 — L2면 지수와 평균 백분위 (FRAME §10.4).
  assert.match(text, /내 (국·수·탐|지수) \d+\.\d/u);
  assert.ok(!text.includes('내 환산'), "'내 환산' 문구가 남아 있다");
});

test('정보 화면의 비교 기준 표가 실제 계산과 같다', () => {
  const { panel, tabs } = boot(FULL_SCORES);
  tabs.find((tab) => tab.getAttribute('data-view') === 'about').dispatch('click');
  const text = panel.text;
  assert.match(text, /국·수·탐\(2\) 백분위 단순평균/u);
  assert.match(text, /반영비율 가중 지수 \(영어 포함\)/u);
  assert.match(text, /빼지 않는다/u);
  assert.match(text, /상위 2개 영역 백분위 평균/u);
  assert.match(text, /추가합격·충원율/u);
  assert.ok(!text.includes('내 환산'), "'내 환산' 문구가 남아 있다");
});

test('정보 화면의 이상치는 표가 아니라 §8.2 행 목록이다', () => {
  const { panel, tabs } = boot(FULL_SCORES);
  tabs.find((tab) => tab.getAttribute('data-view') === 'about').dispatch('click');
  const section = panel.querySelector('#jr-about-anomalies');
  assert.ok(section, '이상치 절이 있다');
  assert.equal(section.querySelectorAll('.jr-table').length, 0, '이상치 절에 표가 남아 있다');
  const rows = section.querySelectorAll('.jr-row');
  // 판정이 붙은 20곳 + 미확인·기준 두 줄.
  assert.ok(rows.length > 3, `행이 ${rows.length}개뿐이다`);

  // 부제는 값만 — 이력이 있으면 이력 차, 없으면 계열의 근거 값이다 (FRAME §9.4).
  // 값은 데이터를 따라간다(docs/MODEL.md §6에서 오류·펑크 규칙이 좁아져 실기만 남을 수 있다) —
  // 여기서 고정하는 것은 **모양**이다: 연도 · 값 · 근거 · 차.
  const text = section.text;
  assert.match(text, /2026 \d+\.\d · (이력|계열 중앙값) \d+\.\d · 차 [+−]\d+\.\d/u);
  assert.ok(!text.includes('분류'), "표의 '분류' 열이 남아 있다");

  // 순서: 펑크 의심 → 오류 의심 → 실기.
  const rank = { '펑크 의심': 0, '오류 의심': 1, 실기: 2 };
  const kinds = rows
    .map((row) => row.querySelector('.seed-badge__label')?.text.trim() || '')
    .filter((label) => label in rank)
    .map((label) => rank[label]);
  assert.deepEqual(kinds, [...kinds].sort((left, right) => left - right), `분류 순서가 어긋난다: ${kinds.join(' ')}`);

  // 목록 끝 두 행은 값만 적는다.
  assert.match(text, /미확인\(단일값\)/u);
  assert.match(text, /\|값 − 중앙값\| > max\(3, 2\.5 × MAD\)/u);

  // 행을 누르면 진단 행과 같이 목표 탭이 열린다.
  const first = rows.find((row) => row.tagName === 'BUTTON');
  assert.ok(first, '누를 수 있는 이상치 행이 없다');
  first.dispatch('click');
  assert.equal(tabs.find((tab) => tab.getAttribute('data-view') === 'target').getAttribute('aria-selected'), 'true');
});

// ---------------------------------------------------------------- 판정 층위 (FRAME §10)
// 지금 생성 데이터에는 어디가 원자료(영역별 성적표)도 산식 검산도 없어 L3·L0만 나온다.
// 화면은 네 층위를 모두 그릴 수 있어야 하므로, 엔진이 돌려줄 결과 객체(docs/MODEL.md §7)를
// 흉내 내어 한 모집단위에만 씌우고 그린다 — 데이터가 들어오면 같은 모양이 진짜로 나온다.
const FIXTURE = { universityId: 'kookmin', dept: '자유전공(A)', title: '국민대 자유전공 (A)' };

function bootLayered(scores, layer) {
  const built = buildContext();
  built.context.localStorage.setItem('jr.scores', JSON.stringify(scores));
  // 목록에서 그 한 곳만 남긴다 — 라인마다 위에서 여덟 곳씩만 보여 주기 때문이다.
  built.context.localStorage.setItem('jr.filters', JSON.stringify({ universities: [FIXTURE.universityId], query: FIXTURE.dept }));
  const real = built.context.IPSI_ENGINE;
  const mine = (universityId, deptName) => universityId === FIXTURE.universityId && deptName === FIXTURE.dept;
  const dress = (result) => ({ ...result, ...layer(result) });
  built.context.IPSI_ENGINE = {
    ...real,
    diagnose: (...args) => real.diagnose(...args)
      .map((row) => (mine(row.universityId, row.dept.name) ? { ...row, jeongsi: dress(row.jeongsi) } : row)),
    analyzeTarget: (profile, university, dept, ...rest) => {
      const result = real.analyzeTarget(profile, university, dept, ...rest);
      return mine(university.id, dept.name) ? dress(result) : result;
    },
  };
  vm.runInContext(readFileSync(path.join(ROOT, 'assets/app.js'), 'utf8'), built.context, { filename: 'assets/app.js' });
  return built;
}

// 국민대 자유전공(A) — docs/MODEL.md §0의 검산 예시 그대로다(70% 환산 659.0, 50% 660.5).
const L1 = (result) => ({
  level: 'L1',
  status: 'ok',
  group: '가',
  estimated: false,
  band: { key: 'stretch', label: '상향', uncertainty: 0.5, note: '70% 지점 대비' },
  gap: -1.9,
  gapDetail: { points: -6.7, pctEq: -1.9, min: -3, max: -1, avgGap: 0.3, basisChanged: false, gap2026: -1.9, gap2027: null },
  mineDetail: { score: 652.3, min: 648.1, max: 655, parts: [], adjustments: [], assumptions: [], unit: 'points' },
  cut: {
    ...result.cut, year: '2026', value: 654.2, aggregation: 'adiga-score-rank',
    score70: 659, score50: 660.5, verified: true,
  },
  apply: {
    year: 2027,
    typeName: '수능(일반학생전형)',
    group: '가',
    formula: {
      year: 2026, status: 'final', sourceGrade: 'A', track: '자유전공(A)',
      source: { title: '국민대학교 2026학년도 정시모집요강', url: 'https://admission.kookmin.ac.kr/', page: '53~54' },
    },
  },
  areas: [
    { area: 'kor', label: '국어', mine: 262.1, cut: 255.9, contrib: 6.2 },
    { area: 'math', label: '수학', mine: 180.2, cut: 189.2, contrib: -9 },
  ],
  sensitivity: null,
  uncertainty: 0.5,
  basisChanged: false,
  cut2027: null,
  flags: ['plan-formula'],
  sources: [
    { title: 'adiga-hakjum', url: 'https://hakjum.school/', year: '2026' },
    { title: '국민대학교 2026학년도 정시모집요강', url: 'https://admission.kookmin.ac.kr/', page: 53 },
  ],
});

const L2 = (result) => ({
  level: 'L2',
  status: 'ok',
  group: '가',
  estimated: false,
  band: { key: 'reach', label: '소신', uncertainty: 1, note: '70% 지점 대비' },
  gap: -1.2,
  gapDetail: { points: null, pctEq: -1.2, min: -1.2, max: -1.2, avgGap: -0.4, basisChanged: false, gap2026: -1.2, gap2027: null },
  mineDetail: { score: 79.4, min: 79.4, max: 79.4, parts: [], adjustments: [], assumptions: [], unit: 'pct' },
  // L2의 컷·내는 같은 반영비율로 매긴 **지수**다 (FRAME §10.4) — 평균 백분위는 avgMine 에만 있다.
  mine: 79.4,
  avgMine: 78.2,
  cut: {
    ...result.cut, year: '2026', value: 80.6, aggregation: 'adiga-score-rank',
    score70: null, score50: null, index70: 80.6, index50: 83.1, verified: false,
  },
  apply: { year: 2027, typeName: '수능(일반학생전형)', group: '가', formula: { year: 2027, status: 'plan', track: '인문', source: null } },
  areas: [{ area: 'math', label: '수학', mine: 93, cut: 96, contrib: -0.9 }],
  sensitivity: null,
  uncertainty: 1,
  flags: ['plan-formula'],
  sources: [{ title: 'adiga-hakjum', url: 'https://hakjum.school/', year: '2026' }],
});

const L0 = (result) => ({
  level: 'L0',
  status: 'ok',
  band: null,
  gap: null,
  gapDetail: { points: null, pctEq: null, min: null, max: null, avgGap: null, basisChanged: false, gap2026: null, gap2027: null },
  cut: { ...result.cut, aggregation: 'unknown' },
  flags: [],
  sources: [],
});

const fixtureRow = (panel) => panel.querySelectorAll('.jr-row')
  .find((row) => row.querySelector('.seed-list-item__title')?.text.trim() === FIXTURE.title);
const openFixture = (built) => {
  built.tabs.find((tab) => tab.getAttribute('data-view') === 'diagnose').dispatch('click');
  const row = fixtureRow(built.panel);
  assert.ok(row, `${FIXTURE.title} 행이 없다`);
  return row;
};

test('L1 진단 행은 점수 차와 괄호 백분위 상당, 값만 부제를 적는다', () => {
  const built = bootLayered(FULL_SCORES, L1);
  const row = openFixture(built);
  assert.equal(row.querySelector('.jr-gap').text.trim(), '−6.7점 (−1.9)');
  assert.equal(row.querySelector('.seed-list-item__detail').text.trim(),
    '2026 70% 659.0 · 내 652.3 (648~655) · 가군 · 2026 산식');
  // 뱃지는 판정 하나뿐이다 — 실제 수능 성적이고 L1이라 모의·근사·참고가 붙지 않는다.
  assert.deepEqual(row.querySelectorAll('.seed-badge__label').map((node) => node.text.trim()), ['상향']);
});

test('L1 목표 화면은 근거 카드에 라벨·값 행을 고정 순서로 적는다', () => {
  const built = bootLayered(FULL_SCORES, L1);
  openFixture(built).dispatch('click');
  const evidence = built.panel.querySelectorAll('.jr-section')
    .find((node) => node.querySelector('.seed-list-header')?.text.trim() === '근거');
  assert.ok(evidence, '근거 그룹이 없다');
  const labels = evidence.querySelectorAll('.seed-list-item__title').map((node) => node.text.trim());
  assert.deepEqual(labels, ['지원', '산식', '내 환산점수', '비교 입결', '차이', '판정', '유리·불리', '불확실성', '출처']);
  const text = evidence.text;
  assert.match(text, /2027 · 수능\(일반학생전형\) · 가군/u);
  // 산식은 요강 학년도 · 반영점수 · 눈금 · 검산 순이다(대조 행이 아직 없으면 '미대조').
  assert.match(text, /2026 요강 · 국400 수300 영100 탐200 · 표준점수 · (검산 일치|미대조)/u);
  assert.match(text, /652\.3 \(648\.1~655\.0\)/u);
  assert.match(text, /2026 70% 지점 659\.0 · 50% 660\.5 · 환산점수 순/u);
  assert.match(text, /−6\.7점 · 백분위 상당 −1\.9 · 평균 백분위로는 \+0\.3/u);
  assert.match(text, /70% 지점 대비 · 불확실성 ±0\.5/u);
  assert.match(text, /국어 \+6\.2 · 수학 −9\.0/u);
  assert.match(text, /2027 시행계획/u);
  // 출처 링크 글자는 대학명·학년도·문서 종류·쪽만 남긴 짧은 이름이다 (FRAME §10.4).
  assert.deepEqual(evidence.querySelectorAll('.jr-link').map((node) => node.text.trim()),
    ['어디가 2026', '국민대 2026 정시 요강 p.53']);
  // 층위 이름은 라벨로 쓰지 않고, 문장도 쓰지 않는다 (FRAME §10.2).
  for (const gone of ['L1', '봅니다', '입니다']) assert.ok(!text.includes(gone), `'${gone}' 이 남아 있다`);
});

test('L2 행은 백분위 차 하나와 근사 뱃지를 붙인다', () => {
  const built = bootLayered(FULL_SCORES, L2);
  const row = openFixture(built);
  assert.equal(row.querySelector('.jr-gap').text.trim(), '−1.2');
  assert.deepEqual(row.querySelectorAll('.seed-badge__label').map((node) => node.text.trim()), ['근사', '소신']);
  // 부제는 컷·내가 같은 지수 눈금이다 (FRAME §10.1·§10.4).
  assert.equal(row.querySelector('.seed-list-item__detail').text.trim(), '지수 컷 80.6 · 내 79.4 · 가군 · 반영비율');
  row.dispatch('click');
  const evidence = built.panel.querySelectorAll('.jr-section')
    .find((node) => node.querySelector('.seed-list-header')?.text.trim() === '근거');
  // 판정 카드 부제와 근거 카드 `비교 입결` 행도 같은 눈금이고, 평균 백분위는 셋째 조각이다.
  assert.match(built.panel.text, /지수 컷 80\.6 · 내 지수 79\.4 · 평균 백분위 78\.2/u);
  assert.match(evidence.text, /2026 70% 학생 지수 80\.6 · 50% 83\.1 · 반영비율/u);
});

test('L3 행은 참고 뱃지를 붙이고 컷의 통계 정의를 부제 끝에 적는다', () => {
  // 어디가 원값이 들어오면서 목록 첫 행은 L1·L2가 됐다. 진짜 L3 행(영역별 성적표가 없거나
  // consistent:false 라 지수·환산으로 못 올라간 곳)을 엔진에게 물어 그 행만 남기고 본다.
  const probe = buildContext();
  const { IPSI_ENGINE: engine, IPSI_DATA: data } = probe.context;
  const profile = engine.normalizeProfile(FULL_SCORES, data.scales, data.std);
  const l3 = engine.diagnose(profile, data).find((entry) => entry.jeongsi.status === 'ok' && entry.jeongsi.level === 'L3');
  assert.ok(l3, '생성 데이터에 L3 행이 없다');
  // 남은 L3는 실기 모집단위라 기본 필터(예체능·특수대학 제외)에 걸린다 — 그 둘만 열어 준다.
  const { panel, tabs } = bootWith(FULL_SCORES,
    { universities: [l3.universityId], query: l3.dept.name, noArts: false, noDream: false });
  tabs.find((tab) => tab.getAttribute('data-view') === 'diagnose').dispatch('click');
  const row = panel.querySelectorAll('.jr-row')
    .find((node) => node.querySelector('.jr-gap') && node.text.includes(l3.dept.name));
  assert.ok(row, `${l3.universityName} ${l3.dept.name} 행이 없다`);
  const badges = row.querySelectorAll('.seed-badge__label').map((node) => node.text.trim());
  // 성적 출처 기본값(모의고사) → 모의, 층위 L3 → 참고, 그리고 판정.
  assert.equal(badges[0], '모의');
  assert.equal(badges[1], '참고');
  assert.match(row.querySelector('.seed-list-item__detail').text,
    /(평균 백분위|과목별 평균|상위 2영역|국·탐 평균|국·수·탐1 평균)$/u);
});

test('L0 행은 차이를 적지 않고 미확인 뱃지를 붙인다', () => {
  const built = bootLayered(FULL_SCORES, L0);
  const row = openFixture(built);
  assert.equal(row.querySelector('.jr-gap').text.trim(), '—');
  assert.deepEqual(row.querySelectorAll('.seed-badge__label').map((node) => node.text.trim()), ['미확인']);
});

test('성적 출처 세그먼트가 모의·목표 뱃지를 갈아 끼우고 저장된다', () => {
  const { panel, tabs, context } = boot(FULL_SCORES);
  const scores = () => tabs.find((tab) => tab.getAttribute('data-view') === 'scores').dispatch('click');
  const diagnose = () => tabs.find((tab) => tab.getAttribute('data-view') === 'diagnose').dispatch('click');
  const control = () => panel.querySelectorAll('[role="radiogroup"]')
    .find((node) => node.getAttribute('aria-label') === '성적 출처');
  scores();
  assert.ok(control(), '성적 출처 세그먼트가 없다');
  const radios = control().querySelectorAll('[role="radio"]');
  assert.deepEqual(radios.map((node) => node.text.trim()), ['실제 수능', '모의고사', '목표']);
  // 기본값은 모의고사다 (docs/MODEL.md §4).
  assert.equal(radios[1].getAttribute('aria-checked'), 'true');
  diagnose();
  assert.match(panel.text, /모의/u);

  scores();
  control().querySelectorAll('[role="radio"]')[2].dispatch('click');
  assert.equal(JSON.parse(context.localStorage.getItem('jr.scores')).sourceKind, 'target');
  diagnose();
  assert.match(panel.text, /목표/u);

  scores();
  control().querySelectorAll('[role="radio"]')[0].dispatch('click');
  assert.equal(JSON.parse(context.localStorage.getItem('jr.scores')).sourceKind, 'actual');
  diagnose();
  assert.ok(!/모의/u.test(panel.text), "실제 수능인데 '모의' 뱃지가 남아 있다");
});

test('등급 입력은 성적 출처가 모의여도 추정 뱃지가 먼저다', () => {
  const { panel, tabs } = boot(GRADE_SCORES);
  tabs.find((tab) => tab.getAttribute('data-view') === 'diagnose').dispatch('click');
  const row = panel.querySelectorAll('.jr-row').find((node) => node.querySelector('.jr-gap'));
  const badges = row.querySelectorAll('.seed-badge__label').map((node) => node.text.trim());
  assert.equal(badges[0], '추정');
  assert.ok(!badges.includes('모의'), '추정과 모의가 함께 붙었다');
});

test('정보 탭에 층위 네 줄·산식 검산 절·어디가 각주 인용이 있다', () => {
  const { panel, tabs } = boot(FULL_SCORES);
  tabs.find((tab) => tab.getAttribute('data-view') === 'about').dispatch('click');
  const verdictText = panel.querySelector('#jr-about-verdict').text;
  for (const level of ['환산', '지수', '참고', '없음']) {
    assert.ok(verdictText.includes(level), `판정 표에 층위 '${level}' 줄이 없다`);
  }
  assert.match(verdictText, /70% 지점 · 보장선 아님/u);
  assert.match(verdictText, /합격 확률/u);

  const check = panel.querySelector('#jr-about-formula-check');
  assert.ok(check, '산식 검산 절이 없다');
  assert.match(check.text, /산식 검산/u);
  // 지금 데이터에는 대조 행이 없다 — 행이 없으면 한 줄로 끝난다.
  assert.match(check.text, /대조 행 없음|일치율 \d+%/u);

  const aggregation = panel.querySelector('#jr-about-aggregation');
  assert.ok(aggregation, '집계 기준 절이 없다');
  const quote = aggregation.querySelector('.jr-quote');
  assert.ok(quote, '인용 블록이 없다');
  assert.equal(quote.querySelectorAll('p').length, 4, '어디가 각주 네 줄');
  assert.match(quote.text, /50% cut : 최종등록자 중 수능 환산점수 순으로 상위 50%에 해당하는 점수/u);
});
