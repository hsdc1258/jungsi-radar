// 판정 모델 v3 (docs/MODEL.md) 계약 테스트 — §8의 여덟 항목.
// 데이터 파일(source/adiga/*)이 아직 없어도 도는 픽스처 테스트다. 실제 값은 MODEL §0 원문이다.
import assert from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { bonusHeadroom, checkPoint, deptOf as adigaDeptOf, verdictOf } from '../scripts/verify-formulas.mjs';
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
  // 산식 자체가 없으면 비율도 못 만든다 — L3.
  assert.equal(judge(KOR_STRONG, DEPT_A, { rules2026: null, formulaCheck: null }).level, 'L3');
  // 검산이 verified 가 아닌 트랙은 L1에 쓰지 않는다. 다만 §3 비율 조건의 폴백으로
  // 컷 학년도 산식 계수를 비율로 쓸 수 있으면 L2까지는 간다.
  const fell = judge(KOR_STRONG, DEPT_A, { formulaCheck: { tracks: { 'kookmin::자유전공(A)': { status: 'mismatch' } } } });
  assert.equal(fell.level, 'L2');
  assert.ok(fell.model.flags.includes('ratio-from-2026'), '어느 비율을 썼는지 깃발로 남긴다');
  assert.equal(fell.model.apply.formula.ratioBasis, 'ratio-from-2026');
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

// ================================================================ §1.2 확장 필드
// 2026 정시모집요강이 스스로 실은 **성적 산출 예시**를 그대로 재현한다. 여기 값들은 우리가
// 만든 것이 아니라 대학이 요강에 인쇄한 숫자라, 산식 채점기가 확장 필드(denominator·base·
// bonus.of·eng/hist mode·pickBest·optional·offset·div·cap·roundMode)를 제대로 소비하는지
// 가리는 유일한 잣대다. 입력값은 _seed/rules-2026/<id>.txt 의 요강 원문 표에서 옮겼다.
const RULES_ALL = readJson('source/rules-2026.json');
const trackIn = (universityId, name) => {
  const found = (RULES_ALL.universities[universityId]?.tracks || []).find((row) => row.name === name);
  assert.ok(found, `${universityId}/${name} 트랙이 없다`);
  return { ...found, universityId };
};
// pickBest 형제 트랙 — pickModelTrack 이 붙여 주는 모양 그대로 만든다.
const siblingsIn = (universityId, names) => {
  const family = names.map((name) => trackIn(universityId, name));
  return { ...family[0], siblings: family };
};
const spanOf = (row) => ({ std: row.std ?? null, pct: row.pct ?? null, conv: row.conv ?? null });
const inputsOf = (row) => ({
  kor: spanOf(row.kor || {}),
  math: spanOf(row.math || {}),
  inq: (row.inq || []).map((one) => ({ ...spanOf(one), kind: one.kind ?? null, subject: one.subject ?? null })),
  eng: { grade: row.eng ?? null },
  hist: { grade: row.hist ?? null },
  mathElective: row.mathElective || null,
});
const scoreOf = (track, row, stdOverride = null) => engine.formulaScore2(track, inputsOf(row), {
  std: stdOverride || STD, conv: CONV, universityId: track.universityId,
});
// 전남대 예시는 요강이 지어낸 성적표라 전국 최고 표준점수도 그 표(139·140·77·69 …)를 쓴다.
const maxima = (pairs) => ({ subjects: Object.fromEntries(Object.entries(pairs).map(([key, maxStd]) => [key, { maxStd }])) });

