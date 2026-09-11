// 정확도 전수검사 (docs/MODEL.md §9). → docs/ACCURACY-AUDIT.md  (`npm run accuracy`)
//
// 실제 합격 여부 자료는 없다. 그래서 정확도는 **공시값 재현**과 **자기 위치 판정**으로 잰다.
// 확률·합격률 숫자는 만들지 않는다. 손으로 적은 숫자도 없다 — 전부 여기서 센다.
//
//   A. 재현      어디가 행 전부(70%·50% 두 지점)를 §1.3으로 되읽어 §1.2 산식에 넣고,
//                공시 환산점수가 재현 구간 ±1.0점 안에 드는가. 검산기(verify-formulas) 경로다.
//   B. 자기 위치 그 모집단위 70% 지점 학생의 성적표를 **사용자 입력처럼** 넣어 그 모집단위를
//                판정했을 때 제자리(소신·차이 0)가 나오는가. 사용자 경로(normalizeProfile →
//                evaluateJeongsi)라 되읽기·자격·가산·층위 선택까지 한 번에 검사한다.
//   C. 교차 검수 서로 다른 대학·층위·계열의 실제 70% 학생 성적표 여섯 벌을 **전 모집단위**에
//                넣어 자기 자리·단조·층위 사이 어긋남을 본다.
//   D. 흔들림    컷을 ±0.5·±1.0(백분위 상당) 옮겼을 때 띠 이름이 바뀌는 비율(층위별).
//
// A와 B는 같은 자료를 다른 길로 본다 — 둘이 어긋나면 그 자체가 결함이고, 그 어긋남이
// 이 보고서의 '되읽기 폭' 항목이다.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { checkPoint, deptOf as adigaDeptOf, readAdigaRows } from './verify-formulas.mjs';

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, 'docs/ACCURACY-AUDIT.md');

