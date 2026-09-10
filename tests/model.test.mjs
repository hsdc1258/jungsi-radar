// 판정 모델 v3 (docs/MODEL.md) 계약 테스트 — §8의 여덟 항목.
// 데이터 파일(source/adiga/*)이 아직 없어도 도는 픽스처 테스트다. 실제 값은 MODEL §0 원문이다.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { checkPoint, verdictOf } from '../scripts/verify-formulas.mjs';
import { classifyAnomaly, errorReasons } from '../scripts/anomalies.mjs';

const ROOT = process.cwd();
const load = (file, name) => {
  const context = { globalThis: null };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
  return context[name];
};
const engine = load('assets/engine.js', 'IPSI_ENGINE');
const readJson = (file) => JSON.parse(readFileSync(path.join(ROOT, file), 'utf8'));
const STD = readJson('source/std-2026.json');
const CONV = readJson('source/conv-2026.json');
const RULES = readJson('source/rules-2026.base.json');

const KOOKMIN = { id: 'kookmin', short: '국민대', name: '국민대학교' };
// 검산이 끝났다고 보고 L1을 켠다 — 실제 파일(source/formula-check.json)은 입결이 들어오면 채워진다.
const CHECK = {
  tracks: {
    'kookmin::자유전공(A)': { status: 'verified' },
    'kookmin::자유전공(B)': { status: 'verified' },
    'kookmin::미래융합전공(C)': { status: 'verified' },
  },
};
const context = (over = {}) => ({ std: STD, conv: CONV, rules2026: RULES, formulaCheck: CHECK, ...over });

// MODEL §0 — 어디가 2026 국민대 자유전공(A) 행의 두 지점 학생.
const STUDENT_70 = { kor: 97, math: 69, inq1: { kind: '사탐', pct: 86 }, inq2: { kind: '사탐', pct: 52 }, avg: 78, eng: 2, hist: 1 };
const STUDENT_50 = { kor: 98, math: 76, inq1: { kind: '과탐', pct: 77 }, inq2: { kind: '사탐', pct: 62 }, avg: 81, eng: 3, hist: 2 };

const trackOf = (name) => engine.pickModelTrack(RULES, 'kookmin', { name, track: '자유전공' });
const ctxOf = () => ({ std: STD, conv: CONV, universityId: 'kookmin' });

const profileOf = (over) => engine.normalizeProfile({
  mode: 'pct', eng: 2, hist: 1, mathElective: '확률과통계',
  inq1Subject: '생활과윤리', inq2Subject: '사회문화', ...over,
}, null, STD);

// 세 프로필 — 평균 백분위는 사실상 같은데 영역 분포가 다르다 (§8-2).
const KOR_STRONG = profileOf({ kor: 97, math: 69, inq1: 86, inq2: 52 });
const MATH_STRONG = profileOf({ kor: 69, math: 97, inq1: 86, inq2: 52 });
const BALANCED = profileOf({ kor: 78, math: 78, inq1: 78, inq2: 79 });

// 모집단위 픽스처. 컷 환산점수는 그 트랙으로 채점한 70% 학생 값이다(같은 눈금에서 뺀다).
function deptOf(name, trackName, over = {}) {
  const track = trackOf(name);
  const cut70 = engine.formulaScore2(track, engine.studentFormulaInputs(engine.normalizeCutStudent(STUDENT_70), STD), ctxOf());
  const cut50 = engine.formulaScore2(track, engine.studentFormulaInputs(engine.normalizeCutStudent(STUDENT_50), STD), ctxOf());
  return {
    name, track: '자유전공', ruleTrack: null,
    jeongsi: {
      2026: {
        metric: 'pct', cut70: 78, cut50: 81, group: '가', quota: 20, rate: 5.1, fill: 4,
        typeName: '수능(일반)', source: '어디가 2026 입시결과', url: 'https://www.adiga.kr/',
        aggregation: 'adiga-score-rank',
        score: { p70: cut70.value, p50: cut50.value, total: 1000 },
        student: { p70: STUDENT_70, p50: STUDENT_50 },
        ...over,
      },
    },
    series: [{ year: '2026', value: 78, def: 'ksi-mean', kind: '70%컷', basis: 'adiga' }],
    ...(over.deptOver || {}),
  };
}

const DEPT_A = deptOf('자유전공학부(A)');
const DEPT_B = deptOf('자유전공학부(B)');
const DEPT_C = deptOf('미래융합대학(C)');