test('요강 산출 예시 — 항공대(pickBest · 탐구 1과목 best · hist 가산은 scale 뒤)', () => {
  const 홍길동 = { kor: { std: 130 }, math: { std: 123 }, eng: 2, hist: 1, inq: [{ std: 64, kind: 'social', subject: '한국지리' }, { std: 60, kind: 'science', subject: '지구과학Ⅰ' }] };
  const 고길동 = { kor: { std: 134 }, math: { std: 131 }, eng: 2, hist: 2, inq: [{ std: 65, kind: 'science', subject: '화학Ⅰ' }, { std: 58, kind: 'science', subject: '지구과학Ⅰ' }] };
  // 요강 p.58 「국어(130x20%) + 수학(123x35%) + 영어(134x20%) + 탐구(64x25%) = 111.85 → ×5 + 10 = 569.25」
  const gong = scoreOf(trackIn('kau', '공학적성(공과·AI융합·스마트드론·AI자율주행·자유전공 공학)'), 홍길동);
  assert.equal(gong.value, 569.25);
  // 탐구는 2과목을 넣어도 상위 1과목(64)만 반영한다.
  assert.equal(gong.parts.find((row) => row.area === 'inq').input, 64);
  // 한국사 10점은 ×5 **뒤** 총점에 붙는다 — 안에 들었다면 50점이 된다.
  assert.equal(gong.parts.find((row) => row.area === 'hist').points, 10);

  const family = siblingsIn('kau', ['이학·사회적성 산출1', '이학·사회적성 산출2']);
  const sa = scoreOf(family, 홍길동);
  assert.equal(sa.value, 572.75, '산출1(112.20)보다 높은 산출2(112.55)를 써야 한다');
  assert.equal(sa.picked.track, '이학·사회적성 산출2');
  assert.deepEqual(sa.picked.from.map((row) => row.value), [571.00, 572.75]);
  assert.equal(scoreOf(family, 고길동).value, 590.00);
});

test('요강 산출 예시 — 충남대(영어·한국사 감점 · 과탐 과목별 10% 가산)', () => {
  const track = trackIn('cnu', '자연계');
  // 요강 p.52 「[{116×75 + 123×135 + (63+68)×90} ÷ 200] − 5 − 1 = 179.475」
  const 사탐 = { kor: { std: 116 }, math: { std: 123 }, eng: 3, hist: 4, inq: [{ std: 68, kind: 'social', subject: '지구과학Ⅱ' }, { std: 63, kind: 'social', subject: '화학Ⅰ' }] };
  assert.equal(scoreOf(track, 사탐).value, 179.475);
  // 같은 성적을 과탐으로 응시하면 과목별 표준점수에 10%가 붙어 185.37이다.
  const 과탐 = { ...사탐, inq: 사탐.inq.map((row) => ({ ...row, kind: 'science' })) };
  assert.equal(scoreOf(track, 과탐).value, 185.37);
  // 영어는 배점이 아니라 감점(mode:'penalty')이라 배점 몫이 0이고 총점에서 5점을 뺀다.
  assert.equal(scoreOf(track, { ...사탐, eng: 1 }).value - scoreOf(track, 사탐).value, 5);
});

test('요강 산출 예시 — 중앙대(변환표준점수 · 탐구 종류별 가산)', () => {
  const conv = (value, kind, subject) => ({ conv: value, kind, subject });
  const base = { kor: { std: 134 }, math: { std: 136 }, eng: 2, hist: 5 };
  // ① 영어영문학과: 사탐 변환표준점수에만 5% — {(65.34×1.05)+67.24}×0.35×5 = 237.73225
  assert.equal(scoreOf(trackIn('cau', '인문·예체능(인문대·사범대·공연영상·디자인)'), {
    ...base, inq: [conv(65.34, 'social', '사회·문화'), conv(67.24, 'science', '화학Ⅰ')],
  }).value, 783.832);
  // ② 경영학부: 가산 없는 트랙
  assert.equal(scoreOf(trackIn('cau', '인문(사회과학·경영경제·간호 인문)'), {
    ...base, inq: [conv(65.34, 'social', '사회·문화'), conv(67.24, 'social', '생활과윤리')],
  }).value, 779.47);
  // ③ 기계공학부: 두 과목 모두 과탐이라 합에 5%
  assert.equal(scoreOf(trackIn('cau', '자연'), {
    ...base, inq: [conv(65.34, 'science', '화학Ⅰ'), conv(67.24, 'science', '물리학Ⅰ')],
  }).value, 790.216);
});

