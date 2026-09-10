// 브라우저 점검: 정적 서버를 띄우고 폭 6종 × 라이트/다크 × 다섯 탭을 모두 연다.
// 가로 넘침, 고정바 겹침, 잘린 텍스트, 콘솔 오류, 실패한 요청이 하나라도 있으면 실패로 끝난다.
// 단일 파일 번들(dist/jungsi-radar.html)도 호스트 테마를 찍은 경우와 아닌 경우로 함께 본다.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '/home/user/hvsdcm1/node_modules/@playwright/test/index.mjs';

const ROOT = process.cwd();
const OUT = path.join(ROOT, '_shots');
const PORT = Number(process.env.PORT || 4183);
const CHROME = process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
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
const web = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
await new Promise((resolve) => setTimeout(resolve, 1200));
const browser = await chromium.launch({ executablePath: CHROME });

// 한 화면에서 재는 것들. 브라우저 안에서 도는 함수라 밖의 변수를 쓰지 않는다.
function measure() {
  const out = { over: 0, offenders: [], truncated: [], overlaps: [], small: [], contrast: [], empty: false };
  out.over = document.documentElement.scrollWidth - window.innerWidth;
  if (out.over > 0) {
    for (const node of document.querySelectorAll('body *')) {
      const rect = node.getBoundingClientRect();
      if (rect.width > 0 && rect.right > window.innerWidth + 1) {
        out.offenders.push(`${node.tagName}.${(node.className || '').toString().split(' ')[0]} right=${Math.round(rect.right)}`);
      }
    }
    out.offenders = out.offenders.slice(0, 5);
  }
  const panel = document.getElementById('panel');
  out.empty = !panel || panel.childElementCount === 0;
  // 잘린 텍스트: 넘치는 것을 숨기는 칸인데 내용이 더 넓다.
  for (const node of document.querySelectorAll('#panel *')) {
    if (node.children.length > 0) continue;
    const style = getComputedStyle(node);
    if (style.overflowX === 'visible' && style.overflow === 'visible') continue;
    if (style.overflowX === 'auto' || style.overflowX === 'scroll') continue;
    if (node.scrollWidth > node.clientWidth + 1) {
      out.truncated.push(`${node.tagName}.${(node.className || '').toString().split(' ')[0]}: ${(node.textContent || '').slice(0, 24)}`);
    }
  }
  out.truncated = out.truncated.slice(0, 4);
  // 대비: 본문·부제·머리글이 배경과 4.5:1 이상인지 (WCAG AA). 반투명 배경은 재지 않는다.
  const luminance = (color) => {
    const parts = (color.match(/[\d.]+/gu) || []).map(Number);
    if (parts.length < 3) return null;
    if (parts.length > 3 && parts[3] < 1) return null;
    const [r, g, b] = parts.slice(0, 3).map((value) => {
      const channel = value / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const backgroundOf = (node) => {
    let current = node;
    while (current) {
      const color = getComputedStyle(current).backgroundColor;
      if (color && !/rgba\(0, 0, 0, 0\)|transparent/u.test(color)) return color;
      current = current.parentElement;
    }
    return 'rgb(255, 255, 255)';
  };
  for (const selector of ['.seed-list-item__title', '.seed-list-item__detail', '.jr-group-head', '.jr-stat-label', '.jr-muted', '.jr-gap']) {
    const node = document.querySelector(`#panel ${selector}`);
    if (!node) continue;
    const front = luminance(getComputedStyle(node).color);
    const back = luminance(backgroundOf(node));
    if (front === null || back === null) continue;
    const ratio = (Math.max(front, back) + 0.05) / (Math.min(front, back) + 0.05);
    if (ratio < 4.5) out.contrast.push(`${selector} ${Math.round(ratio * 100) / 100}:1`);
  }
  // 터치 타깃: 누를 수 있는 것은 44px 이상이어야 한다 (Apple HIG).
  const seen = new Set();
  for (const node of document.querySelectorAll('#panel button, #panel select, #panel input, #panel summary, #panel a, #panel [role="checkbox"]')) {
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (rect.height >= 43.5 && rect.width >= 43.5) continue;
    const key = `${node.tagName}.${(node.className || '').toString().split(' ')[0]}: ${Math.round(rect.width)}x${Math.round(rect.height)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.small.push(`${key} "${(node.textContent || '').trim().slice(0, 12)}"`);
  }
  out.small = out.small.slice(0, 6);
  // 겹침: 맨 위에서 첫 내용이 고정바에 가리는지, 스크롤 중 고정바가 비치거나 내용에 덮이는지.
  const head = document.querySelector('.jr-head');
  if (head && panel) {
    window.scrollTo(0, 0);
    const headRect = head.getBoundingClientRect();
    const first = panel.firstElementChild;
    if (first && first.getBoundingClientRect().top < headRect.bottom - 1) {
      out.overlaps.push(`첫 내용이 고정바에 가림 (${Math.round(first.getBoundingClientRect().top)} < ${Math.round(headRect.bottom)})`);
    }
    const background = getComputedStyle(head).backgroundColor;
    if (/rgba\(/u.test(background) && !/,\s*1\)$/u.test(background)) out.overlaps.push(`고정바 배경이 비침 ${background}`);
    window.scrollTo(0, 400);
    const probe = document.elementFromPoint(Math.round(headRect.left + headRect.width / 2), Math.round(headRect.bottom - 6));
    if (probe && !head.contains(probe)) {
      out.overlaps.push(`스크롤 중 내용이 고정바 위로 올라옴: ${probe.tagName}.${(probe.className || '').toString().split(' ')[0]}`);
    }
    window.scrollTo(0, 0);
  }
  return out;
}

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

  // 라인·대학 체크 목록. 칩을 눌러 펼친 상태를 좁은 폭·넓은 폭에서 한 번씩 본다.
  for (const width of [320, 375, 1280]) {
    for (const theme of ['light', 'dark']) {
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
        await page.evaluate((text) => {
          const chip = [...document.querySelectorAll('.jr-chips .seed-chip-tabs__trigger')]
            .find((node) => node.textContent.trim().split(' ')[0] === text);
          chip?.click();
        }, label);
        await page.waitForTimeout(140);
        const info = await page.evaluate(measure);
        if (info.over > 0) problems.push(`${tag}/${name}: 가로 넘침 +${info.over}px — ${info.offenders.join(' | ')}`);
        for (const item of info.truncated) problems.push(`${tag}/${name}: 잘린 텍스트 ${item}`);
        for (const item of info.small) problems.push(`${tag}/${name}: 터치 타깃 44px 미만 ${item}`);
        for (const item of info.contrast) problems.push(`${tag}/${name}: 대비 4.5:1 미만 ${item}`);
        for (const item of info.overlaps) problems.push(`${tag}/${name}: ${item}`);
        const rows = await page.evaluate(() => document.querySelectorAll('[role="checkbox"]').length);
        if (rows === 0) problems.push(`${tag}/${name}: 체크 목록이 비었다`);
        if (width === 375 && theme === 'light') await page.screenshot({ path: path.join(OUT, `check-${name}.png`) });
      }
      await page.close();
    }
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
  web.kill();
}

console.log(problems.length ? `문제 ${problems.length}건\n${problems.join('\n')}` : `문제 없음 — 폭 ${WIDTHS.length}종 × 2테마 × ${VIEWS.length}탭 + 표점모드 3판 + 등급모드 2판 + 체크목록 6판 + 번들 4판 통과 (${OUT})`);
process.exit(problems.length ? 1 : 0);
