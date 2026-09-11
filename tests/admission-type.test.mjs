// 전형 분류·전형별 판정의 계약 테스트 (docs/MODEL.md §1.1-2).
//   1. 분류 표 — 대표 이름 20개가 표대로 접히는가.
//   2. 빌드 불변식 — `jeongsi[year].types[]`에 대표 행이 들어 있고 kind 값이 아홉 가지뿐인가.
//   3. 엔진 옵션 — 옵션 없음과 `{type:'general'}`의 결과가 **완전히 같은가**.
//   4. 특별전형 판정 — 농어촌 행으로 판정하면 컷이 그 행의 값인가.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { TYPE_KINDS, TYPE_LABEL, classifyType, compareTypeRows } from '../scripts/source-parsers/admission-type.mjs';
import { hasAdigaCut, pickRepresentative, typeRowsOf } from '../scripts/build-data.mjs';

const ROOT = process.cwd();
const load = (file, name) => {
  const context = { globalThis: null };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
  return context[name];
};
const DATA = load('assets/data.js', 'IPSI_DATA');
const ENGINE = load('assets/engine.js', 'IPSI_ENGINE');
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

// ---------------------------------------------------------------- 1. 분류 표
// 20개는 전부 어디가 2026 원문에 실제로 있는 전형명이거나(앞 18개), 표가 못박은 예외다(뒤 2개).
const TABLE = [
  ['수능(농어촌학생전형)', 'rural'],
  ['수능[정시{가군-기회균형전형-농·어촌학생(정원외)}]', 'rural'],
  ['수능(고른기회전형[농어촌학생])', 'rural'],                 // 농어촌이 고른기회보다 위다
  ['수능(특성화고교졸업자전형)', 'vocational'],
  ['수능(특성화고출신자전형)', 'vocational'],
  ['수능(고른기회전형[특성화고교졸업자])', 'vocational'],
  ['수능:특수교육전형', 'disability'],
  ['수능(장애인등대상자)', 'disability'],
  ['수능(지역인재전형)', 'regional'],
  ['수능위주전형(정시모집 지역균형전형)', 'regional'],
  ['수능(저소득-지역인재전형)', 'regional'],                    // 지역인재가 저소득보다 위다
  ['수능(기초생활수급자 및 차상위계층 특별전형)', 'equal'],
  ['수능:사회배려전형', 'equal'],
  ['수능(고른기회전형[연세한마음학생])', 'equal'],
  ['수능(교육기회배려자)', 'equal'],
  ['수능(예체능실기전형)', 'practical'],
  ['수능:일반전형(계약학과)', 'other'],
  ['수능(국가안보융합전형)', 'other'],
  // 표가 못박은 예외 — 이름에 '특성화고'가 있어도 재직자·성인학습자는 기타다.
  ['수능(특성화고졸업 재직자전형)', 'other'],
  ['수능(성인학습자전형)', 'other'],
];

test('분류 표 — 대표 전형명 20개가 우선순위 표대로 접힌다', () => {
  for (const [name, kind] of TABLE) {
    const got = classifyType(name);
    assert.equal(got.kind, kind, `${name}: ${got.kind} (기대 ${kind})`);
    assert.equal(got.label, TYPE_LABEL[kind]);
  }
});

test('분류 표 — 애매한 이름은 general 로 떨어진다 (수동 검토용)', () => {
  for (const name of ['수능:교과우수전형', '수능(일반전형[일반계열])', '수능(가군 일반)', '수능(수능우수자전형)', '수능[정시(가군-수능위주전형)]']) {
    assert.equal(classifyType(name).kind, 'general', name);
  }
});

test('분류 — 빈 이름·없는 값도 general 이고 kind 는 아홉 가지뿐이다', () => {
  assert.equal(TYPE_KINDS.length, 9);
  for (const value of ['', null, undefined, '   ']) assert.equal(classifyType(value).kind, 'general');
});

test('정렬 — kind 우선순위가 먼저이고 같은 kind 안에서는 모집시기 순이다', () => {
  const rows = [
    { kind: 'general', period: '정시(나)', typeName: 'b' },
    { kind: 'general', period: '정시(가)', typeName: 'a' },
    { kind: 'rural', period: '정시(다)', typeName: 'c' },
  ];
  const sorted = [...rows].sort(compareTypeRows);
  assert.deepEqual(sorted.map((row) => row.typeName), ['c', 'a', 'b']);
});

// ---------------------------------------------------------------- 2. 빌드 불변식
const sample = (kind, period, extra = {}) => ({
  typeName: kind, period, typeKind: kind, typeLabel: TYPE_LABEL[kind],
  quota: { initial: 10, carried: 0, final: 10 }, rate: 3, fill: 1, ...extra,
});

test('대표 행 — 컷이 있는 general 행(가군 우선)이 대표다', () => {
  const rows = [
    sample('rural', '정시(가)', { score: { p70: 300 } }),
    sample('general', '정시(나)', { score: { p70: 400 } }),
    sample('general', '정시(가)', { score: { p70: 410 } }),
  ].sort(compareTypeRows);
  const best = pickRepresentative(rows);
  assert.equal(best.typeKind, 'general');
  assert.equal(best.period, '정시(가)');
});