test('요강 산출 예시 — 전북대(탐구 변환표준점수 평균 ×1.5 · 영어·한국사 가산)', () => {
  // 요강 p.29 인문 「5 + 104 + 75 + 24 + 83.61525 = 291.62」
  assert.equal(scoreOf(trackIn('jbnu', '인문·생활과학·환경생명자원·융합자율전공'), {
    kor: { std: 104 }, math: { std: 100 }, eng: 3, hist: 2,
    inq: [{ conv: 57.1675, kind: 'social', subject: '사회·문화' }, { conv: 54.3205, kind: 'social', subject: '생활과윤리' }],
  }).value, 291.62);
  // 자연 「4 + 68.25 + 104 + 27 + 94.990575 = 298.24」 — 요강 표의 변환표준점수는 과탐 10% 가산 뒤 값이다.
  assert.equal(scoreOf(trackIn('jbnu', '자연·농업생명과학'), {
    kor: { std: 91 }, math: { std: 104 }, eng: 2, hist: 6,
    inq: [{ conv: 67.75785 / 1.1, kind: 'science', subject: '생명과학Ⅰ' }, { conv: 58.89625 / 1.1, kind: 'science', subject: '화학Ⅰ' }],
  }).value, 298.24);
});

test('요강 산출 예시 — 홍익대(탐구 2과목 표준점수 합 · 영어 환산점수 ×15%)', () => {
  // 요강 p.86 「(133×0.30 + 128×0.30 + 128×0.25 + 100×0.15) + 9.9 = 135.2」
  assert.equal(scoreOf(trackIn('hongik', '인문계열·캠퍼스자율전공(인문·예능)'), {
    kor: { std: 133 }, math: { std: 128 }, eng: 1, hist: 4,
    inq: [{ std: 64, kind: 'social', subject: '윤리와사상' }, { std: 64, kind: 'social', subject: '세계사' }],
  }).value, 135.2);
});

test('요강 산출 예시 — 전남대(전국 최고 표준점수로 나누는 denominator)', () => {
  const 인문 = scoreOf(trackIn('jnu', '인문·인문/자연'), {
    kor: { std: 128 }, math: { std: 128 }, eng: 2, hist: 1,
    inq: [{ std: 62, kind: 'social', subject: '생활과윤리' }, { std: 63, kind: 'social', subject: '사회·문화' }],
  }, maxima({ 국어: 139, 수학: 140, '탐구-생활과윤리': 77, '탐구-사회·문화': 69 }));
  assert.equal(인문.value, 920.293, '요강 p.15 인문계열 산출 예시');
  const 자연 = scoreOf(trackIn('jnu', '자연'), {
    kor: { std: 127 }, math: { std: 125 }, eng: 1, hist: 2,
    inq: [{ std: 59, kind: 'science', subject: '화학Ⅰ' }, { std: 65, kind: 'science', subject: '생명과학Ⅰ' }],
  }, maxima({ 국어: 139, 수학: 140, '탐구-화학Ⅰ': 65, '탐구-생명과학Ⅰ': 70 }));
  // 요강 자연계열 예시는 935.346이다. 우리 값은 935.347 — 요강이 영역마다 1단계 변환점수를
  // 열째 자리, 비율 적용점수를 넷째 자리에서 **절사**하는데(요강 산출방법 1·2) 그 중간 절사가
  // 트랙 JSON에 담겨 있지 않다. 차이는 0.001점이고 §1.4 허용폭(±1.0) 안이다.
  assert.equal(자연.value, 935.347);
  assert.ok(Math.abs(자연.value - 935.346) <= 0.005, `요강 935.346과 ${자연.value}`);
});

