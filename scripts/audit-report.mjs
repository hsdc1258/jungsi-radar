// docs/AUDIT.md 생성기. source/audit.json(검수 기록)과 source/*.json(현재 값)에서만 숫자를 센다.
// 손으로 고치지 않는다 — 소스를 고치고 `node scripts/audit-report.mjs`를 다시 돌린다.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (file) => JSON.parse(readFileSync(path.join(ROOT, 'source', file), 'utf8'));

const GRADE_ORDER = ['A', 'B', 'C', 'D', 'E'];
const VERDICTS = ['일치', '정정', '정의 불일치', '확인 불가'];

// 대학 이름·순서는 생성물이 아니라 소스에서 가져온다.
function universityIndex(results, rules) {
  const out = new Map();
  for (const row of results) out.set(row.id, rules.universities[row.id]?.name || row.name || row.id);
  return out;
}

// 정시 값 하나하나의 출처 등급. 화면(정보 탭)과 이 문서가 같은 수를 쓴다.
export function gradeCounts(results) {
  const total = {};
  const byUniversity = new Map();
  for (const university of results) {
    const counts = {};
    for (const dept of university.departments) {
      for (const [year, row] of Object.entries(dept.jeongsi || {})) {
        if (year === 'alts') continue;
        const grade = row.sourceGrade || 'E';
        counts[grade] = (counts[grade] || 0) + 1;
        total[grade] = (total[grade] || 0) + 1;
      }
    }
    if (Object.keys(counts).length > 0) byUniversity.set(university.id, counts);
  }
  return { total, byUniversity };
}

const pct = (part, whole) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '—');
const num = (value) => (typeof value === 'number' ? String(value) : '—');

function gradeTable(total) {
  const sum = GRADE_ORDER.reduce((acc, g) => acc + (total[g] || 0), 0);
  const rows = GRADE_ORDER.map((g) => `| ${g} | ${LABEL[g]} | ${total[g] || 0} | ${pct(total[g] || 0, sum)} |`);
  return ['| 등급 | 뜻 | 모집단위 | 비율 |', '|---|---|---:|---:|', ...rows].join('\n');
}
const LABEL = {
  A: '평가원·대학 입학처 원문', B: '어디가 공개값', C: '언론이 옮긴 공식 표',
  D: '집계 사이트(학점나비)', E: '사설 예측·추정',
};