// 브라우저용 IIFE 두 개(엔진·생성 데이터)를 노드에서 그대로 읽는다 — 화면과 **같은 파일**이다.
export function loadBrowser(file, name) {
  const context = { globalThis: null, window: null };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
  return context[name];
}

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const round = (value, digits = 1) => (isNumber(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null);
const rate = (part, whole) => (whole > 0 ? round((part / whole) * 100, 1) : null);
const KIND_NAME = Object.freeze({ social: '사탐', science: '과탐', vocational: '직탐' });
const CONV_LABEL = Object.freeze({ official: '대학 공개 원표', approx: '근사표', none: '안 씀' });

// L1은 소신 폭(±0.7), L2·L3는 정의상 차이 0이어야 한다(§9).
export const SELF_BAND = 0.7;
export const SELF_ZERO = 0.05;
// A의 판정 허용폭. verify-formulas.TOLERANCE 와 같은 값이다.
export const REPRO_TOLERANCE = 1.0;
// L1 오답을 되읽기 폭 탓으로 보는 구간 폭(환산점수 점)과, 기울기가 무너졌다고 보는 값(점/백분위).
export const WIDE_READBACK = 6;
export const WEAK_SLOPE = 1;

// ---------------------------------------------------------------- 성적표 → 사용자 입력
// 어디가 70%(50%) 지점 학생 한 명의 성적표를 화면 입력 형식으로 옮긴다.
//   · 탐구는 **종류만** 공시된다 — 과목이 없으므로 `inqNKind` 로 넣고 되읽기는 그 종류 전체 구간이다.
//   · 국어·수학 선택과목도 공시되지 않는다 — 기본값(화법과작문·확률과통계)이라 미적분·기하
//     가산은 붙지 않는다. 그 선택과목을 요구하는 모집단위에서는 자격 미충족으로 걸린다.
export function profileInput(student, year) {
  if (!student) return null;
  const input = {
    mode: 'pct', sourceKind: 'actual', year: String(year ?? ''),
    korElective: '화법과작문', mathElective: '확률과통계',
    kor: isNumber(student.kor) ? String(student.kor) : '',
    math: isNumber(student.math) ? String(student.math) : '',
    eng: isNumber(student.eng) ? String(student.eng) : '',
    hist: isNumber(student.hist) ? String(student.hist) : '',
  };
  (student.inq || []).forEach((row, index) => {
    input[`inq${index + 1}`] = String(row.pct);
    if (row.subject) input[`inq${index + 1}Subject`] = row.subject;
    else input[`inq${index + 1}Kind`] = KIND_NAME[row.kind] || '';
  });
  return input;
}

// 엔진이 그 모집단위의 컷으로 고르는 학년도 (engine.pickCutYear 와 같은 규칙).
export function cutYearOf(dept) {
  const years = Object.keys(dept?.jeongsi || {}).filter((key) => key !== 'alts').sort().reverse();
  return years.find((year) => {
    const row = dept.jeongsi[year];
    return isNumber(row?.score?.p70) || isNumber(row?.score70) || row?.student?.p70;
  }) || years[0] || null;
}

// 한 모집단위 × 한 지점(p70·p50)의 자기 위치 판정. 테스트가 직접 부른다.
export function selfPlacement(engine, data, university, dept, point = 'p70') {
  const year = cutYearOf(dept);
  const row = year ? dept.jeongsi[year] : null;
  const student = engine.normalizeCutStudent(row?.student?.[point]);
  if (!student || !isNumber(student.kor) || !isNumber(student.math) || student.inq.length === 0) {
    return { year, student: null, result: null, reason: '영역별 백분위 없음' };
  }
  if (student.consistent === false) return { year, student, result: null, reason: '평균백분위 불일치(§1.1)' };
  const profile = engine.normalizeProfile(profileInput(student, year), data.scales, data.std);
  const result = engine.evaluateJeongsi(
    profile, university, dept, data.rules?.[university.id],
    university.volatility ?? data.volatility, engine.layerContext(data),
  );
  return { year, student, profile, result, reason: null };
}

// ---------------------------------------------------------------- A. 재현
// 어디가 행 전부 × 두 지점. verify-formulas 와 같은 함수(checkPoint)로 재고, 여기서는
// 행마다 **어느 층위로 판정되는 모집단위인가**와 변환표 근사 여부를 함께 남긴다.
export function auditReproduction(engine, data, levelOf) {
  const rows = readAdigaRows();
  const counts = { match: 0, mismatch: 0, unchecked: 0 };
  const byLevel = new Map();
  const byUniversity = new Map();
  const byPoint = new Map([['p70', { match: 0, mismatch: 0, unchecked: 0 }], ['p50', { match: 0, mismatch: 0, unchecked: 0 }]]);
  const byConversion = new Map([['official', { match: 0, mismatch: 0 }], ['approx', { match: 0, mismatch: 0 }], ['none', { match: 0, mismatch: 0 }]]);
  const buckets = new Map();
  const reasons = new Map();
  const misses = new Map(); // 모집단위 단위 mismatch 목록 (상위 원인용)
  const bump = (map, key, field) => {
    if (!map.has(key)) map.set(key, { match: 0, mismatch: 0, unchecked: 0 });
    map.get(key)[field] += 1;
  };

  for (const row of rows) {
    const universityId = row.universityId || row.university || row.id || null;
    if (!universityId) continue;
    const dept = adigaDeptOf(universityId, row.dept);
    const track = engine.pickModelTrack(data.rules2026, universityId, dept);
    const level = levelOf.get(`${universityId}::${row.dept}`) || '—';
    const conversion = engine.conversionTable(data.conv, universityId);
    const usesConv = String(track?.areas?.inq?.metric || '') === 'conv';
    const convKind = !usesConv ? 'none' : (conversion?.kind === 'official' ? 'official' : 'approx');
    const ctx = { std: data.std, conv: data.conv, universityId, year: row.year ?? null, total: row.score?.total ?? null };
    for (const point of ['p70', 'p50']) {
      let outcome;
      if (!track || !engine.trackHasFormula(track)) {
        outcome = { status: 'unchecked', reason: track ? '요강이 정규화 상수·배점을 밝히지 않음' : '산식 트랙 없음' };
      } else {
        outcome = checkPoint(engine, track, row.student?.[point], row.score?.[point], ctx);
      }
      counts[outcome.status] += 1;
      bump(byLevel, level, outcome.status);
      bump(byUniversity, universityId, outcome.status);
      byPoint.get(point)[outcome.status] += 1;
      if (outcome.status !== 'unchecked' && byConversion.has(convKind)) byConversion.get(convKind)[outcome.status] += 1;
      if (outcome.status === 'unchecked') {
        const key = outcome.reason || '사유 없음';
        reasons.set(key, (reasons.get(key) || 0) + 1);
      }
      if (outcome.status === 'mismatch') {
        const off = Number(outcome.off) || 0;
        const size = off <= 3 ? '≤3점' : off <= 10 ? '3~10점' : '>10점';
        const direction = isNumber(outcome.max) && outcome.target > outcome.max ? '공시값이 위'
          : isNumber(outcome.min) && outcome.target < outcome.min ? '공시값이 아래' : '방향 불명';
        const key = `${direction} · ${size}`;
        buckets.set(key, (buckets.get(key) || 0) + 1);
        const missKey = `${universityId}::${row.dept}`;
        if (!misses.has(missKey)) misses.set(missKey, { university: universityId, dept: row.dept, track: track?.name || null, level, count: 0, maxOff: 0, conv: convKind });
        const miss = misses.get(missKey);
        miss.count += 1;
        miss.maxOff = Math.max(miss.maxOff, off);
      }
    }
  }

  const shape = (map) => [...map].map(([key, value]) => ({
    key, ...value,
    comparable: value.match + value.mismatch,
    rate: rate(value.match, value.match + value.mismatch),
  }));
  return {
    rows: rows.length,
    points: counts.match + counts.mismatch + counts.unchecked,
    counts,
    comparable: counts.match + counts.mismatch,
    rate: rate(counts.match, counts.match + counts.mismatch),
    byLevel: shape(byLevel).sort((left, right) => right.comparable - left.comparable),
    byUniversity: shape(byUniversity).sort((left, right) => (left.rate ?? 101) - (right.rate ?? 101)),
    byPoint: shape(byPoint),
    byConversion: [...byConversion].map(([key, value]) => ({
      key, ...value, comparable: value.match + value.mismatch, rate: rate(value.match, value.match + value.mismatch),
    })),
    buckets: [...buckets].sort((left, right) => right[1] - left[1]),
    reasons: [...reasons].sort((left, right) => right[1] - left[1]),
    misses: [...misses.values()].sort((left, right) => (right.count - left.count) || (right.maxOff - left.maxOff)),
  };
}

// ---------------------------------------------------------------- B. 자기 위치
// 판정이 어긋난 사유를 자료 없음 / 자격 / 산식 불일치 / 되읽기 폭 / 반올림으로 가른다.
function selfCause(engine, result, entry) {
  if (!result) return `자료 없음 — ${entry.reason || '컷 없음'}`;
  if (result.status === 'blocked') return '자격 미충족(선택과목 미상)';
  if (result.status !== 'ok') return `자료 없음 — ${result.hold?.reason || result.status}`;
  if (result.level === 'L1') {
    const score70 = result.cut?.score70;
    const min = result.mineDetail?.min;
    const max = result.mineDetail?.max;
    const inside = isNumber(score70) && isNumber(min) && isNumber(max)
      && score70 >= min - REPRO_TOLERANCE && score70 <= max + REPRO_TOLERANCE;
    return inside ? '되읽기 폭 — 재현 구간은 맞고 중앙이 어긋남' : '산식 재현 불일치';
  }
  if (result.level === 'L2') return '지수 계산 불일치';
  if (result.level === 'L3') return '공시 평균백분위와 영역별 값의 반올림 차';
  return `층위 ${result.level}`;
}

// **구간 기준** — 어디가 70% 학생은 탐구 *과목*이 공개되지 않아 종류(사탐·과탐) 전체를 되읽는다.
// 그래서 이 검사에서만 되읽기 구간이 넓고, 구간의 **중앙**으로 판정하면 틀리는 곳이 생긴다.
// 실사용자는 과목을 넣으므로 폭이 좁다 — 검사가 사용자보다 불리한 조건으로 재는 셈이다.
// 구간 기준은 그 조건을 걷어낸다: 공시 환산점수가 재현 구간 `[min, max] ± 1` 안에 들고,
// 구간 하한·상한이 만드는 판정의 폭이 **소신**을 품으면 맞음으로 센다.
// L2·L3은 되읽기가 끼지 않는 눈금(지수·평균 백분위)이라 중앙 기준 그대로다.
export function selfRangeOk(result) {
  if (!result || result.status !== 'ok') return false;
  if (result.level !== 'L1') return isNumber(result.gap) && Math.abs(result.gap) <= SELF_ZERO;
  const score70 = result.cut?.score70;
  const low = result.mineDetail?.min;
  const high = result.mineDetail?.max;
  if (!isNumber(score70) || !isNumber(low) || !isNumber(high)) return false;
  if (score70 < low - REPRO_TOLERANCE || score70 > high + REPRO_TOLERANCE) return false;
  const gapMin = isNumber(result.gapDetail?.min) ? result.gapDetail.min : result.gap;
  const gapMax = isNumber(result.gapDetail?.max) ? result.gapDetail.max : result.gap;
  if (!isNumber(gapMin) || !isNumber(gapMax)) return false;
  // 소신 띠는 −0.7 이상 +0.7 미만이다(engine VERDICT_BANDS). 구간이 그 띠와 겹치면 된다.
  return Math.min(gapMin, gapMax) < SELF_BAND && Math.max(gapMin, gapMax) >= -SELF_BAND;
}

// L1 오답만 다시 가른다 — 되읽기 폭 / 기울기 불안정 / 산식 불일치 / 자격.
// 판정에 쓰는 국소 기울기는 `점수 차 ÷ 백분위 상당`으로 되돌려 잰다(engine 이 둘 다 돌려준다).
export function l1MissCause(result) {
  if (!result || result.status === 'blocked') return '자격 미충족(선택과목 미상)';
  const score70 = result.cut?.score70;
  const low = result.mineDetail?.min;
  const high = result.mineDetail?.max;
  const inside = isNumber(score70) && isNumber(low) && isNumber(high)
    && score70 >= low - REPRO_TOLERANCE && score70 <= high + REPRO_TOLERANCE;
  if (!inside) return '산식 불일치 — 재현 구간이 공시값을 못 담음';
  const width = isNumber(low) && isNumber(high) ? high - low : null;
  if (isNumber(width) && width > WIDE_READBACK) return `되읽기 폭 — 구간 ${WIDE_READBACK}점 초과(탐구 과목 미공시)`;
  const points = result.gapDetail?.points;
  const pctEq = result.gapDetail?.gap2026 ?? result.gapDetail?.pctEq;
  const slope = isNumber(points) && isNumber(pctEq) && Math.abs(pctEq) > 0.05 ? Math.abs(points / pctEq) : null;
  if (isNumber(slope) && slope < WEAK_SLOPE) return `기울기 불안정 — 국소 기울기 ${WEAK_SLOPE}점/백분위 미만`;
  return '좁은 구간인데 중앙이 어긋남';
}

export function auditSelfPlacement(engine, data) {
  const levels = { L1: 0, L2: 0, L3: 0, L0: 0 };
  const byLevel = new Map();
  const byUniversity = new Map();
  const causes = new Map();
  const causesByLevel = new Map();
  const l1Causes = new Map();
  const levelOf = new Map();
  const worst = [];
  let departments = 0;
  let judged = 0;
  let correct = 0;
  let rangeCorrect = 0;
  let inBand = 0;
  let order = 0;
  let orderKept = 0;
  const bump = (map, key) => {
    if (!map.has(key)) map.set(key, { judged: 0, correct: 0, rangeCorrect: 0, inBand: 0, order: 0, orderKept: 0, unjudged: 0 });
    return map.get(key);
  };

  for (const university of data.universities || []) {
    for (const dept of university.departments || []) {
      departments += 1;
      const entry = selfPlacement(engine, data, university, dept, 'p70');
      const result = entry.result;
      const level = result?.level || 'L0';
      levels[level] = (levels[level] || 0) + 1;
      levelOf.set(`${university.id}::${dept.name}`, result ? level : '—');
      const uniRow = bump(byUniversity, university.id);
      const levelRow = bump(byLevel, result && result.status === 'ok' ? level : '판정 없음');
      if (!result || result.status !== 'ok' || !isNumber(result.gap)) {
        levelRow.unjudged += 1;
        uniRow.unjudged += 1;
        const cause = selfCause(engine, result, entry);
        causes.set(cause, (causes.get(cause) || 0) + 1);
        const perLevel = causesByLevel.get(level) || new Map();
        perLevel.set(cause, (perLevel.get(cause) || 0) + 1);
        causesByLevel.set(level, perLevel);
        // L1 산식이 있는데 자격으로 막힌 자리도 L1 갈래에 남긴다(2-5).
        if (result && result.status === 'blocked' && isNumber(result.gapDetail?.points)) {
          const key = l1MissCause(result);
          l1Causes.set(key, (l1Causes.get(key) || 0) + 1);
        }
        continue;
      }
      judged += 1;
      levelRow.judged += 1;
      uniRow.judged += 1;
      const gap = result.gap;
      const ok = level === 'L1' ? Math.abs(gap) <= SELF_BAND : Math.abs(gap) <= SELF_ZERO;
      if (ok) { correct += 1; levelRow.correct += 1; uniRow.correct += 1; }
      if (selfRangeOk(result)) { rangeCorrect += 1; levelRow.rangeCorrect += 1; uniRow.rangeCorrect += 1; }
      if (result.band?.key === 'reach' || Math.abs(gap) <= SELF_BAND) { inBand += 1; levelRow.inBand += 1; uniRow.inBand += 1; }
      if (!ok) {
        const cause = selfCause(engine, result, entry);
        causes.set(cause, (causes.get(cause) || 0) + 1);
        const perLevel = causesByLevel.get(level) || new Map();
        perLevel.set(cause, (perLevel.get(cause) || 0) + 1);
        causesByLevel.set(level, perLevel);
        worst.push({ university: university.id, dept: dept.name, level, gap, cause });
        if (level === 'L1') {
          const key = l1MissCause(result);
          l1Causes.set(key, (l1Causes.get(key) || 0) + 1);
        }
      }
      // 50% 지점 학생은 환산점수 순으로 위에 선 학생이다 — 차이가 70% 학생보다 크거나 같아야 한다.
      const fifty = selfPlacement(engine, data, university, dept, 'p50');
      if (fifty.result && fifty.result.status === 'ok' && isNumber(fifty.result.gap)) {
        order += 1;
        levelRow.order += 1;
        uniRow.order += 1;
        if (fifty.result.gap >= gap - SELF_ZERO) { orderKept += 1; levelRow.orderKept += 1; uniRow.orderKept += 1; }
      }
    }
  }

  worst.sort((left, right) => Math.abs(right.gap) - Math.abs(left.gap));
  const shape = (map) => [...map].map(([key, value]) => ({
    key, ...value,
    rate: rate(value.correct, value.judged),
    rangeRate: rate(value.rangeCorrect, value.judged),
    bandRate: rate(value.inBand, value.judged),
    orderRate: rate(value.orderKept, value.order),
  }));
  return {
    departments, judged, correct, rangeCorrect, inBand,
    rate: rate(correct, judged),
    rangeRate: rate(rangeCorrect, judged),
    bandRate: rate(inBand, judged),
    order, orderKept, orderRate: rate(orderKept, order),
    levels,
    byLevel: shape(byLevel).sort((left, right) => String(left.key).localeCompare(String(right.key))),
    byUniversity: shape(byUniversity).sort((left, right) => (left.rate ?? 101) - (right.rate ?? 101)),
    causes: [...causes].sort((left, right) => right[1] - left[1]),
    l1Causes: [...l1Causes].sort((left, right) => right[1] - left[1]),
    causesByLevel: [...causesByLevel].map(([level, map]) => ({
      level, rows: [...map].sort((left, right) => right[1] - left[1]),
    })).sort((left, right) => String(left.level).localeCompare(String(right.level))),
    worst: worst.slice(0, 20),
    levelOf,
  };
}

// ---------------------------------------------------------------- C. 교차 검수
// 층위·계열·대학이 서로 다른 여섯 곳의 실제 70% 지점 학생. 이름으로 집는다.
export const CROSS_TARGETS = Object.freeze([
  { universityId: 'kookmin', dept: '자유전공(A)', note: 'MODEL §0 검산 행' },
  { universityId: 'yonsei', dept: '경영학과', note: '상위권 인문' },
  { universityId: 'soongsil', dept: '경영학부', note: '중위권 인문' },
  { universityId: 'kyonggi', dept: '경영학부', note: '백분위 컷 대학' },
  { universityId: 'pnu', dept: '경영학과', note: '거점 국립대 인문' },
  { universityId: 'khu', dept: '컴퓨터공학과', note: '자연 계열 과탐 학생' },
]);

// 옛 눈금(L3 계산 = 국·수·탐 평균 백분위 − 공시 70%컷)의 띠. L1 판정과 갈리는지 보는 데 쓴다.
function legacyBand(engine, data, profile, university, dept) {
  const reference = engine.jeongsiReference(dept, university.volatility ?? data.volatility);
  if (!reference?.primary) return null;
  const mine = engine.comparableScore(profile, reference.def || engine.COMPARE_BASIS);
  if (!mine) return null;
  const gap = engine.round(mine.value - reference.primary.value, engine.VERDICT_DIGITS);
  return { gap, band: engine.bandOf(gap, engine.VERDICT_BANDS) };
}

export function auditCross(engine, data) {
  const context = engine.layerContext(data);
  const bandLabels = engine.VERDICT_BANDS.map((band) => band.label);
  const sheets = [];
  for (const target of CROSS_TARGETS) {
    const university = (data.universities || []).find((one) => one.id === target.universityId);
    const dept = university?.departments.find((one) => one.name === target.dept) || null;
    if (!dept) { sheets.push({ ...target, missing: true }); continue; }
    const own = selfPlacement(engine, data, university, dept, 'p70');
    if (!own.profile) { sheets.push({ ...target, missing: true }); continue; }
    const student = own.student;

    // 전 모집단위 판정
    const rows = [];
    const levelBands = new Map();
    const crossTable = new Map();
    let l1Rows = 0;
    let l1Split = 0;
    for (const one of data.universities || []) {
      const rule = data.rules?.[one.id];
      for (const each of one.departments || []) {
        const result = engine.evaluateJeongsi(own.profile, one, each, rule, one.volatility ?? data.volatility, context);
        const label = result.status === 'ok' && result.band ? result.band.label : '없음';
        const key = result.status === 'ok' ? result.level : 'L0';
        if (!levelBands.has(key)) levelBands.set(key, new Map());
        const perLevel = levelBands.get(key);
        perLevel.set(label, (perLevel.get(label) || 0) + 1);
        if (result.status === 'ok' && isNumber(result.gap)) {
          rows.push({
            universityId: one.id, dept: each.name, level: result.level, gap: result.gap,
            band: result.band?.label ?? '없음',
            avg70: isNumber(result.cut?.avg70) ? result.cut.avg70 : (isNumber(each.jeongsi?.[result.cut?.year]?.cut70) ? each.jeongsi[result.cut.year].cut70 : null),
          });
        }
        // L1과 L3(평균 백분위)이 다른 띠를 낸 곳
        if (result.status === 'ok' && result.level === 'L1' && result.band) {
          const legacy = legacyBand(engine, data, own.profile, one, each);
          if (legacy?.band) {
            l1Rows += 1;
            if (legacy.band.label !== result.band.label) l1Split += 1;
            const cell = crossTable.get(result.band.label) || new Map();
            cell.set(legacy.band.label, (cell.get(legacy.band.label) || 0) + 1);
            crossTable.set(result.band.label, cell);
          }
        }
      }
    }

    // 자기 모집단위
    const ownResult = own.result;

    // 단조: 같은 대학 안에서 공시 평균백분위가 높은 모집단위일수록 차이가 작거나 같아야 한다.
    // 층위가 다르면 눈금도 다르다(L1 환산 · L2 지수 · L3 평균) — 같은 층위끼리만 본 수도 따로 센다.
    let pairs = 0;
    let violations = 0;
    let samePairs = 0;
    let sameViolations = 0;
    const byUniversity = new Map();
    for (const row of rows) {
      if (!isNumber(row.avg70)) continue;
      const list = byUniversity.get(row.universityId) || [];
      list.push(row);
      byUniversity.set(row.universityId, list);
    }
    const worstPairs = [];
    for (const [universityId, list] of byUniversity) {
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          const high = list[i].avg70 > list[j].avg70 ? list[i] : list[j];
          const low = high === list[i] ? list[j] : list[i];
          if (high.avg70 === low.avg70) continue;
          const same = high.level === low.level;
          pairs += 1;
          if (same) samePairs += 1;
          if (high.gap > low.gap + SELF_ZERO) {
            violations += 1;
            if (same) sameViolations += 1;
            worstPairs.push({ universityId, high, low, size: round(high.gap - low.gap, 2) });
          }
        }
      }
    }
    worstPairs.sort((left, right) => (right.size - left.size)
      || String(left.high.dept).localeCompare(String(right.high.dept)));

    sheets.push({
      ...target, missing: false,
      universityName: university.short || university.name,
      year: own.year,
      student: {
        kor: student.kor, math: student.math, eng: student.eng, hist: student.hist, avg: student.avg,
        inq: student.inq.map((row) => `${KIND_NAME[row.kind] || '탐구'} ${row.pct}`),
      },
      own: ownResult ? {
        level: ownResult.level, status: ownResult.status,
        band: ownResult.band?.label ?? '없음',
        gap: isNumber(ownResult.gap) ? ownResult.gap : null,
        points: isNumber(ownResult.gapDetail?.points) ? round(ownResult.gapDetail.points, 2) : null,
        score70: isNumber(ownResult.cut?.score70) ? ownResult.cut.score70 : null,
        mine: isNumber(ownResult.mineDetail?.score) ? round(ownResult.mineDetail.score, 2) : null,
        correct: ownResult.status === 'ok' && isNumber(ownResult.gap)
          && (ownResult.level === 'L1' ? Math.abs(ownResult.gap) <= SELF_BAND : Math.abs(ownResult.gap) <= SELF_ZERO),
      } : null,
      judged: rows.length,
      pairs, violations, violationRate: rate(violations, pairs),
      samePairs, sameViolations, sameViolationRate: rate(sameViolations, samePairs),
      worstPairs: worstPairs.slice(0, 1),
      l1Rows, l1Split, l1SplitRate: rate(l1Split, l1Rows),
      crossTable: [...crossTable].map(([l1, map]) => ({ l1, rows: [...map] })),
      levelBands: [...levelBands].map(([level, map]) => ({
        level, total: [...map.values()].reduce((sum, value) => sum + value, 0),
        bands: bandLabels.map((label) => ({ label, count: map.get(label) || 0 })),
        none: map.get('없음') || 0,
      })).sort((left, right) => String(left.level).localeCompare(String(right.level))),
    });
  }
  const usable = sheets.filter((sheet) => !sheet.missing);
  return {
    bandLabels,
    sheets,
    ownCorrect: usable.filter((sheet) => sheet.own?.correct).length,
    ownTotal: usable.length,
    pairs: usable.reduce((sum, sheet) => sum + sheet.pairs, 0),
    violations: usable.reduce((sum, sheet) => sum + sheet.violations, 0),
    violationRate: rate(
      usable.reduce((sum, sheet) => sum + sheet.violations, 0),
      usable.reduce((sum, sheet) => sum + sheet.pairs, 0),
    ),
    samePairs: usable.reduce((sum, sheet) => sum + sheet.samePairs, 0),
    sameViolations: usable.reduce((sum, sheet) => sum + sheet.sameViolations, 0),
    sameViolationRate: rate(
      usable.reduce((sum, sheet) => sum + sheet.sameViolations, 0),
      usable.reduce((sum, sheet) => sum + sheet.samePairs, 0),
    ),
  };
}