test('요강 산출 예시 — 부산대(div · 다섯째 자리 절사)와 서강대(영어·한국사 가산)', () => {
  // 부산대 요강 「134×300÷200 + 118×250÷200 + (63.8252+63.4311)×250÷200 + 200 + 10 = 717.5703」
  assert.equal(scoreOf(trackIn('pnu', '인문'), {
    kor: { std: 134 }, math: { std: 118 }, eng: 1, hist: 1,
    inq: [{ conv: 63.8252, kind: 'social', subject: '사회·문화' }, { conv: 63.4311, kind: 'social', subject: '생활과윤리' }],
  }).value, 717.5703);
  // 서강대 요강 「128×1.1 + 135×1.3 + (64.3+67.4)×0.6 + 99.5 + 10 = 504.82」
  assert.equal(scoreOf(trackIn('sogang', '전 계열(A형)'), {
    kor: { std: 128 }, math: { std: 135 }, eng: 2, hist: 1,
    inq: [{ conv: 67.4, kind: 'social', subject: '사회·문화' }, { conv: 64.3, kind: 'social', subject: '생활과윤리' }],
  }).value, 504.82);
});

test('§1.2 확장 필드 — base·optional·pctToTotal·hist mode·채점 불가 트랙', () => {
  // 충북대: 영역별 기본점수 + (표준점수 ÷ 전국 최고) × 실질반영점수. 만점이면 300 + 200 + …
  const cbnu = trackIn('cbnu', '인문');
  assert.equal(cbnu.areas.kor.base, 240);
  const top = scoreOf(cbnu, {
    kor: { std: STD.subjects.국어.maxStd }, math: { std: STD.subjects.수학.maxStd }, eng: 1, hist: 1,
    inq: [{ std: 70, kind: 'social', subject: '생활과윤리' }, { std: 70, kind: 'social', subject: '사회·문화' }],
  });
  const korPart = top.parts.find((row) => row.area === 'kor');
  assert.equal(korPart.points, 300, '전국 최고 표준점수면 기본 240 + 실질 60 = 300');
  assert.equal(top.parts.find((row) => row.area === 'eng').points, 200, '영어 기본 160 + 등급점수 10 × 4');
  // 한국사를 계산에 넣지 않는 대학(mode:'none')은 등급이 몇이든 총점이 같다.
  const same = (grade) => scoreOf(cbnu, { kor: { std: 130 }, math: { std: 120 }, eng: 2, hist: grade, inq: [{ std: 62, kind: 'social', subject: '생활과윤리' }, { std: 63, kind: 'social', subject: '사회·문화' }] }).value;
  assert.equal(same(1), same(9));

  // 홍익대 미술계열: 국·수·탐 중 상위 2개 영역만 각 40%(optional top2).
  const art = trackIn('hongik', '미술계열');
  const scored = scoreOf(art, {
    kor: { std: 130 }, math: { std: 100 }, eng: 2, hist: 1,
    inq: [{ std: 65, kind: 'social', subject: '생활과윤리' }, { std: 64, kind: 'social', subject: '사회·문화' }],
  });
  const dropped = scored.parts.filter((row) => row.excluded);
  assert.equal(dropped.length, 1, '셋 중 하나는 빠져야 한다');
  assert.equal(dropped[0].area, 'math', '가장 낮은 수학(100)이 빠진다');

  // 숭실대: 탐구 백분위의 2.5%를 총점에 더하는 가산(of:'pctToTotal').
  const ss = trackIn('soongsil', '인문');
  const withBonus = scoreOf(ss, { kor: { std: 130 }, math: { std: 120 }, eng: 2, hist: 1, inq: [{ pct: 96, kind: 'social', subject: '생활과윤리' }, { pct: 92, kind: 'social', subject: '사회·문화' }] });
  const without = scoreOf(ss, { kor: { std: 130 }, math: { std: 120 }, eng: 2, hist: 1, inq: [{ pct: 96, kind: 'science', subject: '화학Ⅰ' }, { pct: 92, kind: 'science', subject: '물리학Ⅰ' }] });
  // 숭실대 총점은 정수 자리에서 반올림하므로(roundTo 0) 두 값의 차는 4.7 ± 반올림 한 칸이다.
  assert.ok(Math.abs((withBonus.value - without.value) - (96 + 92) * 0.025) <= 1, `${without.value} → ${withBonus.value}`);
  assert.ok(withBonus.flags.includes('approx-conversion'), '변환표 근사는 flags 에 남는다');

  // 성균관대·한양대는 요강이 정규화 상수를 밝히지 않는다(factor·scale null) — 채점하지 않는다.
  for (const [id, name] of [['skku', '가군 인문(A/B)'], ['hanyang', '자연계']]) {
    const track = trackIn(id, name);
    assert.equal(engine.trackHasFormula(track), false, `${id}/${name} 는 L1에 쓰면 안 된다`);
    assert.equal(scoreOf(track, { kor: { std: 130 }, math: { std: 130 }, eng: 1, hist: 1, inq: [{ pct: 95, kind: 'social', subject: '생활과윤리' }, { pct: 95, kind: 'social', subject: '사회·문화' }] }), null);
  }
  // 반대로 영어가 감점만 하는 대학(고려·경희·서울대)은 영어 배점이 없어도 채점된다.
  for (const [id, name] of [['korea', '인문'], ['khu', '인문'], ['snu', '인문']]) {
    assert.equal(engine.trackHasFormula(trackIn(id, name)), true, `${id}/${name}`);
  }
});

