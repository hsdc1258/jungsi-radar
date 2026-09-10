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
