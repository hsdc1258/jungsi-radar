// 이상치 탐지 — 설명이 필요한 2026학년도 70%컷을 찾아 분류한다.
//   source/results.json → source/anomalies.json
// `npm run anomalies` 가 이 파일을 돌리고, `npm run build` 는 그 결과를 읽기만 한다
// (scripts/build-data.mjs readAnomalies). 판정 규칙은 여기 한 곳에만 있다.
//
// 왜 두 갈래인가: 같은 대학 같은 계열에서 혼자 낮은 값은 그 자체로는 아무것도 말해 주지 않는다.
// 축산학과·농학과·야간 경영·간호처럼 **원래 컷이 낮은 모집단위**가 대부분이기 때문이다.
// 그래서 (a) 계열 중앙값에서 떨어진 값은 후보로만 두고, 판정은 (b) 그 모집단위 **자신의 이력**과
// 견줘서만 내린다. 이력이 없으면 `미확인`이고 뱃지도 달지 않는다 — 근거 없는 단일값을 오류라고
// 부르지 않는다 (docs/FRAME.md §9.4, docs/AUDIT.md §13).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildData } from './build-data.mjs';

const ROOT = process.cwd();
const SOURCE = path.join(ROOT, 'source');
const OUTPUT = path.join(SOURCE, 'anomalies.json');
export const YEAR = '2026';
// 문턱. 값이 촘촘하면 MAD 가 0에 가까워지므로 절대 하한 3점을 함께 둔다.
export const FLOOR = 3;
export const K = 2.5;
export const THRESHOLD_TEXT = '계열 (중앙값 − 값) > max(3, 2.5 × MAD) · 이력 |값 − 이력 중앙값| > max(3, 2.5 × MAD)';

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

// (a) 계열 후보인가. 한쪽(아래쪽)만 본다 — 계열 중앙값보다 크게 **낮은** 값이 설명이 필요한 값이다.
// 이것만으로는 판정이 아니라 후보일 뿐이다.
export function isCandidate(value, medianValue, madValue) {
  if (!isNum(value) || !isNum(medianValue)) return false;
  return (medianValue - value) > threshold(madValue);
}

// 이 모집단위의 이전 연도 값들. `series` 는 대학 공식값까지 한 눈금으로 환산해 둔 줄이다
// (scripts/build-data.mjs buildSeries) — 그래서 2026 값과 그대로 견줄 수 있다.
export function priorValues(row) {
  return (row.series || [])
    .filter((entry) => entry.year < YEAR && isNum(entry.value))
    .map((entry) => entry.value);
}

// 이력 통계. 값이 하나뿐이면 MAD 가 0이라 문턱은 절대 하한 3점이 된다.
export function priorStats(row) {
  const values = priorValues(row);
  if (values.length === 0) return null;
  return { center: median(values), spread: mad(values), count: values.length };
}

// (b) 이력 후보인가. 후보로는 양쪽을 본다 — 다만 판정에서 이력보다 크게 낮으면 펑크,
// 크게 높으면 실제 상승이라 정상이다.
export function isPriorCandidate(value, stats) {
  if (!isNum(value) || !stats) return false;
  return Math.abs(value - stats.center) > threshold(stats.spread);
}

// 값 자체가 말이 되는가. 이것만은 이력이 없어도 오류라고 부를 수 있다 —
// 백분위가 0~100 밖이거나, 70%컷이 50%컷보다 높은(상위 절반의 컷보다 높은) 자기모순이다.
export function isImpossible(row) {
  if (!isNum(row.value)) return true;
  if (row.value < 0 || row.value > 100) return true;
  if (isNum(row.cut50) && row.value > row.cut50) return true;
  return false;
}

// 후보의 분류. 순수 함수 — tests/anomalies.test.mjs 가 합성 입력으로 검사한다. 후보에만 부른다.
//   error       오류 의심 — 값 자체가 말이 되지 않는다(백분위 범위 밖 · 70%컷 > 50%컷). 자기모순만 남는다.
//   punk        펑크 의심 — 이력이 있는데 2026이 이력보다 크게 **낮다**.
//   practical   실기 혼입 — 예체능 실기 모집단위는 수능 컷이 낮은 것이 정상이다.
//   unverified  미확인 — 이력이 없는 단일값. 계열에서 떨어져 있을 뿐 근거가 없다. 뱃지 없음.
//   normal      설명 가능 — 이력이 있고 2026이 그 이력대로이거나, 이력보다 높다(실제 상승).
export function classifyAnomaly(row) {
  if (isImpossible(row)) return 'error';
  const stats = priorStats(row);
  if (stats) {
    const limit = threshold(stats.spread);
    if (stats.center - row.value > limit) return 'punk';
    // 이력보다 크게 **높은** 값은 오류가 아니다. 이 이력은 2026 기준값에 대학 공식 변화량을 더해
    // 만든 줄(scripts/build-data.mjs buildSeries)이라, 그보다 높다는 것은 실제 상승을 뜻한다.
    if (row.value - stats.center > limit) return 'normal';
  }
  if (row.practical === true) return 'practical';
  // 이력이 없는 후보는 (a) 계열 기준에서만 온 값이다 — 이력이 없으면 (b)가 켜지지 않는다.
  if (!stats) return 'unverified';
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
        cut50: isNum(current.cut50) ? current.cut50 : null,
        series: (dept.series || []).map((entry) => ({ year: entry.year, value: entry.value })),
      });
    }
  }
  return rows;
}

// 후보 목록. 순수 함수 — 입력은 rowsOf 가 만든 행 배열이다.
// 계열(a)에서 떨어졌거나 자기 이력(b)에서 떨어진 행을 모두 담고, 분류로 갈라 놓는다.
export function detect(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = groupKey(row.id, row.track);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const items = [];
  for (const group of groups.values()) {
    // 두 곳뿐인 묶음은 중앙값이 곧 두 값의 평균이라 서로를 이상치로 만든다 — 셋부터 계열 기준을 쓴다.
    const usable = group.length >= 3;
    const values = group.map((row) => row.value);
    const center = usable ? median(values) : null;
    const spread = usable ? mad(values) : null;
    for (const row of group) {
      const prior = priorStats(row);
      const groupHit = usable && isCandidate(row.value, center, spread);
      const priorHit = isPriorCandidate(row.value, prior);
      if (!groupHit && !priorHit) continue;
      items.push({
        id: row.id,
        name: row.name,
        track: row.track,
        value: round2(row.value),
        median: usable ? round2(center) : null,
        mad: usable ? round2(spread) : null,
        gap: usable ? round2(center - row.value) : null,
        priorMedian: prior ? round2(prior.center) : null,
        priorMad: prior ? round2(prior.spread) : null,
        // 양수면 이력보다 낮다(펑크 쪽), 음수면 이력보다 높다(상승 쪽).
        priorGap: prior ? round2(prior.center - row.value) : null,
        priorCount: prior ? prior.count : 0,
        basis: groupHit && priorHit ? 'both' : groupHit ? 'group' : 'prior',
        kind: classifyAnomaly(row),
      });
    }
  }
  return items.sort((left, right) => strength(right) - strength(left)
    || String(left.id).localeCompare(String(right.id))
    || String(left.name).localeCompare(String(right.name), 'ko'));
}

// 정렬 세기. 계열과 이력 중 더 크게 벌어진 쪽을 쓴다.
export function strength(item) {
  const group = isNum(item.gap) ? Math.abs(item.gap) : 0;
  const prior = isNum(item.priorGap) ? Math.abs(item.priorGap) : 0;
  return Math.max(group, prior);
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
