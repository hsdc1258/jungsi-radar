// 브라우저 점검: 정적 서버를 띄우고 폭 6종 × 라이트/다크 × 다섯 탭을 모두 연다.
// 가로 넘침, 고정바 겹침, 잘린 텍스트, 콘솔 오류, 실패한 요청이 하나라도 있으면 실패로 끝난다.
// 단일 파일 번들(dist/jungsi-radar.html)도 호스트 테마를 찍은 경우와 아닌 경우로 함께 본다.
import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { serve } from './serve.mjs';
import { measure } from './measure.mjs';

const ROOT = process.cwd();
const OUT = path.join(ROOT, '_shots');
const PORT = Number(process.env.PORT || 4183);
const CHROME = process.env.PW_CHROME || '';
const VIEWS = ['scores', 'diagnose', 'target', 'rules', 'about'];
const WIDTHS = [320, 375, 414, 768, 1024, 1280];
const SHOT_WIDTHS = new Set([375, 1280]);
const SCORES = {
  mode: 'pct', korElective: '언어와매체', kor: '96', mathElective: '미적분', math: '93',
  eng: '2', hist: '1', inq1Subject: '사회문화', inq1: '95', inq2Subject: '생활과윤리', inq2: '92', gpa: '2.1',
};
const FAVORITES = ['korea::경영대학', 'yonsei::경영학과', 'hanyang::경영학부'];
// 표준점수 모드(표점 계산기)와 관심 대학 묶음도 실제 브라우저에서 한 번씩 연다.
const STD_SCORES = {
  mode: 'std', korElective: '언어와매체', kor: '131', mathElective: '미적분', math: '128',
  eng: '2', hist: '1', inq1Subject: '생활과윤리', inq1: '65', inq2Subject: '한국지리', inq2: '67', gpa: '',
};
const FAV_UNIVERSITIES = ['khu', 'cau', 'konkuk'];
// 등급 입력. 입력 칸 옆 환산값이 좁은 폭에서 줄을 밀지 않는지 함께 본다.
const GRADE_SCORES = {
  mode: 'grade', korElective: '언어와매체', kor: '2', mathElective: '미적분', math: '1',
  eng: '2', hist: '1', inq1Subject: '사회문화', inq1: '3', inq2Subject: '생활과윤리', inq2: '3', gpa: '2.1',
};

const SEED_CDN = 'https://cdn.jsdelivr.net/npm/@seed-design/css@2.7.0/all.min.css';
mkdirSync(OUT, { recursive: true });
// 검사용 브라우저에는 바깥 네트워크가 없다. 처음 한 번 CDN 사본을 받아 두고 그 뒤로는 그것을 쓴다.
const seedCache = path.join(OUT, 'seed-all.min.css');
if (!existsSync(seedCache)) {
  const response = await fetch(SEED_CDN);
  if (!response.ok) throw new Error(`Seed CSS 사본을 받지 못했습니다: ${response.status}`);
  writeFileSync(seedCache, await response.text(), 'utf8');
}
const seedCss = readFileSync(seedCache, 'utf8');

const problems = [];
const web = serve(ROOT, PORT);
await web.ready;
// 내려받아 둔 크로미움을 그대로 쓴다. PW_CHROME 이 있으면 그 실행 파일로 대신 연다(리눅스 컨테이너용).
const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});

async function auditPage(page, tag, { shots = false, prefix = '' } = {}) {
  for (const view of VIEWS) {
    await page.click(`.seed-tabs__trigger[data-view="${view}"]`);
    await page.waitForTimeout(140);
    const info = await page.evaluate(measure);
    if (info.over > 0) problems.push(`${tag}/${view}: 가로 넘침 +${info.over}px — ${info.offenders.join(' | ')}`);
    if (info.empty) problems.push(`${tag}/${view}: 패널이 비었다`);
    for (const item of info.truncated) problems.push(`${tag}/${view}: 잘린 텍스트 ${item}`);
    for (const item of info.small) problems.push(`${tag}/${view}: 터치 타깃 44px 미만 ${item}`);
    for (const item of info.contrast) problems.push(`${tag}/${view}: 대비 4.5:1 미만 ${item}`);
    for (const item of info.overlaps) problems.push(`${tag}/${view}: ${item}`);
    if (shots) await page.screenshot({ path: path.join(OUT, `${prefix}${view}.png`), fullPage: view !== 'diagnose' });
  }
}

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

