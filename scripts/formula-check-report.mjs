// docs/AUDIT.md 의 「v3 산식 검산」 절 생성기.
// 숫자는 전부 `source/formula-check.json`(= npm run verify 가 쓴 파일)에서만 센다 — 손으로 고치지 않는다.
// 이 스크립트는 AUDIT.md 를 통째로 다시 쓰지 않고 표시자 사이만 갈아 끼운다(다른 절은 손대지 않는다).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (file) => JSON.parse(readFileSync(path.join(ROOT, 'source', file), 'utf8'));

export const START = '<!-- formula-check:start -->';
export const END = '<!-- formula-check:end -->';

// docs/MODEL.md §1.4 의 세 판정.
const LABEL = {
  verified: '대조 가능한 행의 90% 이상이 구간 안 — L1(환산점수) 판정에 이 트랙만 쓴다',
  mismatch: '그 밖 — 산식이나 우리가 옮긴 값이 요강과 어긋난다. 그 모집단위는 L2로 내려간다',
  unchecked: '어디가 환산점수나 영역별 백분위가 없어 대조 자체가 불가',
};
const ORDER = Object.keys(LABEL);
const pct = (part, whole) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '—');

function names() {
  const out = new Map();
  const rules = read('rules-2027.json');
  for (const [id, row] of Object.entries(rules.universities || {})) out.set(id, row.name || id);
  const rules2026 = read('rules-2026.json');
  for (const [id, row] of Object.entries(rules2026.universities || {})) if (!out.has(id)) out.set(id, row.name || id);
  return out;
}

export function formulaCheckSection() {
  const check = read('formula-check.json');
  const name = names();
  const tracks = Object.values(check.tracks || {});
  const totals = {};
  let rows = 0;
  for (const row of tracks) {
    totals[row.status] = (totals[row.status] || 0) + 1;
    rows += (row.match || 0) + (row.mismatch || 0);
  }
  const label = (row) => name.get(row.university) || row.university;
  const sorted = [...tracks].sort((left, right) => (
    ORDER.indexOf(left.status) - ORDER.indexOf(right.status)
    || label(left).localeCompare(label(right), 'ko')
    || String(left.track).localeCompare(String(right.track), 'ko')
  ));

  const lines = [];
  const push = (...text) => lines.push(...text);
  push('## 14. v3 산식 검산', '');
  push('`npm run verify`(`scripts/verify-formulas.mjs`)가 어디가 70%·50% 지점 학생의 영역별 백분위를 그 해');
  push('도수분포로 표준점수 구간으로 되읽고(docs/MODEL.md §1.3), 요강 산식에 넣어 환산점수 구간을 만든다.');
  push(`어디가가 공시한 환산점수가 그 구간 ±${check.tolerance}점 안이면 그 행은 일치다. 대조 가능한 행의 90% 이상이`);
  push('일치한 트랙만 `verified`이고, **`verified` 트랙만 L1(환산점수) 판정에 쓴다**(MODEL §1.4).', '');
  push('| 판정 | 트랙 | 뜻 |', '|---|---:|---|');
  for (const status of ORDER) push(`| ${status} | ${totals[status] || 0} | ${LABEL[status]} |`);
  push('', `대조한 행 ${rows.toLocaleString('en-US')}개 · 트랙 ${tracks.length}개.`, '');
  push('| 대학 | 트랙 | 학년도 | 모집단위 | 일치 | 불일치 | 대조 불가 | 일치율 | 판정 |',
    '|---|---|---:|---:|---:|---:|---:|---:|---|');
  for (const row of sorted) {
    const seen = (row.match || 0) + (row.mismatch || 0);
    push(`| ${label(row)} | ${row.track} | ${row.year ?? '—'} | ${row.depts ?? '—'} | ${row.match || 0} | ${row.mismatch || 0} | ${row.unchecked || 0} | ${pct(row.match || 0, seen)} | ${row.status} |`);
  }
  push('');
  if ((check.skipped || []).length > 0) {
    push('검산을 걸지도 못한 대학 — 요강이 정규화 상수·배점을 밝히지 않아 산식을 세울 수 없다.', '');
    push('| 대학 | 행 | 왜 |', '|---|---:|---|');
    for (const row of check.skipped) push(`| ${label(row)} | ${row.rows ?? '—'} | ${row.reason} |`);
    push('');
  }
  return lines.join('\n');
}

export function splice(document, section) {
  const block = `${START}\n${section}\n${END}`;
  const from = document.indexOf(START);
  const to = document.indexOf(END);
  if (from >= 0 && to > from) return `${document.slice(0, from)}${block}${document.slice(to + END.length)}`;
  return `${document.replace(/\s*$/u, '')}\n\n${block}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(ROOT, 'scripts/formula-check-report.mjs')) {
  const file = path.join(ROOT, 'docs/AUDIT.md');
  writeFileSync(file, splice(readFileSync(file, 'utf8'), formulaCheckSection()), 'utf8');
  console.log('wrote docs/AUDIT.md §14 v3 산식 검산');
}
