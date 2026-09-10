// 이상치 탐지 — 설명이 필요한 2026학년도 입결을 찾아 분류한다 (docs/MODEL.md §6).
//   source/results.json → source/anomalies.json
// `npm run anomalies` 가 이 파일을 돌리고, `npm run build` 는 그 결과를 읽기만 한다
// (scripts/build-data.mjs readAnomalies). 판정 규칙은 여기 한 곳에만 있다.
//
// v3에서 바뀐 것 — 어디가 입결은 **환산점수 순으로 줄 세운 뒤 그 지점 학생 한 명**의 값이다.
// 그래서 평균백분위 50% < 70% 는 모순이 아니다(국어가 강한 학생이 평균은 낮아도 위에 선다).
// 종전 규칙(50%컷 < 70%컷 = 오류)은 폐기했다. 남은 오류는 셋뿐이다:
//   환산점수 50% < 70% · 환산점수가 총점 초과 · 백분위가 0~100 밖.
// 펑크는 값 하나로 부르지 않는다 — **같은 선발 조건**에서 전년보다 문턱 이상 낮고, 경쟁률 하락이나
// 충원 ≥ 모집인원이 함께 있을 때만이다. 그 밖은 `undetermined`(판단 불가)이고 뱃지도 붙지 않는다.
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
// 환산점수 하락 문턱은 대학마다 총점이 달라 비율로 잡는다(총점의 0.5%, 최소 1점).
export const SCORE_DROP_RATE = 0.005;
// 같은 선발 조건으로 보는 모집인원 변화 폭(§5). 이보다 크게 바뀌면 연속 비교를 끊는다.
export const QUOTA_TOLERANCE = 0.3;
export const THRESHOLD_TEXT = '오류 = 환산 50% < 70% · 총점 초과 · 백분위 범위 밖 / 펑크 = 같은 선발 조건에서 전년 대비 하락 + (경쟁률 하락 또는 충원 ≥ 모집인원)';

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

export function priorStats(row) {
  const values = priorValues(row);
  if (values.length === 0) return null;
  return { center: median(values), spread: mad(values), count: values.length };
}

// (b) 이력 후보인가. 후보로는 양쪽을 본다 — 판정(펑크)은 아래쪽만 본다.
export function isPriorCandidate(value, stats) {
  if (!isNum(value) || !stats) return false;
  return Math.abs(value - stats.center) > threshold(stats.spread);
}

// §5 — 연속 비교가 가능한 선발 조건인가. 모집군이 바뀌었거나 모집인원이 크게 달라졌으면 끊는다.
export function sameConditions(row) {
  if (row.conditionsSame === false) return false;
  const prior = row.prior || null;
  if (!prior) return true;
  if (row.group && prior.group && row.group !== prior.group) return false;
  if (isNum(row.quota) && isNum(prior.quota) && prior.quota > 0) {
    if (Math.abs(row.quota - prior.quota) / prior.quota > QUOTA_TOLERANCE) return false;
  }
  return true;
}

// 값 자체가 말이 되지 않는 경우. 이것만은 이력이 없어도 오류라고 부를 수 있다.
//   - 환산점수 50% < 70% : 환산점수 순 정렬에서 불가능하다.
//   - 환산점수가 총점을 넘는다.
//   - 백분위가 0~100 밖이다.
// **평균백분위 50% < 70% 는 오류가 아니다** — 환산점수 순 정렬의 정상적인 결과다(§0 미래융합전공(C)).
export function errorReasons(row) {
  const out = [];
  if (isNum(row.score50) && isNum(row.score70) && row.score50 < row.score70) out.push('환산 50% < 70%');
  if (isNum(row.total) && row.total > 0) {
    if (isNum(row.score70) && row.score70 > row.total) out.push('70% 환산점수가 총점 초과');
    if (isNum(row.score50) && row.score50 > row.total) out.push('50% 환산점수가 총점 초과');
  }
  for (const [label, value] of [['70%컷', row.value], ['50%컷', row.cut50], ['100%컷', row.cut100]]) {
    if (value === null || value === undefined) continue;
    if (!isNum(value) || value < 0 || value > 100) out.push(`${label} 백분위 범위 밖`);
  }
  return out;
}
export const isError = (row) => errorReasons(row).length > 0;

// 전년 대비 하락 폭. 평균백분위(이력 중앙값)와 환산점수 둘 다 본다.
export function dropOf(row) {
  const stats = priorStats(row);
  const byPct = stats && isNum(row.value) ? round2(stats.center - row.value) : null;
  const byScore = isNum(row.score70) && isNum(row.prior?.score70) ? round2(row.prior.score70 - row.score70) : null;
  const pctHit = isNum(byPct) && byPct > threshold(stats.spread);
  const scoreLimit = isNum(row.total) && row.total > 0 ? Math.max(1, row.total * SCORE_DROP_RATE) : 1;
  const scoreHit = isNum(byScore) && byScore > scoreLimit;
  return { byPct, byScore, dropped: pctHit || scoreHit };
}