export function buildReport() {
  const results = read('results.json');
  const rules = read('rules-2027.json');
  const audit = read('audit.json');
  const names = universityIndex(results, rules);
  const { total, byUniversity } = gradeCounts(results);
  const lines = [];
  const push = (...text) => lines.push(...text);

  push('# 검수 — 값마다 출처를 매기고 원문과 대조한다', '');
  push('이 문서의 숫자는 모두 `scripts/audit-report.mjs`가 `source/audit.json`과 `source/*.json`에서 세어 만든다.');
  push('손으로 고치지 않는다 — 소스를 고치고 다시 돌린다.', '');
  push(`검수일 ${audit.auditedOn} · 대학 ${results.length}곳 · 정시 결과가 있는 모집단위 ${results.reduce((s, u) => s + u.departments.filter((d) => Object.keys(d.jeongsi || {}).length > 0).length, 0)}곳`, '');

  push('## 1. 출처 등급', '');
  push('| 등급 | 뜻 | 예 |', '|---|---|---|');
  for (const row of audit.rubric) push(`| ${row.grade} | ${row.label} | ${row.note} |`);
  push('', 'D·E만으로 뒷받침되는 값은 「확인됨」으로 두지 않는다.', '');

  push('## 2. 등급별 비율', '');
  push(gradeTable(total), '');
  for (const grade of GRADE_ORDER) {
    const list = [...byUniversity.entries()].filter(([, c]) => (c[grade] || 0) > 0)
      .sort((a, b) => (b[1][grade] || 0) - (a[1][grade] || 0))
      .map(([id, c]) => `${names.get(id)} ${c[grade]}`);
    if (list.length > 0) push(`- **${grade}** — ${list.join(' · ')}`);
  }
  push('');

  push('## 3. 대학별 판정', '');
  push('표본 대조를 한 대학만 판정이 있다. 판정 칸이 비어 있으면 대조할 A·B·C 출처를 구하지 못했다는 뜻이다.', '');
  push('| 대학 | 모집단위 | 주 출처 등급 | 일치 | 정정 | 정의 불일치 | 확인 불가 |', '|---|---:|---|---:|---:|---:|---:|');
  const sampleBy = new Map();
  for (const row of audit.samples) {
    if (!sampleBy.has(row.uni)) sampleBy.set(row.uni, []);
    sampleBy.get(row.uni).push(row);
  }
  for (const university of results) {
    const counts = byUniversity.get(university.id) || {};
    const main = GRADE_ORDER.filter((g) => counts[g] > 0).sort((a, b) => counts[b] - counts[a])[0] || '—';
    const rows = sampleBy.get(university.id) || [];
    const tally = Object.fromEntries(VERDICTS.map((v) => [v, rows.filter((r) => r.verdict === v).length]));
    const deptCount = Object.values(counts).reduce((a, b) => a + b, 0);
    const cells = rows.length === 0 ? VERDICTS.map(() => '—') : VERDICTS.map((v) => String(tally[v]));
    push(`| ${names.get(university.id)} | ${deptCount} | ${main} | ${cells.join(' | ')} |`);
  }
  push('');

  push('## 4. 고친 값', '');
  push(`이번 검수에서 ${audit.corrections.length}건을 고쳤다. 3절의 「정정」이 0인 것은 이미 고친 뒤의 값으로 다시 대조했기 때문이다.`, '');
  push('| 대학 | 모집단위·항목 | 학년도 | 무엇 | 전 | 후 | 등급 | 왜 | 출처 |', '|---|---|---|---|---|---|---|---|---|');
  for (const row of audit.corrections) {
    push(`| ${names.get(row.uni) || row.uni} | ${row.unit} | ${row.year} | ${row.field} | ${row.from} | ${row.to} | ${row.grade} | ${row.why} | ${row.src} |`);
  }
  push('');

  push('## 5. 표본 대조 — 모집단위별', '');
  push('`우리 값`은 화면이 예상 컷으로 쓰는 수, `출처 값`은 원문에서 읽은 수다. 정의가 다르면 값이 같아도 「정의 불일치」다.', '');
  for (const [id, rows] of sampleBy) {
    const years = [...new Set(rows.map((r) => r.year))].sort().join('·');
    push(`### ${names.get(id)} — ${years} · ${rows.length}행`, '');
    push('| 모집단위 | 학년도 | 우리 값 | 출처 값 | 등급 | 통계 | 정의 | 판정 | 출처 |', '|---|---|---:|---:|---|---|---|---|---|');
    for (const row of rows) {
      push(`| ${row.unit} | ${row.year} | ${num(row.ours)} | ${num(row.src)} | ${row.grade} | ${row.stat} | ${row.def} | ${row.verdict} | ${row.srcName} |`);
    }
    push('');
  }

  push('## 6. 학점나비 전사 충실도', '');
  push('학점나비(D)에서 옮긴 값이 그 페이지의 표와 같은가. 값의 옳고 그름이 아니라 우리가 옮기며 틀리지 않았는가를 본다.', '');
  const t = Object.values(audit.transcription).reduce((acc, v) => ({ ok: acc.ok + v.ok, bad: acc.bad + v.bad, none: acc.none + v.none }), { ok: 0, bad: 0, none: 0 });
  push('| 지표 | 행 |', '|---|---:|');
  push(`| 같은 이름·같은 값 | ${t.ok} |`, `| 같은 이름·다른 값 | ${t.bad} |`, `| 이름이 달라 짝을 못 지음 | ${t.none} |`);
  push('');

  push('## 7. 2027 반영 규칙 — 항목별', '');
  const items = [...new Set(audit.rules.map((r) => r.item))];
  push('| 항목 | 확인 | 확인(반영 없음) | 값 대조 실패 | 미확인 | 원문 없음 |', '|---|---:|---:|---:|---:|---:|');
  const kinds = ['확인', '확인(반영 없음)', '값 대조 실패', '미확인', '원문 없음'];
  for (const item of items) {
    const rows = audit.rules.filter((r) => r.item === item);
    push(`| ${item} | ${kinds.map((k) => rows.filter((r) => r.verdict === k).length).join(' | ')} |`);
  }
  push('');
  push('「값 대조 실패」는 항목 자체는 시행계획에 있으나 등급별 값이 원문 텍스트에서 함께 읽히지 않은 경우다(표가 그림이거나 셀이 흩어짐). 값을 지어내지 않고 그대로 둔다.', '');
  const notOk = audit.rules.filter((r) => r.verdict !== '확인' && r.verdict !== '확인(반영 없음)');
  push('| 대학 | 트랙 | 항목 | 우리 값 | 판정 |', '|---|---|---|---|---|');
  for (const row of notOk) push(`| ${names.get(row.uni) || row.uni} | ${row.track} | ${row.item} | ${row.value} | ${row.verdict} |`);
  push('');

  push('## 8. 수능 척도', '');
  push('| 항목 | 대조 수 | 방법 | 결과 | 판정 | 등급 |', '|---|---:|---|---|---|---|');
  for (const row of audit.scales) push(`| ${row.item} | ${row.n} | ${row.method} | ${row.result} | ${row.verdict} | ${row.grade} |`);
  push('');

  push('## 9. 계열 분류 정정', '');
  push('| 대학 | 모집단위 | 전 | 후 | 근거 |', '|---|---|---|---|---|');
  for (const row of audit.classification) push(`| ${names.get(row.uni) || row.uni} | ${row.unit} | ${row.from} | ${row.to} | ${row.why} |`);
  push('');

  push('## 10. 엔진 재현', '');
  push('입력 세 벌을 손으로 다시 계산해 화면 숫자와 맞춘다. 비교값은 국·수·탐(2) 백분위 단순평균, 판정 띠는 안정 ≥ +2.0 · 적정 ≥ +0.7 · 소신 ≥ −0.7 · 상향 ≥ −2.0 · 그 아래 위험이다.', '');
  push('| 입력 기준 | 성적 | 비교값(엔진) | 손 계산 | 진단 상위 10행 | 목표 화면 | 판정 |', '|---|---|---|---|---|---|---|');
  for (const row of audit.engine) push(`| ${row.set} | ${row.input} | ${row.compare} | ${row.hand} | ${row.rows} | ${row.target} | ${row.verdict} |`);
  push('');

  push('## 11. 확인 불가', '');
  push('| 범위 | 무엇을 | 왜 |', '|---|---|---|');
  for (const row of audit.unresolved) push(`| ${row.scope} | ${row.what} | ${row.why} |`);
  push('');
  return `${lines.join('\n')}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(ROOT, 'scripts/audit-report.mjs')) {
  writeFileSync(path.join(ROOT, 'docs/AUDIT.md'), buildReport(), 'utf8');
  console.log('wrote docs/AUDIT.md');
}