test('대표 행 — general 에 컷이 없으면 컷이 있는 첫 행이다', () => {
  const rows = [
    sample('rural', '정시(가)', { score: { p70: 300 } }),
    sample('general', '정시(가)', {}),
  ].sort(compareTypeRows);
  assert.equal(pickRepresentative(rows).typeKind, 'rural');
  assert.equal(hasAdigaCut(rows[0]), true);
  assert.equal(hasAdigaCut(rows.find((row) => row.typeKind === 'general')), false);
});

test('types 항목 — MODEL 필드와 요약값을 싣고 빈 칸은 키째 뺀다', () => {
  const [row] = typeRowsOf([sample('general', '정시(가)', {
    score: { p70: 659, p50: 660.5, total: 1000 },
    student: { p70: { kor: 97, math: 69, avg: 78 } },
    consistent: true,
  })]);
  assert.equal(row.kind, 'general');
  assert.equal(row.label, '일반');
  assert.equal(row.group, '가');
  assert.equal(row.quota, 10);
  assert.equal(row.score70, 659);
  assert.equal(row.cut70, 78);
  assert.equal(row.aggregation, 'adiga-score-rank');
  assert.equal(row.consistent, true);
  assert.ok(!('cut50' in row), 'p50 학생이 없으면 cut50 키 자체가 없다');
});

test('생성 데이터 — types 의 kind 는 아홉 가지뿐이고 대표 행이 그 안에 있다', () => {
  let withTypes = 0;
  let typeRows = 0;
  for (const university of DATA.universities) {
    for (const dept of university.departments) {
      for (const [year, row] of Object.entries(dept.jeongsi)) {
        if (!Array.isArray(row.types)) continue;
        withTypes += 1;
        typeRows += row.types.length;
        const where = `${university.id} ${dept.name} ${year}`;
        assert.ok(row.types.length > 0, `${where}: types 가 비어 있다`);
        for (const one of row.types) {
          assert.ok(TYPE_KINDS.includes(one.kind), `${where}: kind ${one.kind}`);
          assert.equal(one.label, TYPE_LABEL[one.kind], `${where}: 라벨`);
          assert.equal(classifyType(one.typeName).kind, one.kind, `${where}: ${one.typeName}`);
        }
        // 대표 행(jeongsi[year] 자체)은 반드시 types 안에 있다.
        // 어디가가 컷을 공개하지 않은 행(aggregation 'unknown')은 학점나비 전사값이 위에 남아
        // 모집군 표기가 어긋날 수 있다 — 그때는 전형명으로만 짝을 확인한다.
        const disclosed = row.aggregation === 'adiga-score-rank';
        const twin = row.types.find((one) => one.typeName === row.typeName
          && (!disclosed || (one.group ?? null) === (row.group ?? null)));
        assert.ok(twin, `${where}: 대표 행 ${row.typeName} 이 types 에 없다`);
        assert.equal(twin.kind, row.typeKind, `${where}: 대표 행 kind`);
        if (disclosed && isNumber(row.score70)) assert.equal(twin.score70, row.score70, `${where}: 대표 행 환산점수`);
        // 정렬 불변식 — kind 우선순위·모집시기 순.
        const sorted = [...row.types].sort(compareTypeRows);
        assert.deepEqual(row.types.map((one) => one.typeName), sorted.map((one) => one.typeName), `${where}: 정렬`);
      }
    }
  }
  assert.ok(withTypes >= 1900, `types 를 실은 모집단위·학년도가 1900 이상이어야 한다 (지금 ${withTypes})`);
  assert.ok(typeRows > withTypes, `전형 행 합계가 모집단위 수보다 커야 한다 (${typeRows} vs ${withTypes})`);
});

// ---------------------------------------------------------------- 3. 엔진 옵션 회귀
const PROFILES = [
  { mode: 'pct', year: '2027', korElective: '화법과작문', mathElective: '미적분', kor: '97', math: '95', eng: '2', hist: '1', inq1: '90', inq1Subject: '생명과학I', inq2: '88', inq2Subject: '지구과학I' },
  { mode: 'pct', year: '2027', korElective: '언어와매체', mathElective: '확률과통계', kor: '70', math: '62', eng: '4', hist: '3', inq1: '65', inq1Subject: '사회문화', inq2: '60', inq2Subject: '생활과윤리' },
  { mode: 'grade', year: '2027', korElective: '화법과작문', mathElective: '기하', kor: '3', math: '2', eng: '3', hist: '2', inq1: '3', inq1Subject: '물리학I', inq2: '4', inq2Subject: '화학I' },
];