// 필터 칩 묶음. 줄바꿈해서 모든 칩이 뷰포트 안에 있어야 한다 (FRAME §9.1).
function chipFit() {
  const chips = document.querySelector('.jr-chips');
  if (!chips) return { missing: true, out: [], rows: 0 };
  const style = getComputedStyle(chips);
  const items = [...chips.children];
  return {
    missing: false,
    wrap: style.flexWrap,
    overflowX: style.overflowX,
    marginLeft: style.marginLeft,
    count: items.length,
    rows: new Set(items.map((node) => Math.round(node.getBoundingClientRect().top))).size,
    out: items
      .filter((node) => node.getBoundingClientRect().right > window.innerWidth + 0.5)
      .map((node) => `${node.textContent.trim()} right=${Math.round(node.getBoundingClientRect().right)}`),
  };
}

// 진단 행 다이어트 (FRAME §12.2). 375px 실화면에서 값·뱃지 수·부제와 제목 줄 수를 잰다.
// 제목은 블록이라 줄 상자를 셀 수 없다 — 높이를 줄 높이로 나눈다.
function rowShape() {
  const out = [];
  for (const row of document.querySelectorAll('#panel .jr-row')) {
    const gap = row.querySelector('.jr-gap');
    if (!gap) continue;
    const title = row.querySelector('.seed-list-item__title');
    const style = title ? getComputedStyle(title) : null;
    const lineHeight = style ? (parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4) : 0;
    out.push({
      title: title ? title.textContent.trim() : '',
      lines: title ? Math.max(1, Math.round(title.getBoundingClientRect().height / lineHeight)) : 0,
      // 두 줄 말줄임(-webkit-line-clamp)에 걸렸는지 — 그린 높이는 두 줄이어도 글은 더 길다.
      clipped: Boolean(title && title.scrollHeight > title.clientHeight + 1),
      badges: row.querySelectorAll('.seed-badge__root').length,
      gap: gap.textContent.trim(),
      detail: row.querySelector('.seed-list-item__detail')?.textContent.trim() || '',
    });
  }
  return out;
}

// 칩을 글자로 찾아 누른다 (칩에는 체크 수가 붙을 수 있다).
async function clickChip(page, text) {
  await page.evaluate((label) => {
    const chip = [...document.querySelectorAll('.jr-chips .seed-chip-tabs__trigger')]
      .find((node) => node.textContent.trim().split(' ')[0] === label);
    chip?.click();
  }, text);
}

// 시트가 떠 있는지, 그 안이 어떤지. 브라우저 안에서 도는 함수라 밖의 변수를 쓰지 않는다.
function sheetShape() {
  const content = document.querySelector('.jr-sheet .seed-bottom-sheet__content');
  const body = document.querySelector('.jr-sheet .seed-bottom-sheet__body');
  const inline = document.querySelector('#panel [role="checkbox"]');
  const rows = content
    ? content.querySelectorAll('[role="checkbox"]').length
    : document.querySelectorAll('#panel [role="checkbox"]').length;
  const small = [];
  for (const node of content ? content.querySelectorAll('button, [role="checkbox"]') : []) {
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    // Seed 의 닫기 버튼은 28px 원 둘레에 :after 로 44px 손가락 자리를 둔다.
    if (node.classList.contains('seed-bottom-sheet__closeButton')) continue;
    if (rect.height >= 43.5) continue;
    small.push(`${(node.className || '').toString().split(' ')[0]} ${Math.round(rect.width)}x${Math.round(rect.height)}`);
  }
  const active = document.activeElement;
  return {
    open: Boolean(content) && content.getBoundingClientRect().height > 0,
    title: content?.querySelector('.seed-bottom-sheet__title')?.textContent.trim() || '',
    labelled: Boolean(content?.getAttribute('aria-labelledby')
      && document.getElementById(content.getAttribute('aria-labelledby'))),
    rows,
    checked: content ? content.querySelectorAll('[aria-checked="true"]').length : 0,
    clearButton: Boolean(content && [...content.querySelectorAll('button')]
      .some((node) => node.textContent.trim() === '모두 해제')),
    inline: Boolean(inline),
    bodyOverflow: body ? getComputedStyle(body).overflowY : '',
    small: small.slice(0, 4),
    focus: active ? `${active.tagName}.${(active.className || '').toString().split(' ')[0]}` : '',
    focusInside: Boolean(content && active && content.contains(active)),
    locked: getComputedStyle(document.documentElement).overflow === 'hidden',
  };
}