const judge = (profile, dept, over = {}) => engine.evaluateJeongsi(profile, KOOKMIN, dept, null, 1, context(over));

// ---------------------------------------------------------------- §8-1
test('§8-1 국민대 자유전공(A) 2026 — 70%·50% 지점 학생을 산식으로 재현한다', () => {
  const track = trackOf('자유전공학부(A)');
  assert.equal(track.name, '자유전공(A)');
  const seventy = checkPoint(engine, track, STUDENT_70, 659.0, ctxOf());
  assert.equal(seventy.status, 'match');
  assert.equal(seventy.min, 656.0, '국어 135·사탐 62 조합의 하한');
  assert.equal(seventy.max, 659.0, '국어 136·사탐 63 조합의 상한');
  const fifty = checkPoint(engine, track, STUDENT_50, 660.5, ctxOf());
  assert.equal(fifty.status, 'match');
  assert.ok(fifty.min <= 660.5 && 660.5 <= fifty.max, `${fifty.min}~${fifty.max}`);
  // §1.4 트랙 판정 — 두 행 모두 match 면 verified.
  assert.equal(verdictOf({ match: 2, mismatch: 0, unchecked: 0 }), 'verified');
  assert.equal(verdictOf({ match: 9, mismatch: 1, unchecked: 0 }), 'verified');
  assert.equal(verdictOf({ match: 8, mismatch: 2, unchecked: 0 }), 'mismatch');
  assert.equal(verdictOf({ match: 0, mismatch: 0, unchecked: 4 }), 'unchecked');
});

// ---------------------------------------------------------------- §8-2
test('§8-2 평균 백분위가 같은 세 프로필이 세 모집단위에서 다른 순서로 판정된다', () => {
  const avg = [KOR_STRONG, MATH_STRONG, BALANCED].map((profile) => engine.simpleAverage(profile));
  assert.ok(Math.max(...avg) - Math.min(...avg) <= 0.2, `평균 백분위가 갈린다: ${avg.join(' / ')}`);

  // 대학이 실제로 줄 세우는 눈금 — 그 대학 산식으로 채점한 환산점수다.
  const order = (dept) => [['국어강점', KOR_STRONG], ['수학강점', MATH_STRONG], ['균형', BALANCED]]
    .map(([label, profile]) => ({ label, score: judge(profile, dept).model.mine.score }))
    .sort((left, right) => right.score - left.score)
    .map((row) => row.label);

  const a = order(DEPT_A);
  const b = order(DEPT_B);
  const c = order(DEPT_C);
  // 같은 평균 백분위인데 모집단위마다 순서가 다르다 — 평균 백분위로는 이 셋을 가를 수 없다.
  assert.notDeepEqual(a, b, `(A)와 (B)의 순서가 같다: ${a.join(' > ')}`);
  assert.notDeepEqual(b, c, `(B)와 (C)의 순서가 같다: ${b.join(' > ')}`);
  // 2026 수능은 국어의 표준점수 폭이 수학보다 넓어, 수400인 (B)에서도 국어강점이 앞선다 —
  // 배점만 보고 짐작하지 않고 산식과 그해 분포로 계산했다는 뜻이다.
  assert.equal(a[0], '국어강점', a.join(' > '));
  assert.equal(b[0], '국어강점', b.join(' > '));
  // 수학을 아예 반영하지 않는 (C)에서는 수학강점이 꼴찌다. 수400인 (B)에서는 아니다.
  assert.equal(c.at(-1), '수학강점', c.join(' > '));
  assert.notEqual(b.at(-1), '수학강점', b.join(' > '));
  // 균형 프로필의 자리는 모집단위마다 다르다.
  assert.notEqual(a.indexOf('균형'), b.indexOf('균형'));
  // 판정 층위는 환산점수(L1)다 — 평균 백분위가 아니다.
  assert.equal(judge(KOR_STRONG, DEPT_A).level, 'L1');
  assert.equal(judge(KOR_STRONG, DEPT_A).model.mine.unit, 'points');
});

