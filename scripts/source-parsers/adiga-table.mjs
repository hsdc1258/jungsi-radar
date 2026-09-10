// 어디가 입시결과 표를 읽는 규칙. 네트워크를 타지 않는 순수 함수만 둔다 —
// fetch-adiga.mjs 가 이 모듈로 HTML을 해석하고, tests/adiga.test.mjs 가 같은 함수를 직접 검사한다.
// ── 열 배치. 어디가 표는 thead 가 3~4줄이라 이름으로 짚을 수 없다. 실제 td 개수(81)를 검증한 뒤
//    이 상수로만 읽는다. tests/data.test.mjs 의 국민대 자유전공(A) 단언이 이 배치를 지킨다.
export const COLUMNS = 81;
export const COL = {
  period: 0, typeCategory: 1, typeName: 2, dept: 3,
  quotaInitial: 4, quotaCarried: 5, quotaFinal: 6, rate: 7, fill: 8,
  // 9..19 학생부(환산점수 50/70/80/90/100 · 총점 · 환산등급 50/70/80/90/100) — 수능위주는 전부 '-'
  score: { p50: 20, p70: 21, p80: 22, p90: 23, p100: 24, total: 25 },
  studentStart: 26, studentStride: 11,
};
export const CUTS = ['p50', 'p70', 'p80', 'p90', 'p100'];
// 한 컷 묶음 11칸: 국어 · 수학 · 탐구1(사탐·과탐·직탐) · 탐구2(사탐·과탐·직탐) · 평균백분위 · 한국사 · 영어
const IN_BLOCK = { kor: 0, math: 1, inq1: [2, 3, 4], inq2: [5, 6, 7], avg: 8, hist: 9, eng: 10 };
const INQ_KINDS = ['사탐', '과탐', '직탐'];

export const SOURCE_META = {
  title: '대입정보포털 어디가 — 대학별 입시결과(정시 수능위주)',
  url: 'https://www.adiga.kr/uct/acd/ade/criteriaAndResultView.do?menuId=PCUCTACD1001',
};

