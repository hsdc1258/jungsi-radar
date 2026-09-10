// 대입정보포털 어디가(adiga.kr)의 정시(수능위주) 대학별 입시결과를 원문 그대로 받아 온다.
//
//   node scripts/source-parsers/fetch-adiga.mjs --year 2026 --ids all
//   node scripts/source-parsers/fetch-adiga.mjs --year 2026,2025 --ids kookmin,hanyang
//   node scripts/source-parsers/fetch-adiga.mjs --list        (대학 목록·코드만 새로 만든다)
//
// 산출물
//   source/adiga/universities.json  우리 id → { unvCd, adigaName, note }
//   source/adiga/<학년도>.json      docs/MODEL.md §1.1 형식의 행 + 원본 셀(raw)
//   source/adiga/notes.json         팝업의 용어 안내(각주) 원문
//
// 프로토콜(어디가가 공개 API를 주지 않아 화면과 같은 요청을 같은 세션으로 보낸다)
//   1. criteriaAndResultView.do 를 브라우저로 연다 → 세션 쿠키와 meta[name=_csrf] 토큰.
//   2. #frm 을 그대로 실어 criteriaAndResultAjax.do 로 대학 목록(15건/페이지)을 받는다.
//   3. classUnivAdmssPopup.do 로 대학×학년도 팝업 HTML을 받는다 → #admssFrm 의 hidden 값과 각주.
//   4. #admssFrm 에 pagination.currentPage 를 올리며 classUnivAdmssPopupAjax.do 로 표를 받는다.
// 요청 사이 200ms 를 쉬고, 실패하면 3번까지 다시 건다.
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeDept } from './dept-name.mjs';
// 표를 읽는 규칙(열 배치·검산)은 adiga-table.mjs 한 곳에 있다 — 테스트가 그 모듈을 바로 부른다.
import { COL, COLUMNS, SOURCE_META, hasValue, parseNotes, parseRows, toRow, totalOf } from './adiga-table.mjs';

const ROOT = process.cwd();
const SOURCE = path.join(ROOT, 'source');
const OUT_DIR = path.join(SOURCE, 'adiga');
const LIST_URL = 'https://www.adiga.kr/uct/acd/ade/criteriaAndResultView.do?menuId=PCUCTACD1001';
const SLCN_SUNEUNG = '05';   // 전형유형 = 수능위주
const PER_PAGE = 10;         // 팝업 표의 페이지당 행 수(어디가 고정)
const GAP_MS = 200;

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const log = (...args) => { process.stdout.write(`${args.join(' ')}\n`); };

// ── 세션 ────────────────────────────────────────────────────────────────────
async function withRetry(label, task, tries = 3) {
  let last;
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      last = error;
      log(`  ! ${label} 실패(${attempt}/${tries}): ${error.message}`);
      await sleep(GAP_MS * attempt * 5);
    }
  }
  throw last;
}

async function openSession() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'ko-KR' });
  const page = await context.newPage();
  await page.goto(LIST_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1500);
  const csrf = await page.evaluate(() => document.querySelector('meta[name="_csrf"]')?.content || null);
  if (!csrf) throw new Error('_csrf 토큰을 찾지 못했다');
  return { browser, page, csrf };
}

const post = (page, url, body, csrf) => page.evaluate(async ([target, payload, token]) => {
  const response = await fetch(target, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'X-CSRF-TOKEN': token,
    },
    body: payload,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}, [url, body, csrf]);