// ---------------------------------------------------------------- §8-3
test('§8-3 영어 2→3등급과 한국사 5등급이 산식대로 반영된다', () => {
  const track = trackOf('자유전공학부(A)');
  const inputs = (over) => engine.myFormulaInputs(profileOf({ kor: 97, math: 69, inq1: 86, inq2: 52, ...over }), STD, {});
  const at = (over) => engine.formulaScore2(track, inputs(over), ctxOf()).value;
  // 영어 배점 98 → 95, 반영점수 100 → (98−95) × 2 × 100 × 1000 ÷ 200000 = 3.0점.
  assert.equal(engine.round(at({ eng: 2 }) - at({ eng: 3 }), 4), 3.0);
  // 한국사 5등급은 총점에서 0.2점을 뺀다(1~4등급은 0).
  assert.equal(engine.round(at({ hist: 1 }) - at({ hist: 5 }), 4), 0.2);
  assert.equal(at({ hist: 4 }), at({ hist: 1 }));
  // 비율반영 대학은 영어 배점 비율만큼 지수가 움직인다 — 40·30·10·20에서 (98−95)×10/100 = 0.3.
  const weights = engine.ratioWeights({
    weights: { kor: 40, math: 30, eng: 10, inq: 20 },
    english: { method: '비율반영', table: { 1: 100, 2: 98, 3: 95 } },
    inquiry: { count: 2 },
  });
  const index = (grade) => engine.ratioIndex({ kor: 97, math: 69, inq: 69, eng: grade === 2 ? 98 : 95 }, weights).value;
  assert.equal(engine.round(index(2) - index(3), 2), 0.3);
});

// ---------------------------------------------------------------- §8-4
test('§8-4 반올림은 roundTo 자리에서 하고, 판정은 반올림 뒤 값으로 낸다', () => {
  const track = trackOf('자유전공학부(A)');
  assert.equal(track.roundTo, 1);
  const scored = engine.formulaScore2(track, engine.myFormulaInputs(KOR_STRONG, STD, {}), ctxOf());
  for (const value of [scored.value, scored.min, scored.max]) {
    assert.equal(Math.round(value * 10) / 10, value, `${value} 가 roundTo 1 자리가 아니다`);
  }
  // 연세대는 소수 넷째 자리다 — 트랙마다 자리수가 다르다.
  assert.equal(engine.pickModelTrack(RULES, 'yonsei', { track: '인문' }).roundTo, 4);
  // 판정 띠는 반올림한 차이 하나에서 나온다.
  const result = judge(KOR_STRONG, DEPT_A);
  assert.equal(engine.round(result.gap, 1), result.gap);
  assert.equal(result.band.key, engine.bandOf(result.gap, engine.VERDICT_BANDS).key);
  assert.equal(result.band.note, '70% 지점 대비');
});

// ---------------------------------------------------------------- §8-5
test('§8-5 2027 산식이 2026과 다르면 basisChanged 와 두 판정이 함께 나온다', () => {
  const base = trackOf('자유전공학부(A)');
  // 2027 시행계획이 국·수 배점을 맞바꾼 대학. 같은 성적이라도 순서가 뒤집힌다.
  const rules2027 = {
    year: 2027,
    status: 'plan',
    universities: {
      kookmin: {
        id: 'kookmin',
        year: 2027,
        status: 'plan',
        tracks: [{
          ...base,
          name: '자유전공(A)',
          year: 2027,
          status: 'plan',
          areas: { ...base.areas, kor: { metric: 'std', factor: 300 }, math: { metric: 'std', factor: 400 } },
        }],
      },
    },
  };
  // 국어가 세고 수학이 약한 성적 — 국400인 2026에서는 적정, 수400인 2027에서는 소신이다.
  const tilted = profileOf({ kor: 99, math: 67, inq1: 86, inq2: 52 });
  const result = judge(tilted, DEPT_A, { rules2027 });
  assert.equal(result.level, 'L1');
  assert.equal(result.basisChanged, true, `2026 ${result.gapDetail.gap2026} / 2027 ${result.gapDetail.gap2027}`);
  assert.ok(Number.isFinite(result.gapDetail.gap2026));
  assert.ok(Number.isFinite(result.gapDetail.gap2027));
  assert.notEqual(result.gapDetail.gap2026, result.gapDetail.gap2027);
  assert.equal(result.gap, result.gapDetail.gap2027, '판정은 지원 학년도(2027) 산식으로 낸다');
  assert.ok(result.cut2027 && Number.isFinite(result.cut2027.score));
  assert.equal(result.cut2027.status, 'plan');
  assert.ok(result.flags.includes('plan-formula'), result.flags.join(','));
});

// ---------------------------------------------------------------- §8-6
test('§8-6 평균백분위 50% < 70% 는 오류가 아니고, 환산 50% < 70% 는 오류다', () => {
  const row = (over) => ({ id: 'kookmin', name: '미래융합대학(C)', track: '자유전공', practical: false, value: 78, cut50: 68, series: [], ...over });
  assert.deepEqual(errorReasons(row()), []);
  assert.equal(classifyAnomaly(row()), 'undetermined');
  assert.equal(classifyAnomaly(row({ score70: 659, score50: 655 })), 'error');
});

