// 전 흐름 E2E: 성적 입력 → 진단 → 목표 → 반영 → 정보를 진짜 클릭·타이핑으로 걷는다.
// 폭 3종(375·768·1280) × 라이트/다크에서 백분위·등급·표준점수 세 입력 기준을 모두 지나고,
// 공유 링크(?k=…) 복원과 768px 미만 바텀시트(열기·완료·스크롤 보존)까지 본다.
// 콘솔 오류·요청 실패·가로 넘침·잘린 텍스트·작은 터치 타깃이 하나라도 있으면 실패로 끝난다.
import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { serve } from './serve.mjs';
import { measure } from './measure.mjs';

const ROOT = process.cwd();
const OUT = path.join(ROOT, '_shots');
const PORT = Number(process.env.E2E_PORT || 4184);
const CHROME = process.env.PW_CHROME || '';
const SEED_CDN = 'https://cdn.jsdelivr.net/npm/@seed-design/css@2.7.0/all.min.css';

// 입력 기준마다 실제로 두드릴 값. 화면에 적는 순서 그대로다.
const CASES = {
  pct: {
    label: '백분위',
    korElective: '언어와매체', kor: '96', mathElective: '미적분', math: '93',
    eng: '2', hist: '1', inq1Subject: '사회문화', inq1: '95', inq2Subject: '생활과윤리', inq2: '92',
  },
  grade: {
    label: '등급',
    korElective: '화법과작문', kor: '2', mathElective: '확률과통계', math: '3',
    eng: '2', hist: '3', inq1Subject: '정치와법', inq1: '3', inq2Subject: '사회문화', inq2: '3',
  },
  std: {
    label: '표준점수',
    korElective: '언어와매체', kor: '131', mathElective: '미적분', math: '128',
    eng: '2', hist: '1', inq1Subject: '생활과윤리', inq1: '65', inq2Subject: '한국지리', inq2: '67',
  },
};
const VIEWPORTS = [
  { width: 375, theme: 'light' },
  { width: 375, theme: 'dark' },
  { width: 768, theme: 'light' },
  { width: 768, theme: 'dark' },
  { width: 1280, theme: 'light' },
  { width: 1280, theme: 'dark' },
];
// 공유 링크 한 판. 주소만으로 진단 화면이 열려야 한다.
const SHARE_QUERY = '?k=95&m=90&e=1&h=1&i1=93&i2=91&s1=%EC%82%AC%ED%9A%8C%EB%AC%B8%ED%99%94'
  + '&s2=%EC%83%9D%ED%99%9C%EA%B3%BC%EC%9C%A4%EB%A6%AC&ke=%EC%96%B8%EC%96%B4%EC%99%80%EB%A7%A4%EC%B2%B4'
  + '&me=%EB%AF%B8%EC%A0%81%EB%B6%84&md=pct';

mkdirSync(OUT, { recursive: true });
// 검사용 브라우저에는 바깥 네트워크가 없다. 사본을 받아 두고 그것을 물려준다(shots.mjs 와 같은 파일).
const seedCache = path.join(OUT, 'seed-all.min.css');
if (!existsSync(seedCache)) {
  const response = await fetch(SEED_CDN);
  if (!response.ok) throw new Error(`Seed CSS 사본을 받지 못했습니다: ${response.status}`);
  writeFileSync(seedCache, await response.text(), 'utf8');
}
const seedCss = readFileSync(seedCache, 'utf8');

const problems = [];
// 데이터가 아직 없어 건너뛴 시나리오. 실패는 아니지만 마지막에 반드시 적는다.
const notes = [];
const web = serve(ROOT, PORT);
await web.ready;
const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});

