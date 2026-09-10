// 브라우저 확인: 정적 서버를 띄우고 다섯 탭을 두 폭·두 테마로 찍는다.
// 가로 넘침(scrollWidth > innerWidth)과 콘솔 오류가 있으면 마지막에 목록으로 알린다.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '/home/user/hvsdcm1/node_modules/@playwright/test/index.mjs';

const ROOT = process.cwd();
const OUT = path.join(ROOT, '_shots');
const PORT = 4183;
const CHROME = process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const VIEWS = ['scores', 'diagnose', 'target', 'rules', 'about'];
const SCORES = {
  mode: 'pct', korElective: '언어와매체', kor: '96', mathElective: '미적분', math: '93',
  eng: '2', hist: '1', inq1Subject: '사회문화', inq1: '95', inq2Subject: '생활과윤리', inq2: '92', gpa: '2.1',
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
const web = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
await new Promise((resolve) => setTimeout(resolve, 1200));

const problems = [];
const browser = await chromium.launch({ executablePath: CHROME });
try {
  for (const [size, width, height] of [['mobile', 375, 812], ['desktop', 1280, 800]]) {
    for (const [theme, colorScheme] of [['light', 'light'], ['dark', 'dark']]) {
      const page = await browser.newPage({ viewport: { width, height }, colorScheme });
      page.on('pageerror', (error) => problems.push(`${size}/${theme}: ${error.message}`));
      page.on('console', (message) => {
        if (message.type() === 'error') problems.push(`${size}/${theme} console: ${message.text()}`);
      });
      page.on('requestfailed', (request) => problems.push(`${size}/${theme} requestfailed: ${request.url()} ${request.failure()?.errorText}`));
      // 검사용 브라우저에는 바깥 네트워크가 없다. CDN의 Seed CSS만 미리 받아 둔 사본으로 돌린다.
      await page.route(SEED_CDN, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: seedCss }));
      await page.addInitScript(([scores, mode]) => {
        localStorage.setItem('jr.scores', JSON.stringify(scores));
        localStorage.setItem('jr.theme', JSON.stringify(mode));
        localStorage.setItem('jr.favorites', JSON.stringify(['korea::경영대학', 'yonsei::경영학과', 'hanyang::경영학부']));
      }, [SCORES, theme === 'dark' ? 'dark-only' : 'light-only']);
      await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#panel .seed-segmented-control__root');
      for (const view of VIEWS) {
        await page.click(`.seed-tabs__trigger[data-view="${view}"]`);
        await page.waitForTimeout(120);
        const info = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
          nodes: document.getElementById('panel').childElementCount,
        }));
        if (info.scrollWidth > info.innerWidth) {
          problems.push(`${size}/${theme}/${view}: 가로 넘침 ${info.scrollWidth} > ${info.innerWidth}`);
        }
        if (info.nodes === 0) problems.push(`${size}/${theme}/${view}: 패널이 비었다`);
        await page.screenshot({ path: path.join(OUT, `${size}-${theme}-${view}.png`), fullPage: view !== 'diagnose' });
      }
      await page.close();
    }
  }
} finally {
  await browser.close();
  web.kill();
}
console.log(problems.length ? `문제 ${problems.length}건\n${problems.join('\n')}` : `문제 없음 — ${OUT}`);
process.exit(problems.length ? 1 : 0);