// ---------------------------------------------------------------- §8-7
test('§8-7 등급 입력의 하단·중앙·상단 세 점과 민감도가 단조롭다', () => {
  const graded = engine.normalizeProfile({
    mode: 'grade', kor: 1, math: 3, eng: 2, hist: 1,
    inq1Subject: '생활과윤리', inq1: 2, inq2Subject: '사회문화', inq2: 3,
  }, null, STD);
  const result = judge(graded, DEPT_A);
  assert.equal(result.level, 'L1');
  const { min, max, score } = result.model.mine;
  assert.ok(min <= score && score <= max, `${min} ≤ ${score} ≤ ${max}`);
  assert.ok(max > min, '등급 구간이 한 점으로 눌렸다');
  assert.ok(result.gapRange.min <= result.gap && result.gap <= result.gapRange.max);
  // 민감도는 배점이 가장 큰 영역 하나의 하단→상단 폭이다.
  assert.ok(result.sensitivity, '민감도가 없다');
  assert.equal(result.sensitivity.area, 'kor', '국400이 가장 큰 배점이다');
  assert.ok(result.sensitivity.deltaPoints > 0);
  assert.ok(result.sensitivity.deltaPctEq > 0);
  assert.equal(result.sensitivity.deltaPoints, engine.round(max - min, 2));
  assert.equal(result.estimated, true);
  assert.ok(result.flags.includes('estimated'), result.flags.join(','));
});

// ---------------------------------------------------------------- §8-8
test("§8-8 aggregation 'unknown' 행은 정밀 판정(L1·L2)으로 올라가지 않는다", () => {
  const unknown = deptOf('자유전공학부(A)', null, { aggregation: 'unknown' });
  const result = judge(KOR_STRONG, unknown);
  assert.notEqual(result.level, 'L1');
  assert.notEqual(result.level, 'L2');
  assert.equal(result.level, 'L3', '백분위 컷이 있으므로 참고 판정까지는 간다');
  assert.equal(result.model.mine.unit, 'pct');
  // 같은 행이라도 집계 방식이 어디가 정의면 L1로 올라간다.
  assert.equal(judge(KOR_STRONG, DEPT_A).level, 'L1');
});

// ---------------------------------------------------------------- 층위 폴백
test('산식·검산이 없으면 L3로 내려가고, 컷도 없으면 L0다', () => {
  assert.equal(judge(KOR_STRONG, DEPT_A, { rules2026: null, formulaCheck: null }).level, 'L3');
  // 검산이 verified 가 아닌 트랙은 L1에 쓰지 않는다.
  assert.equal(judge(KOR_STRONG, DEPT_A, { formulaCheck: { tracks: { 'kookmin::자유전공(A)': { status: 'mismatch' } } } }).level, 'L3');
  // 컷 자체가 없으면 L0.
  const empty = { name: '없는학과', track: '인문', jeongsi: {}, series: [] };
  assert.equal(engine.evaluateJeongsi(KOR_STRONG, KOOKMIN, empty, null, 1, context()).level, 'L0');
});

// ---------------------------------------------------------------- §1.3
test('§1.3 백분위 → 표준점수는 표에 있는 값만 쓴다', () => {
  const kor = engine.stdRangeFromPercentile(STD, '국어', 97);
  assert.deepEqual([kor.min, kor.max], [135, 136]);
  assert.equal(kor.exact, true);
  assert.equal(kor.interpolated, false);
  const math = engine.stdRangeFromPercentile(STD, '수학', 69);
  assert.deepEqual([math.min, math.max], [116, 116]);
  // 과목을 모르면 그 종류의 전 과목에서 최소~최대를 잡는다.
  const social = engine.stdRangeFromPercentile(STD, 'social', 86);
  assert.deepEqual([social.min, social.max], [62, 63]);
  assert.ok(social.subjects.length > 1, social.subjects.join(','));
  // 과목을 알면 그 과목만.
  const one = engine.stdRangeFromPercentile(STD, '탐구-생활과윤리', 86);
  assert.deepEqual(one.subjects, ['탐구-생활과윤리']);
  assert.ok(one.min >= social.min && one.max <= social.max);
  // 표에 없는 백분위는 이웃으로 넓히고 그 사실을 남긴다.
  const gap = engine.stdRangeFromPercentile(STD, '탐구-생활과윤리', 100);
  assert.ok(gap === null || gap.exact === true || gap.interpolated === true);
  assert.equal(engine.stdRangeFromPercentile(STD, '탐구-없는과목', 50), null);
});