function watch(page, tag) {
  page.on('pageerror', (error) => problems.push(`${tag}: 스크립트 오류 ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') problems.push(`${tag}: 콘솔 ${message.type()} ${message.text().slice(0, 160)}`);
  });
  page.on('requestfailed', (request) => problems.push(`${tag}: 요청 실패 ${request.url().slice(0, 90)} ${request.failure()?.errorText}`));
  page.on('response', (response) => {
    if (response.status() >= 400) problems.push(`${tag}: HTTP ${response.status()} ${response.url().slice(0, 90)}`);
  });
}

// 한 화면을 재고 문제를 모은다 (shots.mjs 와 같은 measure).
async function look(page, tag) {
  const info = await page.evaluate(measure);
  if (info.over > 0) problems.push(`${tag}: 가로 넘침 +${info.over}px — ${info.offenders.join(' | ')}`);
  if (info.empty) problems.push(`${tag}: 패널이 비었다`);
  for (const item of info.truncated) problems.push(`${tag}: 잘린 텍스트 ${item}`);
  for (const item of info.small) problems.push(`${tag}: 터치 타깃 44px 미만 ${item}`);
  for (const item of info.contrast) problems.push(`${tag}: 대비 4.5:1 미만 ${item}`);
  for (const item of info.overlaps) problems.push(`${tag}: ${item}`);
}

// 칩 묶음이 뷰포트 안에서 줄바꿈하는지 (FRAME §9.1).
function chipFit() {
  const chips = document.querySelector('.jr-chips');
  if (!chips) return { missing: true, out: [] };
  const style = getComputedStyle(chips);
  return {
    missing: false,
    wrap: style.flexWrap,
    overflowX: style.overflowX,
    out: [...chips.children]
      .filter((node) => node.getBoundingClientRect().right > window.innerWidth + 0.5)
      .map((node) => `${node.textContent.trim()} right=${Math.round(node.getBoundingClientRect().right)}`),
  };
}

function sheetShape() {
  const content = document.querySelector('.jr-sheet .seed-bottom-sheet__content');
  const active = document.activeElement;
  return {
    open: Boolean(content) && content.getBoundingClientRect().height > 0,
    title: content?.querySelector('.seed-bottom-sheet__title')?.textContent.trim() || '',
    // 다중 선택(라인·대학)은 checkbox, 단일 선택(전형)은 radio다 (FRAME §11).
    rows: content ? content.querySelectorAll('[role="checkbox"], [role="radio"]').length : 0,
    focusInside: Boolean(content && active && content.contains(active)),
    locked: getComputedStyle(document.documentElement).overflow === 'hidden',
  };
}

// 성적 화면을 실제로 두드린다.
async function typeScores(page, mode) {
  const values = CASES[mode];
  await page.click(`.seed-segmented-control__item:has-text("${values.label}")`);
  await page.waitForTimeout(120);
  await page.selectOption('select[aria-label="국어 선택과목"]', values.korElective);
  await page.selectOption('select[aria-label="수학 선택과목"]', values.mathElective);
  await page.selectOption('select[aria-label="탐구 1 선택과목"]', values.inq1Subject);
  await page.selectOption('select[aria-label="탐구 2 선택과목"]', values.inq2Subject);
  await page.selectOption('#jr-eng', values.eng);
  await page.selectOption('#jr-hist', values.hist);
  for (const field of ['kor', 'math', 'inq1', 'inq2']) {
    const input = page.locator(`#jr-${field}`);
    await input.click();
    await input.fill('');
    await input.pressSequentially(values[field], { delay: 12 });
  }
  await page.waitForTimeout(120);
}

// 성적 → 진단 → 목표 → 반영 → 정보 한 바퀴.
async function walk(page, tag, mode) {
  await page.click('.seed-tabs__trigger[data-view="scores"]');
  await page.waitForSelector('#panel .seed-segmented-control__root');
  await typeScores(page, mode);
  await look(page, `${tag}/성적`);

  const average = await page.textContent('.jr-stat-value');
  if (!average || average.trim() === '—') problems.push(`${tag}/성적: 평균이 나오지 않는다 (${average})`);

  // 하단 고정 '진단 보기'로 넘어간다.
  const action = page.locator('.jr-sticky-action button');
  if (await action.getAttribute('disabled') !== null) problems.push(`${tag}/성적: 다 넣었는데 '진단 보기'가 잠겨 있다`);
  await action.click();
  await page.waitForSelector('.jr-chips');
  await look(page, `${tag}/진단`);

  const fit = await page.evaluate(chipFit);
  if (fit.missing) problems.push(`${tag}/진단: 칩 묶음이 없다`);
  for (const item of fit.out) problems.push(`${tag}/진단: 칩이 뷰포트를 넘는다 — ${item}`);
  if (!fit.missing && fit.wrap !== 'wrap') problems.push(`${tag}/진단: 칩이 줄바꿈하지 않는다 (${fit.wrap})`);
  if (!fit.missing && (fit.overflowX === 'auto' || fit.overflowX === 'scroll')) {
    problems.push(`${tag}/진단: 칩 묶음이 가로 스크롤한다 (${fit.overflowX})`);
  }

  const rows = await page.locator('#panel .jr-row .jr-gap').count();
  if (rows === 0) problems.push(`${tag}/진단: 판정 행이 하나도 없다`);
  // 등급으로 넣으면 '추정' 뱃지가 붙는다 (FRAME §8.2).
  if (mode === 'grade' && (await page.locator('#panel .seed-badge__root:has-text("추정")').count()) === 0) {
    problems.push(`${tag}/진단: 등급 입력인데 '추정' 뱃지가 없다`);
  }

  // 검색을 진짜로 쳐 본다 — 목록이 좁아져야 한다.
  const search = page.locator('#panel [type="search"]');
  await search.click();
  await search.pressSequentially('경영', { delay: 12 });
  await page.waitForTimeout(180);
  const searched = await page.locator('#panel .jr-row .jr-gap').count();
  if (searched === 0) problems.push(`${tag}/진단: '경영' 검색에 아무것도 남지 않는다`);
  await search.fill('');
  await page.waitForTimeout(180);

  // 행을 눌러 목표 화면으로.
  await page.locator('#panel .jr-row').filter({ has: page.locator('.jr-gap') }).first().click();
  await page.waitForSelector('#panel .jr-verdict, #panel .seed-inline-banner__root');
  await look(page, `${tag}/목표`);
  if (await page.locator('#panel .jr-verdict-number').count() === 0
    && await page.locator('#panel .seed-inline-banner__root').count() === 0) {
    problems.push(`${tag}/목표: 판정 카드도 안내도 없다`);
  }

  await page.click('.seed-tabs__trigger[data-view="rules"]');
  await page.waitForSelector('#panel .jr-filters');
  await look(page, `${tag}/반영`);
  if (!(await page.textContent('#panel')).includes('반영')) problems.push(`${tag}/반영: 반영 지표가 없다`);

  // 상단바 ⓘ 로 정보 탭의 해당 절을 연다 (FRAME §9.2).
  const anchor = await page.getAttribute('#infoButton', 'data-anchor');
  if (anchor !== 'basis') problems.push(`${tag}/반영: ⓘ 목적지가 ${anchor}`);
  await page.click('#infoButton');
  await page.waitForSelector('#panel #jr-about-basis');
  await look(page, `${tag}/정보`);
  if (await page.getAttribute('#infoButton', 'hidden') === null) problems.push(`${tag}/정보: 정보 탭인데 ⓘ 가 남아 있다`);
}

// 전형 고르기 (FRAME §11). 768px 미만은 시트, 이상은 인라인 단일 선택 목록이다.
// 데이터에 `types[]`가 없으면 고를 수 있는 전형이 `일반` 하나뿐이라 농어촌 판은 건너뛰고 그 사실만 적는다.
async function typeRun(page, tag) {
  await page.click('.seed-tabs__trigger[data-view="diagnose"]');
  await page.waitForSelector('.jr-chips');
  const opener = page.locator('[data-sheet-opener="type"]');
  if (await opener.count() === 0) { problems.push(`${tag}/전형: 전형 칩이 없다`); return; }
  const label = (await opener.textContent()).trim();
  if (label !== '일반') problems.push(`${tag}/전형: 기본 칩 글자가 '${label}' 이다`);
  const narrow = (page.viewportSize()?.width || 0) < 768;
  await opener.click();
  await page.waitForTimeout(240);
  const shape = await page.evaluate(sheetShape);
  if (narrow && !shape.open) { problems.push(`${tag}/전형: 전형 시트가 열리지 않았다`); return; }
  if (narrow && shape.title !== '전형') problems.push(`${tag}/전형: 시트 제목이 ${shape.title}`);
  if (!narrow && shape.open) problems.push(`${tag}/전형: 768px 이상인데 시트가 떴다`);

  const scope = narrow ? '.jr-sheet' : '#panel';
  const rows = page.locator(`${scope} [role="radio"]`);
  const labels = (await rows.locator('.seed-list-item__title').allTextContents()).map((text) => text.trim());
  if (labels.length === 0) { problems.push(`${tag}/전형: 단일 선택 목록이 없다`); return; }
  if (labels[0] !== '일반') problems.push(`${tag}/전형: 첫 행이 '${labels[0]}' 이다`);
  const checked = await rows.evaluateAll((nodes) => nodes.filter((node) => node.getAttribute('aria-checked') === 'true').length);
  if (checked !== 1) problems.push(`${tag}/전형: 단일 선택인데 켜진 행이 ${checked}개다`);

  const index = labels.indexOf('농어촌');
  if (index === -1) {
    notes.push(`${tag}/전형: 데이터에 types[]가 없어 고를 수 있는 전형이 ${labels.join('·')} 뿐 — 농어촌 판 건너뜀`);
    if (narrow) await page.locator('.jr-sheet-footer button:has-text("완료")').click();
    else await opener.click();
    await page.waitForTimeout(200);
    return;
  }

  await rows.nth(index).click();
  await page.waitForTimeout(220);
  if (narrow) {
    await page.locator('.jr-sheet-footer button:has-text("완료")').click();
    await page.waitForTimeout(240);
  }
  const chip = (await page.locator('[data-sheet-opener="type"]').textContent()).trim();
  if (chip !== '농어촌') problems.push(`${tag}/전형: 고른 뒤 칩이 '${chip}' 이다`);
  const stats = await page.locator('#panel .jr-stat-label').allTextContents();
  if (!stats.some((text) => text.trim() === '지원 가능 · 농어촌')) {
    problems.push(`${tag}/전형: 스탯 라벨이 ${stats.map((text) => text.trim()).join(' / ')}`);
  }
  const listed = await page.locator('#panel .jr-row .jr-gap').count();
  if (listed === 0) problems.push(`${tag}/전형: 농어촌 판정 행이 하나도 없다`);
  await look(page, `${tag}/전형`);

  // 목표 탭에도 같은 전형이 실려 있어야 한다.
  await page.locator('#panel .jr-row').filter({ has: page.locator('.jr-gap') }).first().click();
  await page.waitForSelector('#panel .jr-verdict, #panel .seed-inline-banner__root');
  const typeSelect = page.locator('#panel select[aria-label="전형"]');
  if (await typeSelect.count() === 0) problems.push(`${tag}/전형: 목표 화면에 전형 셀렉트가 없다`);
  else {
    const value = await typeSelect.inputValue();
    if (value !== 'rural') problems.push(`${tag}/전형: 목표 전형 셀렉트가 ${value} 다`);
    const options = await typeSelect.locator('option').allTextContents();
    if (!options.map((text) => text.trim()).includes('농어촌')) problems.push(`${tag}/전형: 목표 셀렉트에 농어촌이 없다`);
  }
  await look(page, `${tag}/전형 목표`);

  // 다음 판을 위해 일반으로 되돌린다.
  await page.click('.seed-tabs__trigger[data-view="diagnose"]');
  await page.waitForSelector('.jr-chips');
  await page.locator('[data-sheet-opener="type"]').click();
  await page.waitForTimeout(220);
  await page.locator(`${narrow ? '.jr-sheet' : '#panel'} [role="radio"]`).first().click();
  await page.waitForTimeout(200);
  if (narrow) {
    await page.locator('.jr-sheet-footer button:has-text("완료")').click();
    await page.waitForTimeout(220);
  } else {
    await page.locator('[data-sheet-opener="type"]').click();
    await page.waitForTimeout(200);
  }
}

// 768px 미만에서 시트를 열고 골라 '완료'로 닫는다. 패널 스크롤 자리는 그대로여야 한다.
async function sheetRun(page, tag) {
  await page.click('.seed-tabs__trigger[data-view="diagnose"]');
  await page.waitForSelector('.jr-chips');
  await page.evaluate(() => window.scrollTo(0, 360));
  await page.waitForTimeout(100);
  const before = await page.evaluate(() => Math.round(window.scrollY));
  // 내려 둔 자리에서 그대로 연다. 마우스 클릭은 칩을 화면 안으로 끌어올리느라 스크롤을 건드리므로
  // 이 한 번만 DOM 클릭으로 연다(아래 다시 열 때부터는 진짜 마우스로 누른다).
  await page.locator('[data-sheet-opener="line"]').dispatchEvent('click');
  await page.waitForTimeout(220);
  const open = await page.evaluate(sheetShape);
  if (!open.open) problems.push(`${tag}/시트: 라인 시트가 열리지 않았다`);
  if (open.title !== '라인') problems.push(`${tag}/시트: 제목이 ${open.title}`);
  if (open.rows === 0) problems.push(`${tag}/시트: 행이 없다`);
  if (!open.focusInside) problems.push(`${tag}/시트: 포커스가 시트 밖이다`);
  if (!open.locked) problems.push(`${tag}/시트: 뒤 화면 스크롤이 잠기지 않았다`);
  // 아무것도 고르지 않고 시트 바깥(어두운 자리)을 눌러 닫으면 스크롤 자리가 한 픽셀도 움직이지 않는다.
  await page.locator('.jr-sheet .seed-bottom-sheet__positioner').click({ position: { x: 10, y: 10 } });
  await page.waitForTimeout(220);
  const kept = await page.evaluate(() => Math.round(window.scrollY));
  if (kept !== before) problems.push(`${tag}/시트: 배경으로 닫았더니 스크롤이 ${before} → ${kept}`);
  const focusBack = await page.evaluate(() => document.activeElement?.getAttribute('data-sheet-opener') || '');
  if (focusBack !== 'line') problems.push(`${tag}/시트: 닫은 뒤 포커스가 칩으로 돌아오지 않았다 (${focusBack})`);

  // 다시 열어 첫 행을 진짜로 누르고 '완료'.
  await page.locator('[data-sheet-opener="line"]').click();
  await page.waitForTimeout(220);
  await page.locator('.jr-sheet [role="checkbox"]').first().click();
  await page.waitForTimeout(160);
  await page.locator('.jr-sheet-footer button:has-text("완료")').click();
  await page.waitForTimeout(240);
  const closed = await page.evaluate(sheetShape);
  if (closed.open) problems.push(`${tag}/시트: '완료'로 닫히지 않는다`);
  if (closed.locked) problems.push(`${tag}/시트: 닫았는데 스크롤 잠금이 남았다`);
  const chip = (await page.textContent('[data-sheet-opener="line"]')).trim();
  if (!/^라인 \d+$/u.test(chip)) problems.push(`${tag}/시트: 닫은 뒤 칩이 '${chip}' 이다`);
  // 라인을 고르면 목록이 짧아져 그만큼 아래로 못 내려간다 — 남은 높이까지는 그대로여야 한다.
  const place = await page.evaluate(() => ({
    y: Math.round(window.scrollY),
    max: Math.max(0, Math.round(document.documentElement.scrollHeight - window.innerHeight)),
  }));
  const want = Math.min(before, place.max);
  if (Math.abs(place.y - want) > 40) problems.push(`${tag}/시트: 패널 스크롤이 ${before} → ${place.y} 로 튀었다 (갈 수 있는 자리 ${want})`);
  await look(page, `${tag}/시트 뒤`);
  // 골랐던 라인을 다시 풀어 둔다.
  await page.locator('[data-sheet-opener="line"]').click();
  await page.waitForTimeout(200);
  await page.locator('.jr-sheet-footer button:has-text("모두 해제")').click();
  await page.waitForTimeout(160);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}

// 375에서 대학 시트를 열어 둔 채 1280으로 넓히면 시트는 사라지고 같은 체크 목록이 인라인으로
// 이어져야 한다 — 칩도 열림 상태다 (FRAME §9.4).
async function widenRun(page, tag) {
  await page.click('.seed-tabs__trigger[data-view="diagnose"]');
  await page.waitForSelector('.jr-chips');
  await page.locator('[data-sheet-opener="university"]').click();
  await page.waitForTimeout(240);
  if (!(await page.evaluate(sheetShape)).open) {
    problems.push(`${tag}/넓히기: 375에서 대학 시트가 열리지 않았다`);
    return;
  }
  await page.setViewportSize({ width: 1280, height: 812 });
  await page.waitForTimeout(320);
  const after = await page.evaluate(sheetShape);
  if (after.open) problems.push(`${tag}/넓히기: 1280으로 넓혔는데 시트가 남아 있다`);
  if (after.locked) problems.push(`${tag}/넓히기: 넓혔는데 스크롤 잠금이 남았다`);
  const inline = await page.locator('#panel [role="checkbox"]').count();
  if (inline === 0) problems.push(`${tag}/넓히기: 인라인 체크 행이 하나도 없다`);
  const expanded = await page.getAttribute('[data-sheet-opener="university"]', 'aria-expanded');
  if (expanded !== 'true') problems.push(`${tag}/넓히기: 대학 칩이 열림 상태가 아니다 (${expanded})`);
  await look(page, `${tag}/넓히기`);
  // 다시 좁혀 두고 인라인 목록을 접는다 — 다음 판이 375에서 시작한다.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(320);
}

try {
  for (const { width, theme } of VIEWPORTS) {
    const tag = `${width}px/${theme}`;
    const page = await browser.newPage({ viewport: { width, height: 812 }, colorScheme: theme });
    watch(page, tag);
    await page.route(SEED_CDN, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: seedCss }));
    await page.addInitScript((mode) => {
      localStorage.setItem('jr.theme', JSON.stringify(mode));
    }, theme === 'dark' ? 'dark-only' : 'light-only');
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
    await page.waitForSelector('#panel .seed-segmented-control__root');
    for (const mode of ['pct', 'grade', 'std']) {
      await walk(page, `${tag}/${CASES[mode].label}`, mode);
    }
    await typeRun(page, tag);
    if (width < 768) {
      await sheetRun(page, tag);
      await widenRun(page, tag);
    } else {
      // 넓은 폭에서는 같은 칩이 패널 안에서 펼쳐진다.
      await page.click('.seed-tabs__trigger[data-view="diagnose"]');
      await page.waitForSelector('.jr-chips');
      await page.locator('[data-sheet-opener="line"]').click();
      await page.waitForTimeout(200);
      const shape = await page.evaluate(sheetShape);
      if (shape.open) problems.push(`${tag}: 768px 이상인데 시트가 떴다`);
      if (await page.locator('#panel [role="checkbox"]').count() === 0) problems.push(`${tag}: 인라인 체크 목록이 없다`);
      await look(page, `${tag}/인라인 체크`);
    }
    await page.close();
  }

  // 공유 링크. 주소의 성적을 되읽고 바로 진단 화면을 연다.
  {
    const tag = '공유링크/375px';
    const page = await browser.newPage({ viewport: { width: 375, height: 812 }, colorScheme: 'light' });
    watch(page, tag);
    await page.route(SEED_CDN, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: seedCss }));
    await page.goto(`http://127.0.0.1:${PORT}/${SHARE_QUERY}`, { waitUntil: 'load' });
    await page.waitForSelector('.jr-chips');
    const selected = await page.getAttribute('.seed-tabs__trigger[data-view="diagnose"]', 'aria-selected');
    if (selected !== 'true') problems.push(`${tag}: 링크로 들어왔는데 진단 탭이 아니다`);
    if (new URL(page.url()).search !== '') problems.push(`${tag}: 주소에 성적이 남아 있다 (${page.url()})`);
    if (await page.locator('#panel .jr-row .jr-gap').count() === 0) problems.push(`${tag}: 링크 성적으로 판정이 나오지 않는다`);
    await page.click('.seed-tabs__trigger[data-view="scores"]');
    await page.waitForSelector('#jr-kor');
    const kor = await page.inputValue('#jr-kor');
    if (kor !== '95') problems.push(`${tag}: 국어가 ${kor} 로 복원됐다`);
    const elective = await page.inputValue('select[aria-label="국어 선택과목"]');
    if (elective !== '언어와매체') problems.push(`${tag}: 국어 선택과목이 ${elective} 로 복원됐다`);
    await look(page, `${tag}/성적`);
    await page.close();
  }
} finally {
  await browser.close();
  await web.close();
}

if (notes.length > 0) console.log(`건너뜀 ${notes.length}건\n${notes.join('\n')}`);
console.log(problems.length
  ? `문제 ${problems.length}건\n${problems.join('\n')}`
  : `문제 없음 — 폭 ${VIEWPORTS.length / 2}종 × 2테마 × 입력 기준 3종 전 흐름 + 전형 ${VIEWPORTS.length}판`
    + ' + 시트 2판 + 넓히기 2판 + 공유 링크 1판 통과');
process.exit(problems.length ? 1 : 0);