test('§1.4 검산 — 어디가 행이 산식을 못 채우면 mismatch 가 아니라 unchecked 다', () => {
  const track = trackIn('hongik', '인문계열·캠퍼스자율전공(인문·예능)');
  const ctxHongik = { std: STD, conv: CONV, universityId: 'hongik' };
  // 탐구 2과목 산식인데 어디가 행에 탐구1만 있는 경우(홍익대 경영학부 실제 행).
  const oneSubject = { kor: 78, math: 91, inq1: { kind: '사탐', pct: 97 }, inq2: null, avg: 89, hist: 1, eng: 2 };
  const thin = checkPoint(engine, track, oneSubject, 130.9, ctxHongik);
  assert.equal(thin.status, 'unchecked');
  assert.match(thin.reason, /탐구 2과목/u);
  // 반영총점(700)과 어디가 총점(710)의 차이가 한국사 가산폭 안이면 그것만으로 mismatch 로 보지 않는다.
  assert.equal(bonusHeadroom(trackIn('hufs', '서울 인문(상경·사회·경영)')), 10);
  assert.equal(bonusHeadroom(trackIn('kookmin', '자유전공(A)')), 0, '감점 방식 한국사는 총점을 늘리지 않는다');
  // 계열은 빌드와 같은 규칙으로 정한다 — 어디가 행에는 계열이 없다.
  assert.deepEqual(adigaDeptOf('hongik', '경영학부'), { name: '경영학부', track: '인문', ruleTrack: '상경' });
  assert.equal(adigaDeptOf('cau', '기계공학부').track, '자연');
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

// ---------------------------------------------------------------- §3 L2 비율 조건 · FRAME §10.4 눈금
// 여기서부터는 생성물(assets/data.js)의 실제 43개 대학·1978 모집단위를 그대로 쓴다.
const DATA_FILE = 'assets/data.js';
const hasData = existsSync(path.join(ROOT, DATA_FILE));
const dataOnce = hasData ? load(DATA_FILE, 'IPSI_DATA') : null;
const profileFromData = (scores) => engine.normalizeProfile({
  mode: 'pct', eng: '2', hist: '1', korElective: '화법과작문', mathElective: '확률과통계',
  inq1Subject: '생활과윤리', inq2Subject: '사회문화', ...scores,
}, dataOnce.scales, dataOnce.std);

test('컷·내·차이는 언제나 같은 눈금이다 — round(mine − cut.value, 1) === gap', { skip: !hasData && 'data.js not generated' }, () => {
  const data = dataOnce;
  const cases = [
    { kor: '97', math: '69', inq1: '86', inq2: '52' },
    { kor: '96', math: '93', inq1: '95', inq2: '92' },
    { kor: '78', math: '78', inq1: '78', inq2: '79' },
  ];
  let checked = 0;
  for (const scores of cases) {
    const profile = profileFromData(scores);
    for (const row of engine.diagnose(profile, data)) {
      const result = row.jeongsi;
      if (typeof result.gap !== 'number' || typeof result.mine !== 'number' || typeof result.cut?.value !== 'number') continue;
      checked += 1;
      assert.equal(
        engine.round(result.mine - result.cut.value, 1), result.gap,
        `${row.universityId} ${row.dept?.name ?? ''} (${result.level}): 컷 ${result.cut.value} · 내 ${result.mine} · 차이 ${result.gap}`,
      );
    }
  }
  assert.ok(checked > 1000, `눈금을 잰 모집단위가 너무 적다 (${checked})`);
});

test('§3 L2 비율 조건 — 탐구 하나로만 매긴 지수는 판정이 아니다 (서강대 경영학부)', { skip: !hasData && 'data.js not generated' }, () => {
  const data = dataOnce;
  // 서강대 2027 시행계획 `전 계열` 비율은 {국 0 · 수 0 · 영 0 · 탐 20}이다 — 그 비율로는 지수를 못 만든다.
  const plan = (data.rules?.sogang?.tracks || []).find((track) => track.name === '전 계열');
  assert.ok(plan, '서강대 2027 트랙이 있어야 한다');
  assert.equal(engine.ratioWeights(plan), null, '국·수·탐이 다 양수가 아니면 비율로 쓰지 않는다');
  // 폴백은 컷 학년도(2026) 산식 트랙의 영역 계수다.
  const track2026 = engine.pickModelTrack(data.rules2026, 'sogang', { name: '경영학부(경영학전공)', track: '인문', ruleTrack: '상경' });
  const derived = engine.formulaRatioWeights(track2026, { std: data.std, conv: data.conv, universityId: 'sogang' });
  assert.equal(derived.basis, 'ratio-from-2026');
  assert.ok(derived.kor > 0 && derived.math > 0 && derived.inq > 0);
  // 서강대 요강은 국 1.1 · 수 1.3 · 탐 0.6×2(표준점수) — 실효 몫이 수학 > 국어 > 탐구 순이다.
  assert.ok(derived.math > derived.kor && derived.kor > derived.inq, JSON.stringify(derived));

  const university = data.universities.find((one) => one.id === 'sogang');
  const dept = university.departments.find((one) => one.name === '경영학부(경영학전공)');
  const result = engine.evaluateJeongsi(
    profileFromData({ kor: '97', math: '69', inq1: '86', inq2: '52' }),
    university, dept, data.rules.sogang, university.volatility ?? data.volatility, engine.layerContext(data),
  );
  assert.equal(result.level, 'L2');
  assert.ok(result.model.flags.includes('ratio-from-2026'), '어느 비율을 썼는지 결과에 남긴다');
  assert.equal(result.model.apply.formula.ratioBasis, 'ratio-from-2026');
  // 컷·내·차이가 한 눈금(지수)이고, 평균 백분위는 따로 남는다.
  assert.equal(engine.round(result.mine - result.cut.value, 1), result.gap);
  assert.equal(result.cut.index70, result.cut.value);
  assert.equal(result.avgMine, 78.33);
  // 국어 97·수학 69·탐구 86/52 → 탐구 하나로 매긴 −20.0이 아니라 세 영역이 다 들어간 차이다.
  assert.ok(result.gap > -15 && result.gap < -8, `차이가 탐구 하나로 매겨졌다 (${result.gap})`);
  assert.deepEqual([...result.model.areas.map((row) => row.area)].sort(), ['inq', 'kor', 'math']);
});
