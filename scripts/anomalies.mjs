// 이상치 탐지 — 계열 중앙값에서 크게 떨어진 2026학년도 70%컷을 찾아 분류한다.
//   source/results.json → source/anomalies.json
// `npm run anomalies` 가 이 파일을 돌리고, `npm run build` 는 그 결과를 읽기만 한다
// (scripts/build-data.mjs readAnomalies). 판정 규칙은 여기 한 곳에만 있다.
//
// 왜 필요한가: 같은 대학 같은 계열인데 한 모집단위만 컷이 뚝 떨어진 값은 셋 중 하나다 —
// 그 해 지원자가 적었거나(펑크), 원자료를 잘못 읽었거나(오류), 실기 비중이 큰 예체능이다.
// 화면은 이 셋을 구분해서만 `이상` 뱃지를 붙인다 (docs/FRAME.md §9.4).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildData } from './build-data.mjs';

const ROOT = process.cwd();
const SOURCE = path.join(ROOT, 'source');
const OUTPUT = path.join(SOURCE, 'anomalies.json');
export const YEAR = '2026';
// 문턱. 계열 값이 촘촘하면 MAD 가 0에 가까워지므로 절대 하한 3점을 함께 둔다.
export const FLOOR = 3;
export const K = 2.5;
export const THRESHOLD_TEXT = '(중앙값 − 값) > max(3, 2.5 × MAD)';

const isNum = (value) => typeof value === 'number' && Number.isFinite(value);
const round2 = (value) => Math.round(value * 100) / 100;

export function median(values) {
  const sorted = values.filter(isNum).sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// 중앙값 절대편차. 표준편차와 달리 이상치 하나가 문턱을 밀어 올리지 않는다.
export function mad(values) {
  const center = median(values);
  if (center === null) return null;
  return median(values.filter(isNum).map((value) => Math.abs(value - center)));
}

export function threshold(madValue) {
  return Math.max(FLOOR, K * (isNum(madValue) ? madValue : 0));
}

// 후보인가. 한쪽(아래쪽)만 본다 — 계열 중앙값보다 크게 **낮은** 값이 설명이 필요한 값이다.
export function isCandidate(value, medianValue, madValue) {
  if (!isNum(value) || !isNum(medianValue)) return false;
  return (medianValue - value) > threshold(madValue);
}

// 후보의 분류. 순수 함수 — tests/anomalies.test.mjs 가 합성 입력으로 검사한다.
//   practical 실기 혼입 — 예체능 실기 모집단위는 수능 컷이 낮은 것이 정상이다.
//   error     오류 의심 — 값을 뒷받침할 것이 없다. 사설 추정(E)이거나, 이전 연도도 경쟁률도
//             없거나, 집계 사이트가 정수로 옮긴 값(D)이 그 해 하나뿐이다.
//             D 자체는 흔한 등급이라(전체의 8할) 등급만으로는 오류로 보지 않는다 — docs/AUDIT.md §1·§2.
//   punk      펑크 의심 — 이전 연도보다 그 해만 크게 낮고 경쟁률·충원이 정상이다.
//   normal    설명 가능 — 이전 연도부터 계속 낮았던 값.
export function classifyAnomaly(row) {
  if (row.practical === true) return 'practical';
  const prior = (row.series || [])
    .filter((entry) => entry.year < YEAR && isNum(entry.value))
    .map((entry) => entry.value);
  const grade = String(row.sourceGrade || '');
  // 경쟁률·충원이 정상인가. 값이 있고 말이 되는 범위여야 '그 해 지원자가 적었다'고 말할 수 있다.
  const ratesOk = isNum(row.rate) && row.rate > 0
    && (row.fillRate === null || row.fillRate === undefined || (isNum(row.fillRate) && row.fillRate >= 0));
  if (grade === 'E') return 'error';
  if (prior.length === 0 && !ratesOk) return 'error';
  if (grade === 'D' && prior.length === 0) return 'error';
  const priorMin = prior.length > 0 ? Math.min(...prior) : null;
  if (priorMin !== null && (priorMin - row.value) >= FLOOR && ratesOk) return 'punk';
  return 'normal';
}

// 대학 × 계열 묶음. 한 묶음의 2026 70%컷들이 서로의 기준이 된다.
export function groupKey(universityId, track) {
  return `${universityId}::${track}`;
}

// 검사 대상 행. 생성 데이터(buildData)의 모집단위를 쓴다 — 계열·실기 여부가 이미 정해져 있고,
// 이전 연도 값도 대학 공식값에서 환산한 `series` 로 이미 한 눈금에 맞춰져 있다.
export function rowsOf(universities) {
  const rows = [];
  for (const university of universities) {
    for (const dept of university.departments || []) {
      const current = (dept.jeongsi || {})[YEAR];
      if (!current || current.metric !== 'pct' || !isNum(current.cut70)) continue;
      rows.push({
        id: university.id,
        name: dept.name,
        track: dept.track,
        practical: dept.practical === true,
        value: current.cut70,
        rate: isNum(current.rate) ? current.rate : null,
        fillRate: isNum(current.fillRate) ? current.fillRate : null,
        sourceGrade: current.sourceGrade || 'E',
        series: (dept.series || []).map((entry) => ({ year: entry.year, value: entry.value })),
      });
    }
  }
  return rows;
}

// 후보 목록. 순수 함수 — 입력은 rowsOf 가 만든 행 배열이다.
export function detect(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = groupKey(row.id, row.track);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const items = [];
  for (const group of groups.values()) {
    // 두 곳뿐인 묶음은 중앙값이 곧 두 값의 평균이라 서로를 이상치로 만든다 — 셋부터 본다.
    if (group.length < 3) continue;
    const values = group.map((row) => row.value);
    const center = median(values);
    const spread = mad(values);
    for (const row of group) {
      if (!isCandidate(row.value, center, spread)) continue;
      items.push({
        id: row.id,
        name: row.name,
        track: row.track,
        value: round2(row.value),
        median: round2(center),
        mad: round2(spread),
        gap: round2(center - row.value),
        kind: classifyAnomaly(row),
      });
    }
  }
  return items.sort((left, right) => right.gap - left.gap);
}

export function buildAnomalies(universities) {
  return {
    year: YEAR,
    threshold: THRESHOLD_TEXT,
    items: detect(rowsOf(universities)),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(ROOT, 'scripts/anomalies.mjs')) {
  const built = buildAnomalies(buildData().universities);
  const text = `${JSON.stringify(built, null, 1)}\n`;
  // 내용이 같으면 파일을 건드리지 않는다 — 다시 빌드해도 diff 가 나오지 않아야 한다.
  if (!existsSync(OUTPUT) || readFileSync(OUTPUT, 'utf8') !== text) writeFileSync(OUTPUT, text, 'utf8');
  const counts = {};
  for (const item of built.items) counts[item.kind] = (counts[item.kind] || 0) + 1;
  console.log(`wrote ${path.relative(ROOT, OUTPUT)}: ${built.items.length} candidates`, counts);
}