// ---------------------------------------------------------------- §7 계약
test('§7 결과 객체가 계약대로이고 옛 필드도 그대로 남는다', () => {
  const result = judge(KOR_STRONG, DEPT_A);
  // §7 계약
  for (const key of ['level', 'status', 'apply', 'mine', 'cut', 'gap', 'band', 'areas', 'sensitivity', 'history', 'flags', 'sources']) {
    assert.ok(key in result.model, `model.${key} 가 없다`);
  }
  assert.equal(result.model.apply.year, 2027);
  assert.equal(result.model.apply.formula.track, '자유전공(A)');
  assert.equal(result.model.cut.aggregation, 'adiga-score-rank');
  assert.equal(result.model.cut.verified, true);
  assert.ok(Number.isFinite(result.model.gap.points), '환산점수 차(점)가 없다');
  assert.ok(result.model.areas.length > 0, '유리·불리 영역이 비었다');
  assert.ok(result.flags.includes('year-bridge'), result.flags.join(','));
  assert.equal(result.model.mine.assumptions.length, 1, '학년도 브리지 가정이 적혀 있지 않다');
  // 옛 계약 — app.js 가 쓰는 필드들. mine − cut.value = gap 이 유지된다.
  for (const key of ['status', 'gap', 'band', 'cut', 'mine', 'estimated', 'bounds', 'group', 'floor', 'fill', 'cut50', 'reference', 'score', 'index', 'def', 'defLabel']) {
    assert.ok(key in result, `옛 필드 ${key} 가 사라졌다`);
  }
  assert.equal(typeof result.gap, 'number');
  assert.equal(typeof result.mine, 'number');
  assert.equal(engine.round(result.mine - result.cut.value, 1), result.gap);
  assert.equal(result.group, '가');
  assert.equal(result.cut50, 81);
  // 실제 환산점수 컷은 그대로 남는다.
  assert.ok(Number.isFinite(result.cut.score70));
  assert.ok(Number.isFinite(result.cut.score50));
});

// ---------------------------------------------------------------- L2
test('L2 — 산식이 없으면 같은 반영비율로 만든 가중 지수를 뺀다', () => {
  const rules2027 = {
    universities: {
      kookmin: {
        id: 'kookmin',
        tracks: [{
          name: '인문', appliesTo: ['인문', '자유전공'], unit: 'percent',
          weights: { kor: 40, math: 30, eng: 10, inq: 20 },
          english: { method: '비율반영', table: { 1: 100, 2: 98, 3: 95, 4: 90, 5: 85, 6: 80, 7: 75, 8: 70, 9: 0 } },
          inquiry: { count: 2 },
        }],
      },
    },
  };
  const result = judge(KOR_STRONG, DEPT_A, { rules2026: null, formulaCheck: null, rules2027 });
  assert.equal(result.level, 'L2');
  assert.equal(result.model.mine.unit, 'pct');
  assert.equal(result.uncertainty, 1);
  // 내 성적과 70% 학생 성적이 같으므로 차이는 0이다.
  assert.equal(result.gap, 0);
  assert.equal(result.band.key, 'reach');
  assert.ok(result.areas.length > 0);
  // 평균백분위가 영역별 값과 어긋나는 행(consistent=false)은 L2로 올라가지 않는다.
  const broken = deptOf('자유전공학부(A)', null, { student: { p70: { ...STUDENT_70, avg: 60 } } });
  assert.equal(judge(KOR_STRONG, broken, { rules2026: null, formulaCheck: null, rules2027 }).level, 'L3');
});

// ---------------------------------------------------------------- §3 안정 문턱
test('안정은 50% 지점도 넘어야 한다 — 70%컷은 보장선이 아니다', () => {
  const strong = profileOf({ kor: 99, math: 71, inq1: 88, inq2: 54 });
  const high = deptOf('자유전공학부(A)');
  const result = judge(strong, high);
  // 70% 지점은 크게 넘었지만 50% 지점을 넘지 못하면 '안정'이 '적정'으로 내려간다.
  if (result.estimateBand.key === 'safe' && result.model.cut.score50 > result.model.mine.score) {
    assert.equal(result.band.key, 'fit');
  }
  assert.ok(['safe', 'fit', 'reach', 'stretch', 'risky'].includes(result.band.key));
});
