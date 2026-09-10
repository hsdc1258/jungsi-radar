// 단일 파일 번들: dist/jungsi-radar.html
// 다른 페이지(예: Claude 아티팩트) 안에 그대로 붙여 넣는 조각이다 —
// <html>/<head>/<body> 없이 <title>·<style>·본문·<script>만 담는다.
// 호스트가 <html>에 data-theme="dark|light"를 찍으면 app.js가 그것을 따라간다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SEED_CDN = 'https://cdn.jsdelivr.net/npm/@seed-design/css@2.7.0/all.min.css';
const SEED_CACHE = path.join(ROOT, '_shots', 'seed-all.min.css');

const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');

// Seed CSS 사본. 번들은 바깥 네트워크 없이도 그대로 돌아야 해서 CSS를 안에 넣는다.
mkdirSync(path.dirname(SEED_CACHE), { recursive: true });
if (!existsSync(SEED_CACHE)) {
  const response = await fetch(SEED_CDN);
  if (!response.ok) throw new Error(`Seed CSS를 받지 못했습니다: ${response.status}`);
  writeFileSync(SEED_CACHE, await response.text(), 'utf8');
}
const seedCss = readFileSync(SEED_CACHE, 'utf8');

const html = read('index.html');
const body = html.slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('</body>'))
  .replace(/\s*<script src="[^"]*"><\/script>/gu, '')
  .trim();
// 첫 페인트 전에 도는 테마 복원 스크립트도 그대로 가져간다.
const boot = html.slice(html.indexOf('<script>', html.indexOf('<head>')), html.indexOf('</script>', html.indexOf('<script>', html.indexOf('<head>'))) + '</script>'.length);

const guard = `<script>
// 이 조각은 남의 문서 안에서 돈다. Seed 토큰은 <html data-seed>가 있어야 살아나므로 먼저 붙인다.
(function () {
  var root = document.documentElement;
  root.setAttribute('data-seed', '');
  if (!root.getAttribute('data-seed-color-mode')) root.setAttribute('data-seed-color-mode', 'system');
  var host = root.getAttribute('data-theme');
  if (host === 'dark' || host === 'light') root.setAttribute('data-seed-color-mode', host + '-only');
})();
</script>`;

// 번들 전용 보정: 호스트 문서의 여백·배경이 무엇이든 우리 조각은 스스로 채운다.
const bundleCss = `
html, body { min-height: 100%; }
body { margin: 0; }
.jr-head { top: var(--jr-host-offset, 0px); }
`;

const out = [
  '<title>정시 레이더</title>',
  `<style>${seedCss}</style>`,
  `<style>${read('assets/frame.css')}${bundleCss}</style>`,
  guard,
  boot,
  body,
  `<script>${read('assets/data.js')}</script>`,
  `<script>${read('assets/engine.js')}</script>`,
  `<script>${read('assets/app.js')}</script>`,
].join('\n');

mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
const file = path.join(ROOT, 'dist', 'jungsi-radar.html');
writeFileSync(file, out, 'utf8');
console.log(`wrote ${path.relative(ROOT, file)}: ${(out.length / 1024).toFixed(0)}KB`);