// ---------------------------------------------------------------- D. 흔들림
// 컷을 ±0.5·±1.0(백분위 상당) 옮겼을 때 띠 이름이 바뀌는 모집단위 비율 — 층위별.
// 여섯 벌(C)의 성적으로 재고, 판정이 선 모집단위만 분모다 (기존 ACCURACY §4와 같은 계산).
export const SHIFTS = Object.freeze([0.5, 1]);

export function auditWobble(engine, data, cross) {
  const context = engine.layerContext(data);
  const byLevel = new Map();
  const totals = { judged: 0, ...Object.fromEntries(SHIFTS.map((shift) => [shift, 0])) };
  for (const sheet of cross.sheets) {
    if (sheet.missing) continue;
    const university = data.universities.find((one) => one.id === sheet.universityId);
    const dept = university.departments.find((one) => one.name === sheet.dept);
    const own = selfPlacement(engine, data, university, dept, 'p70');
    if (!own.profile) continue;
    for (const one of data.universities || []) {
      const rule = data.rules?.[one.id];
      for (const each of one.departments || []) {
        const result = engine.evaluateJeongsi(own.profile, one, each, rule, one.volatility ?? data.volatility, context);
        if (result.status !== 'ok' || !isNumber(result.gap) || !result.estimateBand) continue;
        if (!byLevel.has(result.level)) byLevel.set(result.level, { judged: 0, ...Object.fromEntries(SHIFTS.map((shift) => [shift, 0])) });
        const row = byLevel.get(result.level);
        row.judged += 1;
        totals.judged += 1;
        for (const shift of SHIFTS) {
          const up = engine.bandOf(engine.round(result.gap - shift, engine.VERDICT_DIGITS), engine.VERDICT_BANDS);
          const down = engine.bandOf(engine.round(result.gap + shift, engine.VERDICT_DIGITS), engine.VERDICT_BANDS);
          if (up?.key !== result.estimateBand.key || down?.key !== result.estimateBand.key) {
            row[shift] += 1;
            totals[shift] += 1;
          }
        }
      }
    }
  }
  return {
    profiles: cross.sheets.filter((sheet) => !sheet.missing).length,
    totals: { ...totals, rates: Object.fromEntries(SHIFTS.map((shift) => [shift, rate(totals[shift], totals.judged)])) },
    byLevel: [...byLevel].map(([level, row]) => ({
      level, judged: row.judged,
      shifts: SHIFTS.map((shift) => ({ shift, changed: row[shift], rate: rate(row[shift], row.judged) })),
    })).sort((left, right) => String(left.level).localeCompare(String(right.level))),
  };
}