try {
  for (const width of WIDTHS) {
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width, height: 812 }, colorScheme: theme });
      const tag = `${width}px/${theme}`;
      watch(page, tag);
      await page.route(SEED_CDN, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: seedCss }));
      await page.addInitScript(([scores, mode, favorites]) => {
        localStorage.setItem('jr.scores', JSON.stringify(scores));
        localStorage.setItem('jr.theme', JSON.stringify(mode));
        localStorage.setItem('jr.favorites', JSON.stringify(favorites));
      }, [SCORES, theme === 'dark' ? 'dark-only' : 'light-only', FAVORITES]);
      await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
      await page.waitForSelector('#panel .seed-segmented-control__root');
      const shots = SHOT_WIDTHS.has(width);
      await auditPage(page, tag, { shots, prefix: `${width === 375 ? 'mobile' : 'desktop'}-${theme}-` });
      // 좁은 폭에서 숨는 칩이 없는지 — 진단 화면에서 칩 묶음을 직접 잰다 (FRAME §9.1).
      if (width <= 375) {
        await page.click('.seed-tabs__trigger[data-view="diagnose"]');
        await page.waitForSelector('.jr-chips');
        const fit = await page.evaluate(chipFit);
        if (fit.missing) problems.push(`${tag}: 칩 묶음이 없다`);
        else {
          for (const item of fit.out) problems.push(`${tag}: 칩이 뷰포트를 넘는다 — ${item}`);
          if (fit.wrap !== 'wrap') problems.push(`${tag}: 칩 묶음이 줄바꿈하지 않는다 (flex-wrap: ${fit.wrap})`);
          if (fit.overflowX === 'auto' || fit.overflowX === 'scroll') {
            problems.push(`${tag}: 칩 묶음이 가로 스크롤한다 (overflow-x: ${fit.overflowX})`);
          }
          if (fit.marginLeft.startsWith('-')) problems.push(`${tag}: 칩 묶음에 음수 마진이 남아 있다 (${fit.marginLeft})`);
          // §9.1 의 일곱 개 + §11 의 전형 칩 하나. 계열은 칩이 아니라 셀렉트다.
          if (fit.count !== 8) problems.push(`${tag}: 칩이 ${fit.count}개다 (계열 칩은 셀렉트로 갔다)`);
        }
        // 진단 행은 `제목 / 값 하나 · 뱃지 셋 / 컷·내·군` 이다 (FRAME §12.2).
        // 제목은 1행 전체 폭을 쓰므로 두 줄이 상한이다 — 그 뒤는 말줄임이다 (FRAME §12.5).
        // 세 줄이 잡히면 값·뱃지 묶음이 다시 제목 옆으로 올라온 것이다.
        for (const row of await page.evaluate(rowShape)) {
          if (row.lines > 2) problems.push(`${tag}: 제목이 ${row.lines}줄이다 — ${row.title}`);
          // 375px에서는 두 줄 안에 다 들어가야 한다. 말줄임이 생겼다면 제목 자리가 다시 좁아진 것이다
          // (320px에서는 값·뱃지가 내려가고도 긴 이름 몇 개가 말줄임된다 — 그것은 §12.5대로다).
          if (width === 375 && row.clipped) problems.push(`${tag}: 제목이 두 줄을 넘겨 말줄임됐다 — ${row.title}`);
          if (row.badges > 3) problems.push(`${tag}: 뱃지가 ${row.badges}개다 — ${row.title}`);
          if (row.gap.includes('점') || row.gap.includes('(')) problems.push(`${tag}: 값 자리가 '${row.gap}' 이다 — ${row.title}`);
          if (!row.detail.startsWith('컷 ')) continue;
          if (row.detail.split(' · ').length > 3) problems.push(`${tag}: 부제 조각이 넷 이상이다 — ${row.detail}`);
          for (const gone of ['(', '지수', '반영비율', '산식', '평균', '가정', '관측']) {
            if (row.detail.includes(gone)) problems.push(`${tag}: 부제에 '${gone}' 이 남아 있다 — ${row.detail}`);
          }
        }
      }
      await page.close();
    }
  }

  // 표점 모드 + 관심 대학. 기본 상태에서는 열리지 않는 화면들을 좁은 폭·넓은 폭에서 한 번씩 본다.
  for (const width of [320, 375, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 812 }, colorScheme: 'light' });
    const tag = `표점모드/${width}px`;
    watch(page, tag);
    await page.route(SEED_CDN, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: seedCss }));
    await page.addInitScript(([scores, favorites, universities]) => {
      localStorage.setItem('jr.scores', JSON.stringify(scores));
      localStorage.setItem('jr.theme', JSON.stringify('light-only'));
      localStorage.setItem('jr.favorites', JSON.stringify(favorites));
      localStorage.setItem('jr.favUniversities', JSON.stringify(universities));
    }, [STD_SCORES, FAVORITES, FAV_UNIVERSITIES]);
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
    await page.waitForSelector('#panel .seed-segmented-control__root');
    // 접혀 있는 아코디언(대학별 환산점수·관심 대학)까지 펼쳐 놓고 잰다.
    await page.evaluate(() => { for (const item of document.querySelectorAll('details')) item.open = true; });
    await auditPage(page, tag, { shots: width === 375, prefix: 'std-' });
    await page.close();
  }

  // 등급 모드. 입력 칸 옆 환산값(작은 회색 숫자)이 들어간 성적 화면을 좁은 폭에서 본다.
  for (const width of [320, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 812 }, colorScheme: 'light' });
    const tag = `등급모드/${width}px`;
    watch(page, tag);
    await page.route(SEED_CDN, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: seedCss }));
    await page.addInitScript((scores) => {
      localStorage.setItem('jr.scores', JSON.stringify(scores));
      localStorage.setItem('jr.theme', JSON.stringify('light-only'));
    }, GRADE_SCORES);
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
    await page.waitForSelector('#panel .seed-segmented-control__root');
    const notes = await page.evaluate(() => document.querySelectorAll('.jr-input-note').length);
    if (notes < 4) problems.push(`${tag}: 환산값이 ${notes}개뿐이다`);
    await auditPage(page, tag, { shots: width === 375, prefix: 'grade-' });
    await page.close();
  }

  // 라인·대학 체크 목록. 768px 미만은 바텀시트, 그 위는 패널 안 인라인이다 (FRAME §9.3).
  for (const width of [320, 375, 1280]) {
    for (const theme of ['light', 'dark']) {
      const narrow = width < 768;
      const page = await browser.newPage({ viewport: { width, height: 812 }, colorScheme: theme });
      const tag = `체크목록/${width}px/${theme}`;
      watch(page, tag);
      await page.route(SEED_CDN, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: seedCss }));
      await page.addInitScript(([scores, mode]) => {
        localStorage.setItem('jr.scores', JSON.stringify(scores));
        localStorage.setItem('jr.theme', JSON.stringify(mode));
      }, [SCORES, theme === 'dark' ? 'dark-only' : 'light-only']);
      await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
      await page.click('.seed-tabs__trigger[data-view="diagnose"]');
      await page.waitForSelector('.jr-chips');
      for (const [name, label] of [['line', '라인'], ['university', '대학']]) {
        await clickChip(page, label);
        await page.waitForTimeout(160);
        const info = await page.evaluate(measure);
        if (info.over > 0) problems.push(`${tag}/${name}: 가로 넘침 +${info.over}px — ${info.offenders.join(' | ')}`);
        for (const item of info.truncated) problems.push(`${tag}/${name}: 잘린 텍스트 ${item}`);
        for (const item of info.small) problems.push(`${tag}/${name}: 터치 타깃 44px 미만 ${item}`);
        for (const item of info.contrast) problems.push(`${tag}/${name}: 대비 4.5:1 미만 ${item}`);
        for (const item of info.overlaps) problems.push(`${tag}/${name}: ${item}`);
        const shape = await page.evaluate(sheetShape);
        if (narrow) {
          if (!shape.open) problems.push(`${tag}/${name}: 768px 미만인데 시트가 열리지 않았다`);
          if (shape.title !== label) problems.push(`${tag}/${name}: 시트 제목이 ${shape.title}`);
          if (!shape.labelled) problems.push(`${tag}/${name}: 시트에 aria-labelledby 가 없다`);
          if (shape.rows === 0) problems.push(`${tag}/${name}: 시트가 비었다`);
          for (const item of shape.small) problems.push(`${tag}/${name}: 시트 터치 타깃 44px 미만 ${item}`);
          if (shape.inline) problems.push(`${tag}/${name}: 시트와 인라인 목록이 같이 떠 있다`);
          if (shape.bodyOverflow !== 'auto' && shape.bodyOverflow !== 'scroll') {
            problems.push(`${tag}/${name}: 시트 본문이 안에서 스크롤하지 않는다 (${shape.bodyOverflow})`);
          }
        } else {
          if (shape.open) problems.push(`${tag}/${name}: 768px 이상인데 시트가 떴다`);
          if (!shape.inline) problems.push(`${tag}/${name}: 인라인 체크 목록이 없다`);
          if (shape.rows === 0) problems.push(`${tag}/${name}: 체크 목록이 비었다`);
        }
        if (width === 375 && theme === 'light') await page.screenshot({ path: path.join(OUT, `check-${name}.png`) });
        if (narrow) { await page.keyboard.press('Escape'); await page.waitForTimeout(120); }
      }
      await page.close();
    }
  }

  // 시트 동작 한 판: 열림·포커스·Esc·패널 스크롤 보존 (FRAME §9.3).
  {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 }, colorScheme: 'light' });
    const tag = '시트/375px';
    watch(page, tag);
    await page.route(SEED_CDN, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: seedCss }));
    await page.addInitScript((scores) => {
      localStorage.setItem('jr.scores', JSON.stringify(scores));
      localStorage.setItem('jr.theme', JSON.stringify('light-only'));
    }, SCORES);
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
    await page.click('.seed-tabs__trigger[data-view="diagnose"]');
    await page.waitForSelector('.jr-chips');
    // 패널을 한참 내려 둔 채로 연다 — 닫은 뒤 그 자리에 그대로 있어야 한다.
    await page.evaluate(() => window.scrollTo(0, 420));
    await page.waitForTimeout(80);
    const before = await page.evaluate(() => Math.round(window.scrollY));
    await clickChip(page, '라인');
    await page.waitForTimeout(200);
    const open = await page.evaluate(sheetShape);
    if (!open.open) problems.push(`${tag}: 라인 시트가 열리지 않았다`);
    if (!open.focusInside) problems.push(`${tag}: 포커스가 시트 밖에 있다 (${open.focus})`);
    if (!open.locked) problems.push(`${tag}: 뒤 화면 스크롤이 잠기지 않았다`);
    await page.screenshot({ path: path.join(OUT, 'sheet-line.png') });
    // Esc 로 닫으면 목록은 그대로이므로 스크롤 자리도 그대로여야 한다.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const closed = await page.evaluate(sheetShape);
    if (closed.open) problems.push(`${tag}: Esc 로 닫히지 않는다`);
    if (closed.locked) problems.push(`${tag}: 닫았는데 스크롤 잠금이 남았다`);
    const after = await page.evaluate(() => Math.round(window.scrollY));
    if (Math.abs(after - before) > 4) problems.push(`${tag}: 패널 스크롤이 ${before} → ${after} 로 튀었다`);
    const focusBack = await page.evaluate(() => document.activeElement?.getAttribute('data-sheet-opener') || '');
    if (focusBack !== 'line') problems.push(`${tag}: 닫은 뒤 포커스가 칩으로 돌아오지 않았다 (${focusBack})`);
    // 다시 열어 행을 하나 고르고 '완료'로 닫는다 — 시트는 열린 채 체크만 바뀌고, 닫으면 칩이 말한다.
    await clickChip(page, '라인');
    await page.waitForTimeout(180);
    await page.evaluate(() => document.querySelector('.jr-sheet [role="checkbox"]')?.click());
    await page.waitForTimeout(160);
    const picked = await page.evaluate(sheetShape);
    if (!picked.open) problems.push(`${tag}: 행을 고르면 시트가 닫혀 버린다`);
    if (picked.checked === 0) problems.push(`${tag}: 고른 행에 체크가 없다`);
    if (!picked.focusInside) problems.push(`${tag}: 행을 고른 뒤 포커스가 시트 밖으로 나갔다 (${picked.focus})`);
    if (!picked.clearButton) problems.push(`${tag}: 고른 것이 있는데 '모두 해제'가 없다`);
    await page.evaluate(() => [...document.querySelectorAll('.jr-sheet-footer button')]
      .find((node) => node.textContent.trim() === '완료')?.click());
    await page.waitForTimeout(220);
    const done = await page.evaluate(sheetShape);
    if (done.open) problems.push(`${tag}: '완료'로 닫히지 않는다`);
    if (done.locked) problems.push(`${tag}: '완료' 뒤에 스크롤 잠금이 남았다`);
    const chipLabel = await page.evaluate(() => document.querySelector('[data-sheet-opener="line"]')?.textContent.trim() || '');
    if (chipLabel !== '라인 1') problems.push(`${tag}: 닫은 뒤 칩이 '${chipLabel}' 이다`);
    // 768px 이상으로 넓히면 시트를 닫고 인라인으로 돌아간다.
    await clickChip(page, '대학');
    await page.waitForTimeout(180);
    await page.setViewportSize({ width: 1280, height: 812 });
    await page.waitForTimeout(300);
    const wide = await page.evaluate(sheetShape);
    if (wide.open) problems.push(`${tag}: 폭을 넓혔는데 시트가 남아 있다`);
    if (wide.locked) problems.push(`${tag}: 폭을 넓혔는데 스크롤 잠금이 남았다`);
    await page.close();
  }

  // 전형 시트 한 판 (FRAME §11). 단일 선택 목록이 어떻게 보이는지 캡처 하나로 남긴다.
  {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 }, colorScheme: 'light' });
    const tag = '전형 시트/375px';
    watch(page, tag);
    await page.route(SEED_CDN, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: seedCss }));
    await page.addInitScript((scores) => {
      localStorage.setItem('jr.scores', JSON.stringify(scores));
      localStorage.setItem('jr.theme', JSON.stringify('light-only'));
    }, SCORES);
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
    await page.click('.seed-tabs__trigger[data-view="diagnose"]');
    await page.waitForSelector('.jr-chips');
    await clickChip(page, '전형');
    await page.waitForTimeout(220);
    const shape = await page.evaluate(sheetShape);
    if (!shape.open) problems.push(`${tag}: 전형 시트가 열리지 않았다`);
    if (shape.title !== '전형') problems.push(`${tag}: 시트 제목이 '${shape.title}' 이다`);
    const labels = await page.locator('.jr-sheet [role="radio"] .seed-list-item__title').allTextContents();
    const names = labels.map((text) => text.trim());
    if (names[0] !== '일반') problems.push(`${tag}: 첫 행이 '${names[0]}' 이다`);
    if (!names.includes('농어촌')) problems.push(`${tag}: 목록에 농어촌이 없다 (${names.join('·')})`);
    if (shape.checked !== 1) problems.push(`${tag}: 단일 선택인데 켜진 행이 ${shape.checked}개다`);
    await page.screenshot({ path: path.join(OUT, 'sheet-type.png') });
    // 농어촌을 고르고 닫으면 칩 글자와 스탯 라벨이 함께 바뀐다.
    await page.evaluate(() => [...document.querySelectorAll('.jr-sheet [role="radio"]')]
      .find((node) => node.querySelector('.seed-list-item__title')?.textContent.trim() === '농어촌')?.click());
    await page.waitForTimeout(180);
    await page.evaluate(() => [...document.querySelectorAll('.jr-sheet-footer button')]
      .find((node) => node.textContent.trim() === '완료')?.click());
    await page.waitForTimeout(240);
    const chipLabel = await page.evaluate(() => document.querySelector('[data-sheet-opener="type"]')?.textContent.trim() || '');
    if (chipLabel !== '농어촌') problems.push(`${tag}: 닫은 뒤 칩이 '${chipLabel}' 이다`);
    const stats = await page.locator('#panel .jr-stat-label').allTextContents();
    if (!stats.some((text) => text.trim() === '지원 가능 · 농어촌')) {
      problems.push(`${tag}: 스탯 라벨이 ${stats.map((text) => text.trim()).join(' / ')}`);
    }
    await page.close();
  }

  // 단일 파일 번들. 호스트가 감싼 문서 안에서(테마를 찍은 경우와 아닌 경우) 같은 점검을 한다.
  const bundleFile = path.join(ROOT, 'dist', 'jungsi-radar.html');
  if (existsSync(bundleFile)) {
    const fragment = readFileSync(bundleFile, 'utf8');
    for (const [label, attribute] of [['호스트테마없음', ''], ['호스트테마dark', ' data-theme="dark"']]) {
      for (const width of [375, 1024]) {
        const page = await browser.newPage({ viewport: { width, height: 812 }, colorScheme: 'light' });
        const tag = `번들 ${label}/${width}px`;
        watch(page, tag);
        await page.route('**/bundle-host.html', (route) => route.fulfill({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: `<!doctype html><html lang="ko"${attribute}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${fragment}</body></html>`,
        }));
        await page.goto(`http://127.0.0.1:${PORT}/bundle-host.html`, { waitUntil: 'load' });
        await page.waitForSelector('#panel .seed-segmented-control__root');
        const mode = await page.evaluate(() => ({
          seed: document.documentElement.hasAttribute('data-seed'),
          colorMode: document.documentElement.getAttribute('data-seed-color-mode'),
          background: getComputedStyle(document.body).backgroundColor,
          toggleHidden: document.getElementById('themeToggle')?.hidden ?? null,
          toggleDisplay: document.getElementById('themeToggle') ? getComputedStyle(document.getElementById('themeToggle')).display : 'none',
        }));
        if (!mode.seed) problems.push(`${tag}: 루트에 data-seed가 없어 Seed 토큰이 죽는다`);
        const wanted = attribute ? 'dark-only' : 'system';
        if (mode.colorMode !== wanted) problems.push(`${tag}: 색 모드가 ${mode.colorMode} (기대 ${wanted})`);
        if (attribute && (mode.toggleHidden !== true || mode.toggleDisplay !== 'none')) {
          problems.push(`${tag}: 호스트가 테마를 정했는데 토글이 남아 있다 (hidden=${mode.toggleHidden}, display=${mode.toggleDisplay})`);
        }
        if (attribute && mode.background === 'rgb(255, 255, 255)') problems.push(`${tag}: dark인데 배경이 흰색이다`);
        await auditPage(page, tag);
        await page.close();
      }
    }
  } else {
    problems.push('번들이 없다 — npm run bundle 을 먼저 돌린다');
  }
} finally {
  await browser.close();
  await web.close();
}

console.log(problems.length ? `문제 ${problems.length}건\n${problems.join('\n')}` : `문제 없음 — 폭 ${WIDTHS.length}종 × 2테마 × ${VIEWS.length}탭 + 표점모드 3판 + 등급모드 2판 + 체크목록 6판 + 시트 1판 + 전형 시트 1판 + 번들 4판 통과 (${OUT})`);
process.exit(problems.length ? 1 : 0);
