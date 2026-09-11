// L1 국소 기울기 계약 테스트 (docs/MODEL.md §3 · 2026-09-11 대칭 차분).
//
// 백분위→표준점수 되읽기 표는 눈금이 성기다. 낮은 백분위에서 "백분위 +1"만으로 기울기를 재면
// 표준점수가 한 계단도 안 움직이거나 한 계단만 움직여 기울기가 0.3~0.5점/백분위로 무너지고,
// `gapEq = 점수 차 ÷ 기울기`가 백분위 상당을 몇 배로 부풀린다(경상국립대 회계세무학부: 점수 차
// −11.25점이 백분위 상당 −32.1로 나왔다). 대칭 차분은 위·아래를 함께 봐서 그 왜곡을 없앤다.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { selfPlacement } from '../scripts/accuracy-audit.mjs';

const ROOT = process.cwd();
const load = (file, name) => {
  const context = { globalThis: null, window: null };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
  return context[name];
};
const engine = load('assets/engine.js', 'IPSI_ENGINE');
const DATA = load('assets/data.js', 'IPSI_DATA');
const CONTEXT = engine.layerContext(DATA);
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

// 판정에 실제로 쓰인 기울기. 엔진은 점수 차(점)와 백분위 상당을 둘 다 돌려주므로 되돌려 잰다.
const slopeOf = (result) => {
  const points = result?.gapDetail?.points;
  const pctEq = result?.gapDetail?.gap2026;
  if (!isNumber(points) || !isNumber(pctEq) || Math.abs(pctEq) < 0.05) return null;
  return points / pctEq;
};

const universityOf = (id) => (DATA.universities || []).find((one) => one.id === id) || null;
const judge = (profile, university, dept) => engine.evaluateJeongsi(
  profile, university, dept, DATA.rules?.[university.id],
  university.volatility ?? DATA.volatility, CONTEXT,
);

test('낮은 백분위 프로필에서도 경상국립대 인문 트랙의 기울기가 무너지지 않는다', () => {
  const gnu = universityOf('gnu');
  assert.ok(gnu, '경상국립대가 데이터에 있어야 한다');
  // 탐구가 55·40으로 낮은 자리 — 옛 "백분위 +1" 방식이 가장 크게 무너지던 구간이다.
  const profile = engine.normalizeProfile({
    mode: 'pct', year: '2026', korElective: '화법과작문', mathElective: '확률과통계',
    kor: '83', math: '69', eng: '3', hist: '3',
    inq1Subject: '물리학I', inq1: '55', inq2Subject: '화학I', inq2: '40',
  }, DATA.scales, DATA.std);
  assert.equal(profile.kor.pct, 83);
  assert.deepEqual(profile.inquiries.map((row) => row.pct), [55, 40]);

  const humanities = gnu.departments.filter((dept) => dept.track === '인문' || dept.track === '상경');
  assert.ok(humanities.length > 0, '인문 트랙 모집단위가 있어야 한다');
  let checked = 0;
  for (const dept of humanities) {
    const result = judge(profile, gnu, dept);
    if (result.status !== 'ok') continue;
    checked += 1;
    // L1이면 기울기가 1.0점/백분위 이상이어야 하고, 그렇지 못하면 L2 아래로 내려가 있어야 한다.
    if (result.level !== 'L1') {
      assert.notEqual(result.level, 'L1');
      continue;
    }
    const slope = slopeOf(result);
    if (slope === null) continue;
    assert.ok(slope >= 1, `${dept.name} 기울기 ${slope.toFixed(3)}점/백분위`);
  }
  assert.ok(checked > 0, '판정이 선 인문 모집단위가 있어야 한다');
});

test('경상국립대 회계세무학부 70% 학생의 백분위 상당이 점수 차에 맞는 크기다', () => {
  const gnu = universityOf('gnu');
  const dept = gnu.departments.find((one) => one.name === '회계세무학부');
  assert.ok(dept, '회계세무학부가 데이터에 있어야 한다');
  const result = selfPlacement(engine, DATA, gnu, dept, 'p70').result;
  assert.equal(result.status, 'ok');
  assert.equal(result.level, 'L1');
  const slope = slopeOf(result);
  assert.ok(slope >= 1, `기울기 ${slope}점/백분위`);
  // 점수 차 −11점대가 백분위 상당 −32로 부풀던 자리다. 이제 −11점대에 맞는 폭이어야 한다.
  assert.ok(Math.abs(result.gapDetail.gap2026) < 12, `백분위 상당 ${result.gapDetail.gap2026}`);
});

test('국민대 자유전공(A) 70% 학생은 그대로 소신이다', () => {
  const kookmin = universityOf('kookmin');
  const dept = kookmin.departments.find((one) => one.name === '자유전공(A)' || one.name === '자유전공학부(A)');
  assert.ok(dept, '자유전공(A)가 데이터에 있어야 한다');
  const entry = selfPlacement(engine, DATA, kookmin, dept, 'p70');
  assert.equal(entry.result.status, 'ok');
  assert.equal(entry.result.level, 'L1');
  assert.equal(entry.result.band.label, '소신');
});

test('전 모집단위 불변식 — 백분위 상당은 점수 차를 기울기 0.5로 나눈 값을 넘지 않는다', () => {
  let judged = 0;
  let l1 = 0;
  for (const university of DATA.universities || []) {
    for (const dept of university.departments || []) {
      const result = selfPlacement(engine, DATA, university, dept, 'p70').result;
      if (!result || result.status !== 'ok' || result.level !== 'L1') continue;
      judged += 1;
      const points = result.gapDetail?.points;
      const pctEq = result.gapDetail?.gap2026;
      if (!isNumber(points) || !isNumber(pctEq) || Math.abs(points) <= 0.05) continue;
      l1 += 1;
      // |pctEq| ≤ |points| ÷ 0.5 — 기울기가 0.5점/백분위 아래로 무너진 자리가 없다는 뜻이다.
      assert.ok(
        Math.abs(pctEq) <= Math.abs(points) / 0.5 + 1e-6,
        `${university.id}::${dept.name} 점수 차 ${points} · 백분위 상당 ${pctEq}`,
      );
    }
  }
  assert.ok(judged > 100, `L1 판정이 ${judged}곳뿐이다`);
  assert.ok(l1 > 100, `점수 차가 있는 L1이 ${l1}곳뿐이다`);
});