// 대학 목록 202건. 목록 폼(#frm)을 그대로 실어야 서버가 같은 조건으로 답한다.
export async function fetchUniversityList({ page, csrf }) {
  const seen = new Set();
  const out = [];
  for (let current = 1; current <= 30; current += 1) {
    const body = await page.evaluate(([cur]) => {
      const form = document.querySelector('#frm');
      const params = new URLSearchParams();
      for (const [key, value] of new FormData(form).entries()) params.append(key, String(value));
      params.set('pagination.currentPage', cur);
      return params.toString();
    }, [String(current)]);
    const html = await withRetry(`대학 목록 ${current}쪽`, () => post(page, '/uct/acd/ade/criteriaAndResultAjax.do', body, csrf));
    const hits = [...html.matchAll(/fnDetailPopup\(&quot;(\d+)&quot;\)"[^>]*>([^<]+)</gu)]
      .map((hit) => ({ unvCd: hit[1], adigaName: hit[2].trim() }));
    if (hits.length === 0 || seen.has(hits[0].unvCd)) break;
    for (const hit of hits) {
      if (seen.has(hit.unvCd)) continue;
      seen.add(hit.unvCd);
      out.push(hit);
    }
    await sleep(GAP_MS);
  }
  return out;
}

// 우리 43개 대학 ↔ 어디가 대학코드. 캠퍼스가 갈리는 대학은 근거를 note 에 적는다.
// results.json 의 출처 URL이 모두 학점나비의 '…-본교' 페이지라, 기존 행과 같은 캠퍼스를 고른다.
const CAMPUS_NOTE = {
  catholic: '어디가 [본교](성심). [제3캠퍼스]는 신학, 의예는 별도 캠퍼스 — 기존 행이 성심캠퍼스라 본교를 쓴다.',
  kangwon: '어디가 [본교](춘천). [제2~4캠퍼스]는 삼척·도계 등 — 기존 행이 춘천이라 본교를 쓴다.',
  kyonggi: '어디가 [본교](수원). [제2캠퍼스]는 서울 — 기존 행이 수원이라 본교를 쓴다.',
  dankook: '어디가 [본교](죽전). [제2캠퍼스]는 천안 — 기존 행이 죽전이라 본교를 쓴다.',
  mju: '어디가 [본교](서울 인문). [제2캠퍼스]는 자연(용인) — 기존 행이 본교라 본교를 쓴다.',
  smu: '어디가 [본교](서울). [제2캠퍼스]는 천안 — 기존 행이 서울이라 본교를 쓴다.',
  jnu: '어디가 [본교](광주). [제2캠퍼스]는 여수 — 기존 행이 광주라 본교를 쓴다.',
  cau: '어디가 [본교](서울). [제2캠퍼스]는 안성 — 기존 행이 서울이라 본교를 쓴다.',
  hongik: '어디가 [본교](서울). [제2캠퍼스]는 세종 — 기존 행이 서울이라 본교를 쓴다.',
  korea: '어디가 [본교](안암). (세종)은 [분교]로 따로 있다.',
  konkuk: '어디가 [본교](서울). (글로컬)은 [분교]로 따로 있다.',
  dongguk: '어디가 [본교](서울). (WISE)는 [분교]로 따로 있다.',
  yonsei: '어디가 [본교](신촌). (미래)는 [분교]로 따로 있다.',
  hufs: '어디가에 한국외대는 [본교] 하나뿐이다 — 서울·글로벌 두 캠퍼스 행이 한 코드로 함께 온다.',
  'hufs-global': '한국외대 [본교]와 같은 코드. 학과명으로 서울·글로벌을 가른다.',
  hanyang: '어디가 [본교](서울). ERICA는 (ERICA)[분교]로 따로 있다.',
  'hanyang-erica': '어디가 한양대학교(ERICA)[분교].',
  khu: '어디가 [본교] 하나뿐 — 국제캠퍼스 모집단위가 같은 코드로 함께 온다.',
};
const EXPLICIT = { 'hanyang-erica': '한양대학교(ERICA)[분교]', 'hufs-global': '한국외국어대학교[본교]' };

export function mapUniversities(ours, adigaList) {
  const byName = new Map(adigaList.map((row) => [row.adigaName, row]));
  const out = [];
  const missing = [];
  for (const row of ours) {
    const explicit = EXPLICIT[row.id];
    // 기본 규칙: results.json 의 대학명에서 캠퍼스 괄호를 떼고 '<대학명>[본교]' 를 찾는다.
    const bare = String(row.name).replace(/\([^)]*\)/gu, '').replace(/\s+ERICA$/u, '').trim();
    const hit = byName.get(explicit || `${bare}[본교]`);
    if (!hit) { missing.push(row.id); continue; }
    out.push({
      id: row.id, name: row.name, unvCd: hit.unvCd, adigaName: hit.adigaName,
      note: CAMPUS_NOTE[row.id] || '어디가 [본교] 한 곳뿐이라 그대로 쓴다.',
    });
  }
  return { entries: out, missing };
}

// 대학 × 학년도 팝업. 표 페이지를 끝까지 받아 raw 셀 배열로 돌려준다.
export async function fetchUniversityYear({ page, csrf }, { unvCd, year }) {
  const popupBody = new URLSearchParams({
    searchSyr: String(year), unvCd, ruCd: 'X', slcnTypeCd: SLCN_SUNEUNG, _csrf: csrf,
  }).toString();
  const popup = await withRetry(`팝업 ${unvCd}/${year}`, () => post(page, '/ucp/cls/uni/classUnivAdmssPopup.do', popupBody, csrf));
  await sleep(GAP_MS);
  if (!/id="admssFrm"/u.test(popup)) return { rows: [], total: 0, notes: null, missing: true };
  const total = totalOf(popup) ?? 0;
  const notes = parseNotes(popup);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const rows = [];
  const seen = new Set();
  for (let current = 1; current <= pages; current += 1) {
    const body = new URLSearchParams({
      searchSyr: String(year), unvCd, ruCd: 'X', slcnTypeCd: SLCN_SUNEUNG,
      rcmtMmntCd: '', slcnGroupCd: '', 'pagination.currentPage': String(current),
    }).toString();
    const html = await withRetry(`표 ${unvCd}/${year} ${current}쪽`, () => post(page, '/ucp/cls/uni/classUnivAdmssPopupAjax.do', body, csrf));
    const parsed = parseRows(html);
    if (parsed.length === 0) break;
    // 마지막 쪽을 넘겨도 서버가 같은 쪽을 되돌려 준다 — 같은 내용이면 멈춘다.
    const key = JSON.stringify(parsed);
    if (seen.has(key)) break;
    seen.add(key);
    rows.push(...parsed);
    await sleep(GAP_MS);
  }
  return { rows, total, notes, missing: false };
}

// results.json 의 우리 id → 정규화한 모집단위 이름 집합.
export function deptIndex(results) {
  const out = new Map();
  for (const university of Object.values(results)) {
    out.set(university.id, new Set((university.departments || []).map((dept) => normalizeDept(dept.name))));
  }
  return out;
}

// 한 코드를 나눠 쓰는 id들 중 이 학과명이 어디 것인지 고른다.
// 우리 목록에 있는 쪽으로 보내고, 어느 쪽에도 없으면 첫 번째(주 캠퍼스)에 담는다.
export function router(members, ourDepts) {
  if (members.length === 1) return () => members[0];
  return (name) => {
    const key = normalizeDept(name);
    for (const member of members) {
      if (ourDepts.get(member.id)?.has(key)) return member;
    }
    return members[0];
  };
}

// ── 실행 ────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { years: [2026], ids: 'all', list: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--year') args.years = argv[i + 1].split(',').map((value) => Number(value.trim()));
    if (argv[i] === '--ids') args.ids = argv[i + 1];
    if (argv[i] === '--list') args.list = true;
  }
  return args;
}

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
// 학년도 파일은 행이 6천 개에 원본 셀(raw)까지 들고 있어, 들여쓰기를 넣으면 파일이 두 배가 된다.
// 사람이 읽을 파일(대학 표·각주)만 들여쓰고 행 파일은 한 줄로 쓴다.
const writeJson = (file, value, indent = 1) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, indent)}\n`);
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const session = await openSession();
  try {
    const mapFile = path.join(OUT_DIR, 'universities.json');
    let mapping = existsSync(mapFile) ? readJson(mapFile) : null;
    if (args.list || !mapping) {
      log('대학 목록을 받는다…');
      const list = await fetchUniversityList(session);
      log(`  어디가 대학 ${list.length}곳`);
      const ours = Object.values(readJson(path.join(SOURCE, 'results.json')))
        .map((row) => ({ id: row.id, name: row.name }));
      const { entries, missing } = mapUniversities(ours, list);
      if (missing.length > 0) log(`  ! 코드를 못 찾은 대학: ${missing.join(', ')}`);
      mapping = { fetchedOn: today, source: SOURCE_META, count: entries.length, universities: entries };
      writeJson(mapFile, mapping);
      log(`  → ${path.relative(ROOT, mapFile)} (${entries.length}곳)`);
      if (args.list) return;
    }

    const picked = args.ids === 'all'
      ? mapping.universities
      : mapping.universities.filter((row) => args.ids.split(',').map((value) => value.trim()).includes(row.id));
    if (picked.length === 0) throw new Error(`--ids 에 맞는 대학이 없다: ${args.ids}`);
    // 우리 한 대학이 어디가 코드 둘에 걸치는 곳(명지대 인문·자연처럼 캠퍼스가 갈린 대학)은
    // extraCodes 에 적어 두고 코드마다 한 번씩 받는다.
    const wanted = picked.flatMap((row) => [
      { ...row, extraCodes: undefined },
      ...(row.extraCodes || []).map((extra) => ({ ...row, ...extra, extraCodes: undefined })),
    ]);
    const pickedIds = new Set(picked.map((row) => row.id));

    // 한 코드를 우리 id 둘이 나눠 쓰는 대학(한국외대 서울·글로벌)은 코드를 한 번만 받고
    // 학과명으로 갈라 담는다 — 같은 행을 두 번 받아 두 배로 싣지 않으려는 것이다.
    const groups = new Map();
    for (const university of wanted) {
      if (!groups.has(university.unvCd)) groups.set(university.unvCd, []);
      groups.get(university.unvCd).push(university);
    }
    const ourDepts = deptIndex(readJson(path.join(SOURCE, 'results.json')));

    let notes = null;
    for (const year of args.years) {
      log(`\n[${year}학년도] 대학 ${pickedIds.size}곳 (어디가 코드 ${groups.size}개)`);
      const rows = [];
      const empty = new Set(pickedIds);
      let blank = 0;
      for (const [unvCd, members] of groups) {
        const result = await fetchUniversityYear(session, { unvCd, year });
        const bad = result.rows.filter((raw) => raw.length < 9);
        if (bad.length > 0) log(`  ! ${members[0].id}: 셀 개수가 이상한 행 ${bad.length}개`);
        const route = router(members, ourDepts);
        const counts = new Map(members.map((row) => [row.id, 0]));
        for (const raw of result.rows) {
          if (raw.length < 9) continue;
          const university = route(raw[COL.dept]);
          const row = toRow(raw, { ...university, year, fetchedOn: today });
          // 숫자가 하나도 없는 줄은 표의 빈 칸이다 — 저장하지 않고 세기만 한다.
          if (!hasValue(row)) { blank += 1; continue; }
          rows.push(row);
          counts.set(university.id, counts.get(university.id) + 1);
        }
        if (!notes && result.notes && result.notes.lines.length > 0) notes = result.notes;
        for (const [id, count] of counts) {
          if (count > 0) empty.delete(id);
          log(`  ${id.padEnd(14)} ${String(count).padStart(4)}행 (공시 ${result.total}건${count === 0 ? ', 값 없음' : ''})`);
        }
      }
      if (blank > 0) log(`  · 값이 하나도 없는 줄 ${blank}개는 버렸다(어디가가 지난 학년도 표를 비워 둔 자리).`);
      if (rows.length === 0) {
        log(`  → ${year}학년도: 값이 있는 행이 없다. 파일을 쓰지 않는다.`);
        continue;
      }
      const file = path.join(OUT_DIR, `${year}.json`);
      // 일부 대학만 다시 받아도 나머지가 사라지지 않게, 이번에 받지 않은 대학의 행은 그대로 둔다.
      const kept = existsSync(file)
        ? (readJson(file).rows || []).filter((row) => !pickedIds.has(row.university))
        : [];
      const merged = [...kept, ...rows].sort((left, right) => (
        left.university.localeCompare(right.university) || left.dept.localeCompare(right.dept, 'ko')
        || String(left.period).localeCompare(String(right.period), 'ko')
      ));
      writeJson(file, {
        year, fetchedOn: today, source: SOURCE_META, slcnTypeCd: SLCN_SUNEUNG,
        aggregation: 'adiga-score-rank',
        counts: {
          universities: new Set(merged.map((row) => row.university)).size,
          rows: merged.length,
          disclosed: merged.filter((row) => row.disclosed && row.score.p70 !== null).length,
          empty: [...empty],
        },
        rows: merged,
      }, 0);
      log(`  → ${path.relative(ROOT, file)} (${merged.length}행 / 대학 ${new Set(merged.map((row) => row.university)).size}곳, 이번 수집 ${rows.length}행)`);
    }
    if (notes) {
      const file = path.join(OUT_DIR, 'notes.json');
      writeJson(file, { fetchedOn: today, source: SOURCE_META, ...notes });
      log(`\n→ ${path.relative(ROOT, file)} (각주 ${notes.lines.length}줄)`);
    }
  } finally {
    await session.browser.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(ROOT, 'scripts/source-parsers/fetch-adiga.mjs')) {
  await main();
}