// 펑크 의심. 하락 하나만으로는 부르지 않는다 — 경쟁률 하락이나 충원 ≥ 모집인원이 함께 있어야 한다.
export function punkReasons(row) {
  if (!sameConditions(row)) return [];
  const drop = dropOf(row);
  if (!drop.dropped) return [];
  const signals = [];
  if (isNum(row.rate) && isNum(row.prior?.rate) && row.rate < row.prior.rate) signals.push('경쟁률 하락');
  if (isNum(row.fill) && isNum(row.quota) && row.quota > 0 && row.fill >= row.quota) signals.push('충원 ≥ 모집인원');
  if (signals.length === 0) return [];
  return ['전년 대비 하락', ...signals];
}
export const isPunk = (row) => punkReasons(row).length > 0;

// 후보의 분류. 순수 함수 — tests/anomalies.test.mjs 가 합성 입력으로 검사한다.
//   error         값 자체가 말이 되지 않는다.
//   punk          같은 선발 조건에서 전년보다 낮고, 경쟁률·충원 신호가 함께 있다.
//   practical     실기 예체능 — 수능 컷이 낮은 것이 정상이다.
//   undetermined  판단 불가. 뱃지 없음.
export function classifyAnomaly(row) {
  if (isError(row)) return 'error';
  if (isPunk(row)) return 'punk';
  if (row.practical === true) return 'practical';
  return 'undetermined';
}

export function reasonsOf(row) {
  const error = errorReasons(row);
  if (error.length > 0) return error;
  const punk = punkReasons(row);
  if (punk.length > 0) return punk;
  if (row.practical === true) return ['실기 반영 모집단위'];
  return [];
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
      if (!current) continue;
      const priorYear = Object.keys(dept.jeongsi || {}).filter((year) => year < YEAR).sort().at(-1) || null;
      const priorRow = priorYear ? dept.jeongsi[priorYear] : null;
      const score = current.score || {};
      const priorScore = priorRow?.score || {};
      if (!isNum(current.cut70) && !isNum(score.p70) && !isNum(current.score70)) continue;
      rows.push({
        id: university.id,
        name: dept.name,
        track: dept.track,
        practical: dept.practical === true,
        value: isNum(current.cut70) ? current.cut70 : null,
        cut50: isNum(current.cut50) ? current.cut50 : null,
        cut100: isNum(current.cut100) ? current.cut100 : null,
        score70: isNum(score.p70) ? score.p70 : (isNum(current.score70) ? current.score70 : null),
        score50: isNum(score.p50) ? score.p50 : (isNum(current.score50) ? current.score50 : null),
        total: isNum(score.total) ? score.total : null,
        group: current.group || null,
        quota: isNum(current.quota) ? current.quota : null,
        rate: isNum(current.rate) ? current.rate : null,
        fill: isNum(current.fill) ? current.fill : null,
        prior: priorRow
          ? {
            year: priorYear,
            value: isNum(priorRow.cut70) ? priorRow.cut70 : null,
            score70: isNum(priorScore.p70) ? priorScore.p70 : (isNum(priorRow.score70) ? priorRow.score70 : null),
            group: priorRow.group || null,
            quota: isNum(priorRow.quota) ? priorRow.quota : null,
            rate: isNum(priorRow.rate) ? priorRow.rate : null,
          }
          : null,
        series: (dept.series || []).map((entry) => ({ year: entry.year, value: entry.value })),
      });
    }
  }
  return rows;
}

// 후보 목록. 순수 함수 — 입력은 rowsOf 가 만든 행 배열이다.
// 오류·펑크는 후보 여부와 무관하게 싣는다. 그 밖은 계열(a)이나 자기 이력(b)에서 벗어난 행만
// `undetermined`(또는 실기)로 남긴다 — 판정이 아니라 "설명이 필요한 곳" 목록이다.
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
    const values = group.map((row) => row.value).filter(isNum);
    const center = usable && values.length > 0 ? median(values) : null;
    const spread = usable && values.length > 0 ? mad(values) : null;
    for (const row of group) {
      const kind = classifyAnomaly(row);
      const prior = priorStats(row);
      const groupHit = usable && isCandidate(row.value, center, spread);
      const priorHit = isPriorCandidate(row.value, prior);
      const flagged = kind === 'error' || kind === 'punk';
      if (!flagged && !groupHit && !priorHit) continue;
      items.push({
        id: row.id,
        name: row.name,
        track: row.track,
        value: isNum(row.value) ? round2(row.value) : null,
        score70: row.score70,
        score50: row.score50,
        median: center === null ? null : round2(center),
        mad: spread === null ? null : round2(spread),
        gap: center === null || !isNum(row.value) ? null : round2(center - row.value),
        priorMedian: prior ? round2(prior.center) : null,
        priorMad: prior ? round2(prior.spread) : null,
        // 양수면 이력보다 낮다(펑크 쪽), 음수면 이력보다 높다(상승 쪽).
        priorGap: prior && isNum(row.value) ? round2(prior.center - row.value) : null,
        priorCount: prior ? prior.count : 0,
        basis: groupHit && priorHit ? 'both' : groupHit ? 'group' : priorHit ? 'prior' : 'value',
        kind,
        reasons: reasonsOf(row),
      });
    }
  }
  return items.sort((left, right) => strength(right) - strength(left)
    || String(left.id).localeCompare(String(right.id))
    || String(left.name).localeCompare(String(right.name), 'ko'));
}

// 정렬 세기. 계열과 이력 중 더 크게 벌어진 쪽을 쓴다. 오류는 언제나 맨 위다.
export function strength(item) {
  if (item.kind === 'error') return Number.MAX_SAFE_INTEGER;
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