// ── 유틸 ────────────────────────────────────────────────────────────────────
// 어디가는 빈 칸을 '-' 로 쓴다. 숫자로 읽히지 않으면 null 이다(0 은 살린다).
export function num(cell) {
  const text = String(cell ?? '').replace(/,/g, '').trim();
  if (text === '' || text === '-' || text === '−') return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

export function stripTags(html) {
  return String(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

// tbody 의 각 tr 을 셀 문자열 배열로 만든다.
export function parseRows(html) {
  const body = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/u);
  if (!body) return [];
  return [...body[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gu)]
    .map((tr) => [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gu)].map((cell) => stripTags(cell[1])));
}

export function totalOf(html) {
  const hit = html.match(/총\s*<strong[^>]*>([\d,]+)<\/strong>\s*건/u);
  return hit ? Number(hit[1].replace(/,/g, '')) : null;
}

// 한 컷 묶음(11칸)을 학생 한 명의 성적표로 읽는다. 전부 비어 있으면 null.
export function readStudent(raw, base) {
  const at = (offset) => num(raw[base + offset]);
  const inq = (offsets) => {
    for (let i = 0; i < offsets.length; i += 1) {
      const value = at(offsets[i]);
      if (value !== null) return { kind: INQ_KINDS[i], pct: value };
    }
    return null;
  };
  const student = {
    kor: at(IN_BLOCK.kor), math: at(IN_BLOCK.math),
    inq1: inq(IN_BLOCK.inq1), inq2: inq(IN_BLOCK.inq2),
    avg: at(IN_BLOCK.avg), hist: at(IN_BLOCK.hist), eng: at(IN_BLOCK.eng),
  };
  const empty = student.kor === null && student.math === null && student.inq1 === null
    && student.inq2 === null && student.avg === null && student.hist === null && student.eng === null;
  return empty ? null : student;
}

// docs/MODEL.md §1.1 검산: 공시된 평균백분위가 그 학생의 국·수·탐 평균과 ±0.6 안에서 맞는가.
// 맞지 않으면 그 컷의 영역별 값을 한 학생 성적표로 쓰지 않는다(L2 판정 불가).
export function checkConsistent(student) {
  if (!student || student.avg === null) return null;
  const parts = [student.kor, student.math].filter((value) => value !== null);
  const inq = [student.inq1?.pct, student.inq2?.pct].filter((value) => typeof value === 'number');
  if (parts.length < 2 || inq.length === 0) return null;
  const mean = (parts[0] + parts[1] + (inq.reduce((sum, value) => sum + value, 0) / inq.length)) / 3;
  return Math.abs(mean - student.avg) <= 0.6;
}

// 표 한 줄 → MODEL §1.1 행.
export function toRow(raw, { id, year, unvCd, adigaName, fetchedOn }) {
  const note = raw.length === COLUMNS ? '' : (raw.slice(9).find((cell) => /미제출|사유/u.test(cell)) || '');
  const full = raw.length === COLUMNS;
  const score = full ? {
    p50: num(raw[COL.score.p50]), p70: num(raw[COL.score.p70]), p80: num(raw[COL.score.p80]),
    p90: num(raw[COL.score.p90]), p100: num(raw[COL.score.p100]), total: num(raw[COL.score.total]),
  } : { p50: null, p70: null, p80: null, p90: null, p100: null, total: null };
  const student = {};
  CUTS.forEach((key, index) => {
    student[key] = full ? readStudent(raw, COL.studentStart + (index * COL.studentStride)) : null;
  });
  // 행의 검산 결과는 실제로 판정에 쓰는 50%·70% 두 컷만 본다.
  const checks = ['p50', 'p70'].map((key) => checkConsistent(student[key])).filter((value) => value !== null);
  return {
    university: id, unvCd, adigaName, year,
    period: raw[COL.period] || '', typeCategory: raw[COL.typeCategory] || '',
    typeName: raw[COL.typeName] || '', dept: raw[COL.dept] || '',
    quota: {
      initial: num(raw[COL.quotaInitial]), carried: num(raw[COL.quotaCarried]), final: num(raw[COL.quotaFinal]),
    },
    rate: num(raw[COL.rate]), fill: num(raw[COL.fill]),
    score, student,
    aggregation: 'adiga-score-rank',
    consistent: checks.length === 0 ? null : checks.every(Boolean),
    disclosed: full,
    note,
    source: { ...SOURCE_META, fetchedOn },
    sourceGrade: 'A',
    raw,
  };
}

// 값이 하나도 없는 행인가. 어디가는 직전 학년도(현재 2026) 입시결과만 온전히 싣고, 그 전 학년도는
// 표의 틀(모집시기·전형·학과명)만 남긴 채 숫자를 모두 비워 둔다 — 모집인원까지 0이다.
// 그런 줄은 자료가 아니라 빈 칸이므로 저장하지 않는다(2024학년도는 전 대학이 여기 해당한다).
export function hasValue(row) {
  if (!row) return false;
  if (row.note) return true;
  if ((row.quota?.final ?? 0) > 0 || (row.quota?.initial ?? 0) > 0) return true;
  if ((row.rate ?? 0) > 0 || (row.fill ?? 0) > 0) return true;
  return CUTS.some((key) => typeof row.score?.[key] === 'number' || row.student?.[key] !== null);
}

// ── 팝업 각주(용어 안내) 원문 ────────────────────────────────────────────────
// 이 표가 우리 데이터의 정의다(docs/MODEL.md §0). 손으로 옮겨 적지 않고 페이지에서 긁어 그대로 둔다.
// 표는 <td> 둘(학생부·수능)과 그 아래 공통 안내로 되어 있다.
function noteLines(fragment) {
  const out = [];
  for (const chunk of fragment.split(/<br\s*\/?>|<\/p>|<\/dd>|<\/span>|<\/li>/iu)) {
    const line = stripTags(chunk);
    if (line.length > 3 && !out.includes(line)) out.push(line);
  }
  return out;
}

export function parseNotes(html) {
  const block = html.match(/<div class="tableWrap termInfo">([\s\S]*?)<form id="admssFrm"/u);
  const scope = block ? block[1] : html;
  const commonAt = (() => {
    const marked = scope.indexOf('공통 안내사항');
    return marked === -1 ? scope.indexOf('<p class="notice">') : marked;
  })();
  const body = commonAt === -1 ? scope : scope.slice(0, commonAt);
  const splitAt = body.indexOf('<td class="noRytLine"');
  const halves = splitAt === -1 ? [body, ''] : [body.slice(0, splitAt), body.slice(splitAt)];

  const terms = (fragment) => [...fragment.matchAll(/<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/gu)]
    .map((dl) => ({ term: stripTags(dl[1]), lines: noteLines(dl[2]).filter((line) => line !== '-') }))
    .filter((entry) => entry.term !== '' || entry.lines.length > 0);

  // 공통 안내는 <p> 단락 그대로 읽는다 — 앞에 붙은 주석(`<!-- 공통 안내사항 … -->`)의 잔재가
  // 줄머리에 섞이지 않게, 단락마다 첫 '※'부터 잘라 낸다.
  const common = [];
  if (commonAt !== -1) {
    for (const block of scope.slice(commonAt).matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gu)) {
      const line = stripTags(block[1]);
      const mark = line.indexOf('※');
      const text = mark === -1 ? line : line.slice(mark);
      if (text.length > 3 && !common.includes(text)) common.push(text);
    }
  }
  const sections = { 학생부: terms(halves[0]), 수능: terms(halves[1]), 공통: common };
  // 문서·화면이 인용할 평평한 원문 줄. 중복은 지우되 글자는 손대지 않는다.
  const lines = [];
  for (const entry of [...sections.학생부, ...sections.수능]) {
    for (const line of entry.lines) if (!lines.includes(line)) lines.push(line);
  }
  for (const line of sections.공통) if (!lines.includes(line)) lines.push(line);
  return { sections, lines };
}