// ---------------------------------------------------------------- 조립
export function buildAudit(engine = loadBrowser('assets/engine.js', 'IPSI_ENGINE'), data = loadBrowser('assets/data.js', 'IPSI_DATA')) {
  const self = auditSelfPlacement(engine, data);
  const reproduction = auditReproduction(engine, data, self.levelOf);
  const cross = auditCross(engine, data);
  const wobble = auditWobble(engine, data, cross);
  const { levelOf, ...selfOut } = self;
  return {
    generatedAt: data.generatedAt,
    universities: (data.universities || []).length,
    departments: (data.universities || []).reduce((sum, one) => sum + one.departments.length, 0),
    // 표는 대학 id 대신 화면과 같은 짧은 이름으로 적는다.
    names: (data.universities || []).map((one) => [one.id, one.short || one.name]),
    reproduction, self: selfOut, cross, wobble,
  };
}

// ---------------------------------------------------------------- 보고서
const cell = (value) => (value === null || value === undefined ? '—' : String(value));
const pct = (value) => (value === null || value === undefined ? '—' : `${Number(value).toFixed(1)}%`);
const gapCell = (value) => (isNumber(value) ? value.toFixed(1) : '—');

export function renderMarkdown(audit) {
  const lines = [];
  const { reproduction: repro, self, cross, wobble } = audit;
  const names = new Map(audit.names || []);
  const uni = (id) => names.get(id) || id;
  const levelRow = (key) => self.byLevel.find((one) => one.key === key) || null;
  const levelRate = (key) => {
    const row = levelRow(key);
    return row ? pct(row.rate) : '—';
  };
  // 중앙 기준 / 구간 기준을 한 칸에 나란히.
  const levelBoth = (key) => {
    const row = levelRow(key);
    return row ? `${pct(row.rate)}·${pct(row.rangeRate)}` : '—';
  };

  lines.push('# 정확도 전수검사 — 재현·자기 위치·교차 검수·흔들림');
  lines.push('');
  lines.push('이 문서의 숫자는 모두 `scripts/accuracy-audit.mjs`가 `source/adiga/*`·`assets/data.js`·');
  lines.push('`assets/engine.js`(화면과 같은 파일)에서 세어 만든다(`npm run accuracy`). 손으로 고치지 않는다.');
  lines.push('');
  lines.push('**실제 합격 여부 자료는 없다.** 그래서 여기서 재는 정확도는 "우리 계산이 공시값을 되살리는가"와');
  lines.push('"공시된 그 학생을 그 자리에 놓는가"이지, 합격 확률이 아니다. 확률 숫자는 어디에도 만들지 않는다.');
  lines.push('');
  lines.push(`생성일 ${cell(audit.generatedAt)} · 대학 ${audit.universities}곳 · 모집단위 ${audit.departments}곳 · 어디가 행 ${repro.rows}개`);
  lines.push('');
  lines.push('## 한 줄 요약');
  lines.push('');
  lines.push(`> 재현 A: ${repro.counts.match}/${repro.comparable} (${pct(repro.rate)}) · `
    + `자기 위치 B (중앙 기준·구간 기준): L1 ${levelBoth('L1')} · L2 ${levelBoth('L2')} · L3 ${levelBoth('L3')} · `
    + `교차 검수 C: ${cross.ownTotal}벌 중 자기 모집단위 소신 ${cross.ownCorrect}/${cross.ownTotal}, 단조 위반 ${pct(cross.violationRate)}`);
  lines.push('');
  lines.push('| 지표 | 분모 | 맞음 | 비율 |');
  lines.push('|---|---:|---:|---:|');
  lines.push(`| A 재현 (지점) | ${repro.comparable} | ${repro.counts.match} | ${pct(repro.rate)} |`);
  lines.push(`| B 자기 위치 · 중앙 기준 (모집단위) | ${self.judged} | ${self.correct} | ${pct(self.rate)} |`);
  lines.push(`| B 자기 위치 · 구간 기준 (모집단위) | ${self.judged} | ${self.rangeCorrect} | ${pct(self.rangeRate)} |`);
  lines.push(`| B 순서 보존 (50% ≥ 70%) | ${self.order} | ${self.orderKept} | ${pct(self.orderRate)} |`);
  lines.push(`| C 자기 모집단위 (여섯 벌) | ${cross.ownTotal} | ${cross.ownCorrect} | ${pct(rate(cross.ownCorrect, cross.ownTotal))} |`);
  lines.push(`| C 단조 (같은 대학 안 짝) | ${cross.pairs} | ${cross.pairs - cross.violations} | ${pct(rate(cross.pairs - cross.violations, cross.pairs))} |`);
  lines.push(`| C 단조 (같은 층위끼리만) | ${cross.samePairs} | ${cross.samePairs - cross.sameViolations} | ${pct(rate(cross.samePairs - cross.sameViolations, cross.samePairs))} |`);
  lines.push('');
  lines.push('100%가 아닌 이유를 갈래로 나눈 표는 2-3에 있다.');
  lines.push('');

  // ------------------------------------------------------------- A
  lines.push('## 1. A 재현 — 공시 환산점수를 되살리는가');
  lines.push('');
  lines.push('어디가 행 전부의 70%·50% 두 지점마다, 그 학생의 영역별 백분위를 §1.3으로 표준점수 **구간**으로');
  lines.push(`되읽어 §1.2 산식에 넣는다. 공시 환산점수가 그 구간 ±${REPRO_TOLERANCE.toFixed(1)}점 안이면 match다.`);
  lines.push('');
  lines.push('| 결과 | 지점 | 비율(대조 가능분) |');
  lines.push('|---|---:|---:|');
  lines.push(`| match | ${repro.counts.match} | ${pct(repro.rate)} |`);
  lines.push(`| mismatch | ${repro.counts.mismatch} | ${pct(rate(repro.counts.mismatch, repro.comparable))} |`);
  lines.push(`| unchecked (대조 불가) | ${repro.counts.unchecked} | — |`);
  lines.push(`| 전체 지점 | ${repro.points} | — |`);
  lines.push('');
  lines.push('### 1-1. 지점별 · 층위별');
  lines.push('');
  lines.push('| 갈래 | 대조 가능 | match | mismatch | 비율 |');
  lines.push('|---|---:|---:|---:|---:|');
  for (const row of repro.byPoint) {
    lines.push(`| ${row.key === 'p70' ? '70% 지점' : '50% 지점'} | ${row.comparable} | ${row.match} | ${row.mismatch} | ${pct(row.rate)} |`);
  }
  for (const row of repro.byLevel) {
    lines.push(`| 층위 ${row.key} | ${row.comparable} | ${row.match} | ${row.mismatch} | ${pct(row.rate)} |`);
  }
  lines.push('');
  lines.push('층위는 그 행의 모집단위가 **지금 어느 층위로 판정되는가**다(`—`는 그 이름으로 판정되는');
  lines.push('모집단위가 없는 행 — 통합·분리·이름 변경으로 빌드가 다른 이름에 실은 행이다).');
  lines.push('');
  lines.push('### 1-2. 어긋난 크기와 방향');
  lines.push('');
  lines.push('| 벗어난 크기 · 방향 | 지점 |');
  lines.push('|---|---:|');
  for (const [key, count] of repro.buckets) lines.push(`| ${key} | ${count} |`);
  lines.push('');
  lines.push('### 1-3. 변환표준점수 표가 근사인가');
  lines.push('');
  lines.push('| 탐구 변환표 | 대조 가능 | match | 비율 |');
  lines.push('|---|---:|---:|---:|');
  for (const row of repro.byConversion) {
    const label = row.key === 'official' ? '대학 공개 원표' : row.key === 'approx' ? '통합 도수분포 근사표' : '변환표를 쓰지 않는 산식';
    lines.push(`| ${label} | ${row.comparable} | ${row.match} | ${pct(row.rate)} |`);
  }
  lines.push('');
  lines.push('### 1-4. 대조하지 못한 사유');
  lines.push('');
  lines.push('| 사유 | 지점 |');
  lines.push('|---|---:|');
  for (const [key, count] of repro.reasons.slice(0, 12)) lines.push(`| ${key} | ${count} |`);
  lines.push('');
  lines.push('### 1-5. 재현이 가장 많이 어긋난 모집단위 15곳');
  lines.push('');
  lines.push('| 대학 | 모집단위 | 산식 트랙 | 층위 | 탐구 변환표 | 어긋난 지점 | 최대 벗어남(점) |');
  lines.push('|---|---|---|---|---|---:|---:|');
  for (const row of repro.misses.slice(0, 15)) {
    lines.push(`| ${uni(row.university)} | ${row.dept} | ${cell(row.track)} | ${row.level} | ${CONV_LABEL[row.conv] || row.conv} | ${row.count} | ${row.maxOff} |`);
  }
  lines.push('');
  lines.push('### 1-6. 대학별 재현율 (낮은 순 20곳)');
  lines.push('');
  lines.push('| 대학 | 대조 가능 | match | 비율 | 대조 불가 |');
  lines.push('|---|---:|---:|---:|---:|');
  for (const row of repro.byUniversity.filter((one) => one.comparable > 0).slice(0, 20)) {
    lines.push(`| ${uni(row.key)} | ${row.comparable} | ${row.match} | ${pct(row.rate)} | ${row.unchecked} |`);
  }
  lines.push('');

  // ------------------------------------------------------------- B
  lines.push('## 2. B 자기 위치 — 그 학생을 그 자리에 놓는가');
  lines.push('');
  lines.push('모집단위마다 그 모집단위의 **70% 지점 학생 성적표**를 사용자 입력 형식으로 넣고');
  lines.push('(`normalizeProfile` → `evaluateJeongsi`) 바로 그 모집단위를 판정한다. 탐구는 어디가가');
  lines.push('종류(사탐·과탐)만 공시하므로 종류로 넣고, 국어·수학 선택과목은 공시되지 않아 기본값이라');
  lines.push('미적분·기하 가산은 붙지 않는다.');
  lines.push('');
  lines.push('판정이 맞았는지는 **두 기준**으로 잰다.');
  lines.push('');
  lines.push(`- **중앙 기준** — L1은 백분위 상당 차이가 소신 폭(±${SELF_BAND}) 안, L2·L3는 차이가 0(±${SELF_ZERO})이면 맞음.`);
  lines.push(`- **구간 기준** — L1은 공시 환산점수가 재현 구간 \`[min, max] ± ${REPRO_TOLERANCE.toFixed(1)}\` 안에 들고,`);
  lines.push('  구간 하한·상한이 만드는 판정의 폭이 **소신**을 품으면 맞음. L2·L3는 중앙 기준 그대로다.');
  lines.push('');
  lines.push('두 기준이 갈리는 까닭은 이 검사에만 있는 조건이다. 어디가는 70% 학생의 탐구 **과목**을');
  lines.push('공개하지 않아 종류(사탐·과탐) 전체를 되읽어야 하고, 그래서 되읽기 구간이 넓다. 실사용자는');
  lines.push('과목을 넣으므로 그 폭이 좁다 — 중앙 기준은 사용자보다 불리한 조건으로 재는 셈이고,');
  lines.push('구간 기준은 그 조건을 걷어낸 값이다. 실제 정확도는 두 값 사이에 있다.');
  lines.push('');
  lines.push('| 층위 | 판정 | 맞음(중앙) | 중앙 기준 % | 맞음(구간) | 구간 기준 % | 소신 띠 | 순서 보존(50%≥70%) |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const row of self.byLevel) {
    if (row.key === '판정 없음') continue;
    lines.push(`| ${row.key} | ${row.judged} | ${row.correct} | ${pct(row.rate)} | ${row.rangeCorrect} | ${pct(row.rangeRate)} | ${pct(row.bandRate)} | ${row.orderKept}/${row.order} (${pct(row.orderRate)}) |`);
  }
  lines.push(`| 전체 | ${self.judged} | ${self.correct} | ${pct(self.rate)} | ${self.rangeCorrect} | ${pct(self.rangeRate)} | ${pct(self.bandRate)} | ${self.orderKept}/${self.order} (${pct(self.orderRate)}) |`);
  lines.push('');
  lines.push('**순서 보존**은 50% 지점 학생의 차이가 70% 지점 학생보다 크거나 같은가다. 두 지점은');
  lines.push('**환산점수 순**으로 뽑은 학생이라(MODEL §0) 환산 눈금인 L1에서만 순서가 보장된다 —');
  lines.push('L2·L3의 눈금(지수·평균 백분위)에서는 50%가 70%보다 낮은 것이 오류가 아니다.');
  lines.push('');
  lines.push(`판정이 서지 않은 모집단위 ${self.departments - self.judged}곳(층위 분포 `
    + `L1 ${self.levels.L1} · L2 ${self.levels.L2} · L3 ${self.levels.L3} · L0 ${self.levels.L0})은 아래 2-3의 사유로 빠진다.`);
  lines.push('');
  lines.push('### 2-1. 층위별 사유 — 왜 100%가 아닌가');
  lines.push('');
  for (const row of self.causesByLevel) {
    lines.push(`- **${row.level}** — ${row.rows.slice(0, 4).map(([key, count]) => `${key} ${count}`).join(' · ')}`);
  }
  lines.push('');
  lines.push('### 2-2. 대학별 자기 위치 정확도 (낮은 순 20곳)');
  lines.push('');
  lines.push('| 대학 | 판정 | 맞음 | 비율 | 판정 없음 |');
  lines.push('|---|---:|---:|---:|---:|');
  for (const row of self.byUniversity.filter((one) => one.judged > 0).slice(0, 20)) {
    lines.push(`| ${uni(row.key)} | ${row.judged} | ${row.correct} | ${pct(row.rate)} | ${row.unjudged} |`);
  }
  lines.push('');
  lines.push('### 2-3. 100%가 아닌 이유');
  lines.push('');
  lines.push('| 갈래 | 모집단위 |');
  lines.push('|---|---:|');
  for (const [key, count] of self.causes) lines.push(`| ${key} | ${count} |`);
  lines.push('');
  lines.push('- **자료 없음** — 컷·영역별 값·집계 방식이 없어 판정 자체가 서지 않는다.');
  lines.push('- **자격 미충족** — 선택과목이 공시되지 않아 확률과통계로 넣었고, 미적분·기하를 요구하는 모집단위에서 걸린다.');
  lines.push('- **되읽기 폭** — 재현 구간(A)은 공시값을 담는데 구간의 **중앙**이 어긋난 곳이다. A는 통과하고 B는 틀린다.');
  lines.push('- **산식 재현 불일치** — 구간 자체가 공시값을 담지 못한다(A도 mismatch).');
  lines.push('- **반올림 차** — L3의 컷은 공시된 정수 평균백분위이고 내 값은 영역별 값으로 다시 계산한 평균이라 ±0.6 안에서 어긋난다.');
  lines.push('');
  lines.push('### 2-4. L1 오답을 다시 가른다');
  lines.push('');
  lines.push('위 갈래는 층위를 가리지 않는다. L1의 중앙 기준 오답만 따로 네 갈래로 다시 센다.');
  lines.push('');
  lines.push('| 갈래 | 모집단위 |');
  lines.push('|---|---:|');
  for (const [key, count] of self.l1Causes) lines.push(`| ${key} | ${count} |`);
  lines.push('');
  lines.push(`- **되읽기 폭** — 재현 구간이 ${WIDE_READBACK}점보다 넓다. 탐구 과목이 공시되지 않아 종류 전체를`);
  lines.push('  되읽은 결과이고, 과목을 넣는 실사용자에게는 생기지 않는 폭이다(구간 기준이 걷어내는 갈래).');
  lines.push('- **기울기 불안정** — 국소 기울기가 아직 1점/백분위에 못 미치는 자리다. 대칭 차분(MODEL §3)으로');
  lines.push(`  ${WEAK_SLOPE}점/백분위 아래로는 잘 내려가지 않지만, 남은 자리는 여기에 모인다.`);
  lines.push('- **산식 불일치** — 재현 구간 자체가 공시값을 못 담는다(A도 mismatch). 산식·계수를 다시 읽어야 한다.');
  lines.push('- **자격** — 선택과목이 공시되지 않아 확률과통계로 넣었고 미적분·기하를 요구하는 곳에서 걸린 자리다.');
  lines.push('- **좁은 구간인데 중앙이 어긋남** — 위 넷이 아닌 나머지. 되읽기 표의 계단 자리다.');
  lines.push('');
  lines.push('### 2-5. 가장 크게 어긋난 모집단위 20곳');
  lines.push('');
  lines.push('| 대학 | 모집단위 | 층위 | 차이(백분위 상당) | 갈래 |');
  lines.push('|---|---|---|---:|---|');
  for (const row of self.worst) {
    lines.push(`| ${uni(row.university)} | ${row.dept} | ${row.level} | ${gapCell(row.gap)} | ${row.cause} |`);
  }
  lines.push('');

  // ------------------------------------------------------------- C
  lines.push('## 3. C 교차 검수 — 여섯 벌을 전 모집단위에');
  lines.push('');
  lines.push('층위·계열·대학이 서로 다른 여섯 곳의 **실제 70% 지점 학생 성적표**를 그대로 넣어');
  lines.push(`${audit.departments}곳을 전부 판정한다.`);
  lines.push('');
  lines.push('| # | 대학 | 모집단위 | 학년도 | 국어 | 수학 | 탐구 | 영어 | 한국사 | 평균 |');
  lines.push('|---:|---|---|---:|---:|---:|---|---:|---:|---:|');
  cross.sheets.forEach((sheet, index) => {
    if (sheet.missing) { lines.push(`| ${index + 1} | ${sheet.universityId} | ${sheet.dept} | — | — | — | — | — | — | — |`); return; }
    lines.push(`| ${index + 1} | ${sheet.universityName} | ${sheet.dept} | ${cell(sheet.year)} | ${cell(sheet.student.kor)} | ${cell(sheet.student.math)} | ${sheet.student.inq.join(' · ')} | ${cell(sheet.student.eng)} | ${cell(sheet.student.hist)} | ${cell(sheet.student.avg)} |`);
  });
  lines.push('');
  lines.push('### 3-1. 자기 모집단위 판정');
  lines.push('');
  lines.push('| 대학 | 모집단위 | 층위 | 판정 | 차이(백분위 상당) | 점수 차 | 내 환산 | 공시 70% |');
  lines.push('|---|---|---|---|---:|---:|---:|---:|');
  for (const sheet of cross.sheets) {
    if (sheet.missing || !sheet.own) { lines.push(`| ${sheet.universityId} | ${sheet.dept} | — | — | — | — | — | — |`); continue; }
    lines.push(`| ${sheet.universityName} | ${sheet.dept} | ${sheet.own.level} | ${sheet.own.band} | ${gapCell(sheet.own.gap)} | ${cell(sheet.own.points)} | ${cell(sheet.own.mine)} | ${cell(sheet.own.score70)} |`);
  }
  lines.push('');
  lines.push(`여섯 벌 가운데 자기 모집단위가 제자리(L1은 소신 폭, L2·L3은 차이 0)로 나온 것은 ${cross.ownCorrect}/${cross.ownTotal}이다.`);
  lines.push('');
  lines.push('### 3-2. 단조 — 같은 대학 안에서 컷이 높은 곳일수록 차이가 작은가');
  lines.push('');
  lines.push('같은 대학 안에서 공시 평균백분위 70%가 서로 다른 모집단위 두 곳을 짝지어,');
  lines.push('컷이 높은 쪽의 차이가 낮은 쪽보다 크면 위반이다. 층위가 다르면 눈금도 다르므로');
  lines.push('(L1 환산 · L2 지수 · L3 평균) **같은 층위끼리만** 본 수를 따로 적는다.');
  lines.push('');
  lines.push('| 대학 | 모집단위 | 판정한 곳 | 짝 | 위반 | 비율 | 같은 층위 짝 | 위반 | 비율 |');
  lines.push('|---|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const sheet of cross.sheets) {
    if (sheet.missing) continue;
    lines.push(`| ${sheet.universityName} | ${sheet.dept} | ${sheet.judged} | ${sheet.pairs} | ${sheet.violations} | ${pct(sheet.violationRate)}`
      + ` | ${sheet.samePairs} | ${sheet.sameViolations} | ${pct(sheet.sameViolationRate)} |`);
  }
  lines.push(`| **합계** | | | ${cross.pairs} | ${cross.violations} | ${pct(cross.violationRate)}`
    + ` | ${cross.samePairs} | ${cross.sameViolations} | ${pct(cross.sameViolationRate)} |`);
  lines.push('');
  lines.push('가장 크게 뒤집힌 짝:');
  lines.push('');
  for (const sheet of cross.sheets) {
    if (sheet.missing || sheet.worstPairs.length === 0) continue;
    const worst = sheet.worstPairs[0];
    lines.push(`- ${sheet.universityName} ${sheet.dept} → ${uni(worst.universityId)} `
      + `${worst.high.dept}(컷 ${worst.high.avg70} · 차이 ${gapCell(worst.high.gap)} · ${worst.high.level}) vs `
      + `${worst.low.dept}(컷 ${worst.low.avg70} · 차이 ${gapCell(worst.low.gap)} · ${worst.low.level}) — ${worst.size}`);
  }
  lines.push('');
  lines.push('### 3-3. L1 판정과 평균 백분위(L3 계산)가 갈린 곳');
  lines.push('');
  lines.push('| 대학 | 모집단위 | L1으로 판정한 곳 | 띠가 다름 | 비율 |');
  lines.push('|---|---|---:|---:|---:|');
  for (const sheet of cross.sheets) {
    if (sheet.missing) continue;
    lines.push(`| ${sheet.universityName} | ${sheet.dept} | ${sheet.l1Rows} | ${sheet.l1Split} | ${pct(sheet.l1SplitRate)} |`);
  }
  lines.push('');
  lines.push('교차표(행 = L1 판정, 열 = 평균 백분위 판정):');
  lines.push('');
  for (const sheet of cross.sheets) {
    if (sheet.missing || sheet.crossTable.length === 0) continue;
    lines.push(`**${sheet.universityName} ${sheet.dept}**`);
    lines.push('');
    lines.push(`| L1＼평균 | ${cross.bandLabels.join(' | ')} |`);
    lines.push(`|---|${cross.bandLabels.map(() => '---:').join('|')}|`);
    for (const label of cross.bandLabels) {
      const row = sheet.crossTable.find((one) => one.l1 === label);
      const map = new Map(row?.rows || []);
      lines.push(`| ${label} | ${cross.bandLabels.map((one) => map.get(one) || 0).join(' | ')} |`);
    }
    lines.push('');
  }
  lines.push('### 3-4. 층위별 띠 분포');
  lines.push('');
  for (const sheet of cross.sheets) {
    if (sheet.missing) continue;
    lines.push(`**${sheet.universityName} ${sheet.dept}**`);
    lines.push('');
    lines.push(`| 층위 | ${cross.bandLabels.join(' | ')} | 없음 | 합계 |`);
    lines.push(`|---|${cross.bandLabels.map(() => '---:').join('|')}|---:|---:|`);
    for (const row of sheet.levelBands) {
      lines.push(`| ${row.level} | ${row.bands.map((one) => one.count).join(' | ')} | ${row.none} | ${row.total} |`);
    }
    lines.push('');
  }

  // ------------------------------------------------------------- D
  lines.push('## 4. D 흔들림 — 컷이 움직이면 판정도 움직이나');
  lines.push('');
  lines.push(`위 ${wobble.profiles}벌의 성적으로, 컷을 ±0.5 · ±1.0(백분위 상당) 옮겼을 때 띠 이름이 바뀌는 모집단위를 센다.`);
  lines.push('');
  lines.push('| 층위 | 판정한 곳 | ±0.5에서 바뀜 | ±1.0에서 바뀜 |');
  lines.push('|---|---:|---:|---:|');
  for (const row of wobble.byLevel) {
    const half = row.shifts.find((one) => one.shift === 0.5);
    const full = row.shifts.find((shift) => shift.shift === 1);
    lines.push(`| ${row.level} | ${row.judged} | ${half.changed} (${pct(half.rate)}) | ${full.changed} (${pct(full.rate)}) |`);
  }
  lines.push(`| 전체 | ${wobble.totals.judged} | ${wobble.totals[0.5]} (${pct(wobble.totals.rates[0.5])}) | ${wobble.totals[1]} (${pct(wobble.totals.rates[1])}) |`);
  lines.push('');
  lines.push('층위마다 불확실성 폭이 다르다(L1 ±0.5 · L2 ±1.0 · L3 ±2.0, MODEL §3). 위 표는 그 폭 안에서');
  lines.push('띠 이름이 얼마나 쉽게 바뀌는지를 값으로 적은 것이다 — 띠는 경계에서 늘 흔들린다.');
  lines.push('');
  return lines.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(ROOT, 'scripts/accuracy-audit.mjs')) {
  const audit = buildAudit();
  writeFileSync(OUTPUT, `${renderMarkdown(audit)}\n`, 'utf8');
  console.log(`wrote ${path.relative(ROOT, OUTPUT)}: A ${audit.reproduction.counts.match}/${audit.reproduction.comparable}`
    + ` (${audit.reproduction.rate}%) · B ${audit.self.correct}/${audit.self.judged} (${audit.self.rate}%)`
    + ` · C ${audit.cross.ownCorrect}/${audit.cross.ownTotal}`);
}