test('엔진 옵션 — 전 모집단위 × 프로필 셋에서 옵션 없음과 {type:general} 이 완전히 같다', () => {
  const context = ENGINE.layerContext(DATA);
  let checked = 0;
  for (const input of PROFILES) {
    const profile = ENGINE.normalizeProfile(input, DATA.scales, DATA.std);
    for (const university of DATA.universities) {
      const rule = DATA.rules?.[university.id];
      const spread = university.volatility ?? DATA.volatility;
      for (const dept of university.departments) {
        const plain = ENGINE.evaluateJeongsi(profile, university, dept, rule, spread, context);
        const general = ENGINE.evaluateJeongsi(profile, university, dept, rule, spread, context, { type: 'general' });
        assert.equal(JSON.stringify(general), JSON.stringify(plain), `${university.id} ${dept.name}`);
        assert.equal(plain.type, 'general');
        checked += 1;
      }
    }
  }
  assert.ok(checked >= 5000, `대조한 판정이 5000건 이상이어야 한다 (지금 ${checked})`);
});

test('엔진 옵션 — 그 전형 행이 없으면 no-type 이고 diagnose 목록에서 빠진다', () => {
  const context = ENGINE.layerContext(DATA);
  const profile = ENGINE.normalizeProfile(PROFILES[0], DATA.scales, DATA.std);
  const university = DATA.universities.find((one) => one.id === 'kookmin');
  const dept = university.departments.find((one) => one.name === '자유전공(A)');
  const result = ENGINE.evaluateJeongsi(profile, university, dept, DATA.rules?.[university.id], university.volatility, context, { type: 'overseas' });
  assert.equal(result.status, 'no-type');
  assert.equal(result.level, 'L0');
  assert.equal(result.type, 'overseas');
  assert.equal(result.cut, null);
  assert.ok(result.hold.reason.includes('재외국민'));
  // 재외국민 행은 어디가 2026에 한 줄도 없다 — 목록이 통째로 빈다.
  assert.equal(ENGINE.diagnose(profile, DATA, { type: 'overseas' }).length, 0);
  assert.ok(ENGINE.diagnose(profile, DATA, {}).length > 1000);
});

// ---------------------------------------------------------------- 4. 특별전형 판정
test('농어촌 행으로 판정하면 컷·전형명·모집인원이 그 행의 값이다', () => {
  const context = ENGINE.layerContext(DATA);
  const profile = ENGINE.normalizeProfile(PROFILES[0], DATA.scales, DATA.std);
  let checked = 0;
  for (const university of DATA.universities) {
    const rule = DATA.rules?.[university.id];
    const spread = university.volatility ?? DATA.volatility;
    for (const dept of university.departments) {
      const years = Object.keys(dept.jeongsi).sort().reverse();
      const year = years.find((one) => Array.isArray(dept.jeongsi[one].types)
        && dept.jeongsi[one].types.some((row) => row.kind === 'rural' && isNumber(row.score70)));
      if (!year) continue;
      const rural = dept.jeongsi[year].types.find((row) => row.kind === 'rural' && isNumber(row.score70));
      const result = ENGINE.evaluateJeongsi(profile, university, dept, rule, spread, context, { type: 'rural' });
      if (result.status !== 'ok') continue;
      const where = `${university.id} ${dept.name} ${year}`;
      assert.equal(result.apply.typeName, rural.typeName, `${where}: 전형명`);
      assert.equal(result.apply.type, 'rural', `${where}: kind`);
      assert.equal(result.cut.score70, rural.score70, `${where}: 환산점수 70%컷`);
      if (isNumber(rural.cut70)) assert.equal(result.cut.avg70, rural.cut70, `${where}: 평균 백분위`);
      // 트랙이 전형을 명시하지 않으므로 산식은 가정이다 (§1.1-2).
      assert.ok(result.flags.includes('type-formula-assumed'), `${where}: type-formula-assumed`);
      // 같은 모집단위의 일반 판정과는 다른 행이다.
      const general = ENGINE.evaluateJeongsi(profile, university, dept, rule, spread, context);
      if (general.status === 'ok' && general.apply.typeName !== rural.typeName) {
        assert.notEqual(general.cut.score70, result.cut.score70, `${where}: 일반과 같은 컷`);
        assert.ok(!general.flags.includes('type-formula-assumed'), `${where}: 일반에 산식 가정`);
      }
      checked += 1;
    }
  }
  assert.ok(checked >= 50, `농어촌 판정이 50곳 이상이어야 한다 (지금 ${checked})`);
});

test('analyzeTarget 도 같은 전형 옵션을 받는다', () => {
  const context = ENGINE.layerContext(DATA);
  const profile = ENGINE.normalizeProfile(PROFILES[0], DATA.scales, DATA.std);
  const university = DATA.universities.find((one) => one.id === 'snu');
  const dept = university.departments.find((one) => Array.isArray(one.jeongsi['2026']?.types)
    && one.jeongsi['2026'].types.some((row) => row.kind === 'rural' && isNumber(row.score70)));
  assert.ok(dept, '서울대에 농어촌 행이 있는 모집단위가 있어야 한다');
  const rural = dept.jeongsi['2026'].types.find((row) => row.kind === 'rural');
  const plan = ENGINE.analyzeTarget(profile, university, dept, DATA.rules?.[university.id], university.volatility, context, { type: 'rural' });
  assert.equal(plan.type, 'rural');
  assert.equal(plan.apply.typeName, rural.typeName);
  assert.equal(plan.cut.score70, rural.score70);
  assert.ok(plan.plan, '목표 계획이 나온다');
});
